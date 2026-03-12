"""Research deduplication via Gemini Embedding 2 semantic similarity.

When 5-8 parallel scene research agents run simultaneously against the same
historical document, they frequently discover overlapping facts. Agent 0 may
report "Constantinople fell in 1453" while Agent 3 writes "The Byzantine
capital fell to the Ottomans in 1453." Both are correct but passing both to
the script agent wastes tokens and produces repetitive narration.

This module embeds every extracted fact sentence using
``gemini-embedding-2-preview`` with ``task_type=SEMANTIC_SIMILARITY``, then
removes near-duplicates via pairwise cosine similarity above a configurable
threshold (default 0.88). Surviving facts are re-grouped by scene so the
aggregator and script agents receive clean, non-redundant research context.

Performance target: < 3 seconds for 160 sentences (8 agents x 20 sentences),
achieved by batching up to 250 sentences per API call and parallelising
batches when the total exceeds 250.

Integration point: called between the scene research parallel agent (Phase II)
output and the aggregator agent input, inside ``SceneResearchOrchestrator``
or as a standalone post-processing step.
"""

from __future__ import annotations

import asyncio
import logging
import re
import time
from dataclasses import dataclass, field
from typing import Any

import numpy as np
from google import genai
from google.genai import types

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_MODEL_ID = "gemini-embedding-2-preview"
"""Gemini Embedding 2 model for semantic similarity embeddings."""

_MAX_BATCH_SIZE = 250
"""Maximum sentences per embed_content API call (Gemini API limit)."""

_DEFAULT_SIMILARITY_THRESHOLD = 0.88
"""Cosine similarity above which two facts are considered duplicates.

Tuned empirically: 0.88 catches paraphrases like "Constantinople fell in 1453"
vs "The Byzantine capital fell to the Ottomans in 1453" while preserving
genuinely distinct facts about the same event (e.g., "The siege lasted 53 days"
vs "The walls were breached on May 29, 1453").
"""


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class TaggedFact:
    """A single fact sentence tagged with its source scene index.

    Attributes:
        scene_index: Zero-based index of the scene this fact was extracted from.
        text: The raw fact sentence string.
        original_position: Position within the scene's fact list (for stable
            ordering within a scene after deduplication).
    """

    scene_index: int
    text: str
    original_position: int


@dataclass
class DeduplicationResult:
    """Output of the deduplication pipeline.

    Attributes:
        deduplicated_facts: Facts grouped by scene_index, preserving original
            intra-scene ordering. Dict keys are scene indices, values are
            ordered lists of surviving fact strings.
        total_input: Number of facts before deduplication.
        total_output: Number of facts after deduplication.
        duplicates_removed: Number of duplicate facts removed.
        elapsed_seconds: Wall-clock time for the entire operation.
    """

    deduplicated_facts: dict[int, list[str]]
    total_input: int
    total_output: int
    duplicates_removed: int
    elapsed_seconds: float


# ---------------------------------------------------------------------------
# Sentence splitting
# ---------------------------------------------------------------------------


_SENTENCE_SPLIT_RE = re.compile(
    r'(?<=[.!?])\s+(?=[A-Z\[\("\u201c])'
)
"""Regex to split text into sentences at period/exclamation/question mark
boundaries followed by whitespace and an uppercase letter, opening bracket,
or opening quote. This handles confidence labels like "[ESTABLISHED FACT]"
that start fact strings in the research output format."""


def _split_into_sentences(text: str) -> list[str]:
    """Split a research result string into individual fact sentences.

    Handles the research output format where each fact is prefixed with a
    confidence label like ``[ESTABLISHED FACT]``, ``[VERIFIED]``, or
    ``[UNVERIFIED]``. Also handles plain prose paragraphs.

    Sentences shorter than 10 characters are discarded (typically fragments
    from malformed splits).

    Args:
        text: Raw research result text from a single agent.

    Returns:
        List of non-empty, stripped fact sentences.
    """
    if not text or not text.strip():
        return []

    # First try splitting on newlines (common in structured agent output)
    lines = [line.strip() for line in text.strip().split("\n") if line.strip()]

    # If we got multiple lines, each line is likely a separate fact
    if len(lines) > 1:
        sentences = []
        for line in lines:
            # Skip JSON structure artifacts
            if line in ("{", "}", "[", "]", ","):
                continue
            # Sub-split very long lines that contain multiple sentences
            if len(line) > 300:
                sub = _SENTENCE_SPLIT_RE.split(line)
                sentences.extend(s.strip() for s in sub if s.strip())
            else:
                sentences.append(line)
    else:
        # Single block of text: split on sentence boundaries
        sentences = _SENTENCE_SPLIT_RE.split(text.strip())
        sentences = [s.strip() for s in sentences if s.strip()]

    # Filter out very short fragments
    return [s for s in sentences if len(s) >= 10]


# ---------------------------------------------------------------------------
# Embedding
# ---------------------------------------------------------------------------


async def _batch_embed(
    client: genai.Client,
    texts: list[str],
) -> np.ndarray:
    """Embed a list of texts using Gemini Embedding 2 with batching.

    Splits ``texts`` into chunks of ``_MAX_BATCH_SIZE`` and calls the
    embedding API for each chunk. If multiple chunks exist they are called
    concurrently via ``asyncio.gather``.

    Args:
        client: Initialised ``google.genai.Client`` (Vertex AI or API key).
        texts: List of sentences to embed.

    Returns:
        NumPy array of shape ``(len(texts), embedding_dim)`` with float32
        embeddings. Rows correspond 1:1 to the input ``texts`` list.

    Raises:
        ValueError: If ``texts`` is empty.
        google.api_core.exceptions.GoogleAPIError: On API failure after
            the genai client's built-in retry logic.
    """
    if not texts:
        raise ValueError("Cannot embed an empty list of texts.")

    # Partition into batches of _MAX_BATCH_SIZE
    batches: list[list[str]] = [
        texts[i : i + _MAX_BATCH_SIZE]
        for i in range(0, len(texts), _MAX_BATCH_SIZE)
    ]

    async def _embed_one_batch(batch: list[str]) -> list[list[float]]:
        """Call the embedding API for a single batch."""
        response = await client.aio.models.embed_content(
            model=_MODEL_ID,
            contents=batch,
            config=types.EmbedContentConfig(
                task_type="SEMANTIC_SIMILARITY",
            ),
        )
        return [e.values for e in response.embeddings]

    if len(batches) == 1:
        vectors = await _embed_one_batch(batches[0])
    else:
        # Fire all batches concurrently
        results = await asyncio.gather(
            *[_embed_one_batch(b) for b in batches]
        )
        vectors = []
        for batch_result in results:
            vectors.extend(batch_result)

    return np.array(vectors, dtype=np.float32)


# ---------------------------------------------------------------------------
# Cosine similarity and duplicate detection
# ---------------------------------------------------------------------------


def _cosine_similarity_matrix(embeddings: np.ndarray) -> np.ndarray:
    """Compute the full pairwise cosine similarity matrix.

    Uses normalised dot product: ``cos(a, b) = (a . b) / (|a| * |b|)``.
    Vectorised with NumPy for speed -- O(n^2 * d) where n is the number of
    sentences and d is the embedding dimension.

    Args:
        embeddings: Array of shape ``(n, d)``.

    Returns:
        Symmetric matrix of shape ``(n, n)`` with values in ``[-1, 1]``.
    """
    # L2 normalise each row
    norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
    # Avoid division by zero for degenerate zero-vectors
    norms = np.maximum(norms, 1e-10)
    normed = embeddings / norms
    return normed @ normed.T


def _find_duplicates(
    similarity_matrix: np.ndarray,
    threshold: float,
) -> set[int]:
    """Identify indices to remove based on the similarity threshold.

    For every pair ``(i, j)`` where ``i < j`` and
    ``similarity_matrix[i, j] > threshold``, the higher-indexed sentence
    ``j`` is marked for removal. This implements a greedy "keep the first
    occurrence" strategy that is stable with respect to input order.

    The greedy approach runs in O(n^2) and is acceptable for n <= 200
    (typical pipeline volume). For significantly larger n, a clustering
    approach (e.g., agglomerative or HDBSCAN) would be more appropriate
    but is not needed here.

    Args:
        similarity_matrix: Symmetric ``(n, n)`` cosine similarity matrix.
        threshold: Similarity above which a pair is considered duplicate.

    Returns:
        Set of indices to remove from the original sentence list.
    """
    n = similarity_matrix.shape[0]
    to_remove: set[int] = set()

    for i in range(n):
        if i in to_remove:
            continue
        for j in range(i + 1, n):
            if j in to_remove:
                continue
            if similarity_matrix[i, j] > threshold:
                to_remove.add(j)

    return to_remove


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def deduplicate_research_facts(
    research_results: list[str],
    *,
    client: genai.Client | None = None,
    similarity_threshold: float = _DEFAULT_SIMILARITY_THRESHOLD,
    scene_indices: list[int] | None = None,
) -> DeduplicationResult:
    """Deduplicate research facts from parallel scene research agents.

    This is the main entry point for the deduplication system. It:

    1. Splits each research result string into individual fact sentences.
    2. Tags each sentence with its source scene index.
    3. Batch-embeds all sentences using ``gemini-embedding-2-preview`` with
       ``task_type=SEMANTIC_SIMILARITY``.
    4. Computes pairwise cosine similarity across all sentences.
    5. Removes near-duplicates above the threshold using greedy first-wins.
    6. Returns surviving facts grouped by scene index.

    Args:
        research_results: List of research output strings, one per agent.
            Typically 5-8 strings of 500-1000 tokens each.
        client: Pre-initialised ``google.genai.Client``. If ``None``, a new
            Vertex AI client is created using ``GCP_PROJECT_ID`` from the
            environment (matching the project-wide pattern).
        similarity_threshold: Cosine similarity above which two sentences are
            considered duplicates. Default ``0.88``.
        scene_indices: Optional explicit scene index mapping. If provided,
            must be the same length as ``research_results``. If ``None``,
            scenes are numbered ``0, 1, ..., len(research_results) - 1``.

    Returns:
        ``DeduplicationResult`` with deduplicated facts grouped by scene.

    Raises:
        ValueError: If ``scene_indices`` length does not match
            ``research_results`` length.
    """
    t_start = time.monotonic()

    if scene_indices is not None and len(scene_indices) != len(research_results):
        raise ValueError(
            f"scene_indices length ({len(scene_indices)}) does not match "
            f"research_results length ({len(research_results)})."
        )

    # ------------------------------------------------------------------
    # Step 1-2: Split and tag
    # ------------------------------------------------------------------
    tagged_facts: list[TaggedFact] = []

    for agent_idx, result_text in enumerate(research_results):
        scene_idx = scene_indices[agent_idx] if scene_indices else agent_idx
        sentences = _split_into_sentences(result_text)

        for pos, sentence in enumerate(sentences):
            tagged_facts.append(
                TaggedFact(
                    scene_index=scene_idx,
                    text=sentence,
                    original_position=pos,
                )
            )

    total_input = len(tagged_facts)

    logger.info(
        "Research deduplication: %d sentences extracted from %d agents",
        total_input,
        len(research_results),
    )

    # Edge case: nothing to deduplicate
    if total_input == 0:
        return DeduplicationResult(
            deduplicated_facts={},
            total_input=0,
            total_output=0,
            duplicates_removed=0,
            elapsed_seconds=time.monotonic() - t_start,
        )

    # Single sentence: nothing to compare
    if total_input == 1:
        fact = tagged_facts[0]
        return DeduplicationResult(
            deduplicated_facts={fact.scene_index: [fact.text]},
            total_input=1,
            total_output=1,
            duplicates_removed=0,
            elapsed_seconds=time.monotonic() - t_start,
        )

    # ------------------------------------------------------------------
    # Step 3: Batch embed
    # ------------------------------------------------------------------
    if client is None:
        import os

        client = genai.Client(
            vertexai=True,
            project=os.environ["GCP_PROJECT_ID"],
            location="us-central1",
        )

    texts = [f.text for f in tagged_facts]

    t_embed_start = time.monotonic()
    embeddings = await _batch_embed(client, texts)
    t_embed_elapsed = time.monotonic() - t_embed_start

    logger.info(
        "Embedded %d sentences in %.2fs (shape: %s)",
        total_input,
        t_embed_elapsed,
        embeddings.shape,
    )

    # ------------------------------------------------------------------
    # Step 4: Compute similarity matrix
    # ------------------------------------------------------------------
    sim_matrix = _cosine_similarity_matrix(embeddings)

    # ------------------------------------------------------------------
    # Step 5: Find and remove duplicates
    # ------------------------------------------------------------------
    to_remove = _find_duplicates(sim_matrix, similarity_threshold)

    logger.info(
        "Deduplication: removing %d/%d sentences (threshold=%.2f)",
        len(to_remove),
        total_input,
        similarity_threshold,
    )

    # ------------------------------------------------------------------
    # Step 6: Regroup surviving facts by scene
    # ------------------------------------------------------------------
    grouped: dict[int, list[tuple[int, str]]] = {}

    for idx, fact in enumerate(tagged_facts):
        if idx in to_remove:
            continue
        if fact.scene_index not in grouped:
            grouped[fact.scene_index] = []
        grouped[fact.scene_index].append((fact.original_position, fact.text))

    # Sort within each scene by original position for stable ordering
    deduplicated: dict[int, list[str]] = {}
    for scene_idx in sorted(grouped.keys()):
        entries = sorted(grouped[scene_idx], key=lambda t: t[0])
        deduplicated[scene_idx] = [text for _, text in entries]

    total_output = sum(len(v) for v in deduplicated.values())
    elapsed = time.monotonic() - t_start

    logger.info(
        "Research deduplication complete: %d -> %d sentences (-%d) in %.2fs",
        total_input,
        total_output,
        total_input - total_output,
        elapsed,
    )

    return DeduplicationResult(
        deduplicated_facts=deduplicated,
        total_input=total_input,
        total_output=total_output,
        duplicates_removed=total_input - total_output,
        elapsed_seconds=elapsed,
    )


# ---------------------------------------------------------------------------
# Convenience: deduplicate parsed JSON research outputs
# ---------------------------------------------------------------------------


def extract_facts_from_research_json(raw_json_str: str) -> str:
    """Extract the facts list from a research agent's JSON output string.

    Research agents produce JSON with a ``"facts"`` key containing a list
    of strings. This helper parses the JSON (tolerating markdown fences)
    and returns the facts joined as newline-separated text suitable for
    sentence splitting.

    Args:
        raw_json_str: Raw string from ``session.state["research_N"]``.

    Returns:
        Newline-joined facts string, or the original string if JSON
        parsing fails (graceful degradation to raw text splitting).
    """
    import json

    if not raw_json_str or not raw_json_str.strip():
        return ""

    text = raw_json_str.strip()

    # Strip markdown code fences
    if text.startswith("```"):
        lines = text.split("\n")
        # Remove first and last lines if they are fence markers
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        text = "\n".join(lines)

    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict) and "facts" in parsed:
            facts = parsed["facts"]
            if isinstance(facts, list):
                return "\n".join(str(f) for f in facts if f)
    except (json.JSONDecodeError, TypeError):
        pass

    # Fallback: return the raw text for sentence splitting
    return raw_json_str


async def deduplicate_research_state(
    session_state: dict[str, Any],
    num_scenes: int,
    *,
    client: genai.Client | None = None,
    similarity_threshold: float = _DEFAULT_SIMILARITY_THRESHOLD,
) -> DeduplicationResult:
    """Deduplicate facts from ``session.state["research_N"]`` keys.

    Convenience wrapper that reads the standard research output keys from
    the ADK session state, extracts facts from JSON, deduplicates, and
    returns the result. Designed to be called directly from
    ``SceneResearchOrchestrator`` or the aggregator agent.

    Args:
        session_state: The ADK ``session.state`` dictionary.
        num_scenes: Number of scenes to read (``research_0`` through
            ``research_{num_scenes - 1}``).
        client: Pre-initialised ``google.genai.Client``.
        similarity_threshold: Cosine similarity duplicate threshold.

    Returns:
        ``DeduplicationResult`` with deduplicated facts grouped by scene.
    """
    research_texts: list[str] = []
    scene_indices: list[int] = []

    for i in range(num_scenes):
        raw = session_state.get(f"research_{i}", "")
        if not raw or not str(raw).strip():
            continue
        facts_text = extract_facts_from_research_json(str(raw))
        if facts_text:
            research_texts.append(facts_text)
            scene_indices.append(i)

    if not research_texts:
        return DeduplicationResult(
            deduplicated_facts={},
            total_input=0,
            total_output=0,
            duplicates_removed=0,
            elapsed_seconds=0.0,
        )

    return await deduplicate_research_facts(
        research_texts,
        client=client,
        similarity_threshold=similarity_threshold,
        scene_indices=scene_indices,
    )
