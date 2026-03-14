"""Phase I of the AI Historian documentary pipeline: Document Analysis.

Orchestrates four sequential steps to transform a raw uploaded PDF into a
structured set of scene briefs that downstream agents (Script Agent, Visual
Director) consume:

    1. **OCR** -- Google Document AI extracts multilingual text from the PDF
       stored in GCS.
    2. **Semantic Chunking** -- Rule-based Python splitter segments the OCR
       text into coherent document sections using heading detection, topic
       shift heuristics, and a hard character-count fallback.
    3. **Parallel Summarisation** -- Gemini 2.0 Flash summarises every chunk
       concurrently (bounded by a semaphore to respect rate limits).
    4. **Narrative Curator** -- Gemini 2.0 Pro (via an ADK Agent) reads the
       full Document Map and selects 4-8 cinematically compelling scenes,
       producing structured ``SceneBrief`` objects and a Visual Bible style
       guide for Imagen 3.

Session state contract
----------------------
**Inputs** (must be set before this agent runs):
    - ``session.state["gcs_path"]`` -- GCS URI of the uploaded PDF
      (e.g. ``gs://bucket/session_id/document.pdf``).
    - ``session.state["visual_bible_seed"]`` -- *(optional)* Seed style
      description that the Narrative Curator incorporates into the Visual
      Bible.

**Outputs** (written by this agent):
    - ``session.state["gcs_ocr_path"]`` -- GCS URI of the raw OCR text file.
    - ``session.state["total_pages"]`` -- Number of pages in the document.
    - ``session.state["document_map"]`` -- Human-readable summary of every
      chunk, used by downstream agents via ``{document_map}`` template.
    - ``session.state["scene_briefs"]`` -- ``list[dict]`` of serialised
      ``SceneBrief`` objects.
    - ``session.state["visual_bible"]`` -- Comprehensive Imagen 3 style guide
      string produced by the Narrative Curator.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
from collections.abc import AsyncGenerator
from typing import Any, Iterator, TypeVar

T = TypeVar("T")

from google import genai as google_genai
from google.adk.agents import Agent
from google.adk.agents.base_agent import BaseAgent
from google.adk.agents.invocation_context import InvocationContext
from google.cloud import documentai_v1 as documentai
from google.cloud import firestore
from google.cloud import storage
from google.genai import types as genai_types
from pydantic import ConfigDict, Field

from .chunk_types import ChunkRecord, DocumentMap, SceneBrief
from .rate_limiter import GlobalRateLimiter, rate_limited_generate
from .sse_helpers import SSEEmitter, build_agent_status_event, build_pipeline_phase_event

logger = logging.getLogger(__name__)

# Fallback rate limiter used when no limiter is injected via the factory.
_fallback_limiter = GlobalRateLimiter(12, "gemini")

# ---------------------------------------------------------------------------
# Step 1 -- OCR helpers
# ---------------------------------------------------------------------------


_DOC_AI_PAGE_LIMIT = 15


async def _ocr_pdf_bytes(
    pdf_bytes: bytes,
    processor_name: str,
    *,
    retries: int = 3,
) -> str:
    """OCR a single PDF chunk (≤ 30 pages) passed as raw bytes."""
    client = documentai.DocumentProcessorServiceAsyncClient()
    request = documentai.ProcessRequest(
        name=processor_name,
        raw_document=documentai.RawDocument(
            content=pdf_bytes,
            mime_type="application/pdf",
        ),
    )
    last_exc: BaseException | None = None
    for attempt in range(retries):
        try:
            response = await client.process_document(request=request)
            return response.document.text
        except Exception as exc:
            last_exc = exc
            wait = 2 ** attempt
            logger.warning("OCR attempt %d/%d failed (%s), retrying in %ds", attempt + 1, retries, exc, wait)
            await asyncio.sleep(wait)
    raise RuntimeError(f"Document AI OCR failed after {retries} attempts: {last_exc}")


async def _run_ocr(
    gcs_uri: str,
    processor_name: str,
    *,
    retries: int = 3,
) -> tuple[str, int]:
    """Run Google Document AI OCR on a PDF stored in GCS.

    Automatically splits documents that exceed the 30-page processor limit
    into chunks and concatenates the results.

    Returns:
        A tuple of ``(ocr_text, page_count)``.
    """
    import io
    import pypdf
    from google.cloud import storage as _gcs

    # Download PDF from GCS
    loop = asyncio.get_event_loop()
    bucket_name, blob_path = gcs_uri[len("gs://"):].split("/", 1)

    def _download() -> bytes:
        client = _gcs.Client()
        return client.bucket(bucket_name).blob(blob_path).download_as_bytes()

    pdf_bytes = await loop.run_in_executor(None, _download)

    # Count pages
    reader = pypdf.PdfReader(io.BytesIO(pdf_bytes))
    total_pages = len(reader.pages)
    logger.info("PDF has %d pages (limit per OCR call: %d)", total_pages, _DOC_AI_PAGE_LIMIT)

    if total_pages <= _DOC_AI_PAGE_LIMIT:
        text = await _ocr_pdf_bytes(pdf_bytes, processor_name, retries=retries)
        logger.info("OCR completed: %d pages, %d characters", total_pages, len(text))
        return text, total_pages

    # Split into chunks and OCR each
    chunks: list[str] = []
    for start in range(0, total_pages, _DOC_AI_PAGE_LIMIT):
        end = min(start + _DOC_AI_PAGE_LIMIT, total_pages)
        logger.info("OCR chunk pages %d-%d of %d", start + 1, end, total_pages)

        writer = pypdf.PdfWriter()
        for page_num in range(start, end):
            writer.add_page(reader.pages[page_num])

        buf = io.BytesIO()
        writer.write(buf)
        chunk_bytes = buf.getvalue()

        chunk_text = await _ocr_pdf_bytes(chunk_bytes, processor_name, retries=retries)
        chunks.append(chunk_text)

    full_text = "\n".join(chunks)
    logger.info("OCR completed: %d pages total, %d characters", total_pages, len(full_text))
    return full_text, total_pages


async def _upload_ocr_text(
    session_id: str,
    text: str,
    bucket_name: str,
) -> str:
    """Upload raw OCR text to GCS for downstream auditing and replay.

    The upload is executed in a thread-pool executor because the GCS client
    library performs blocking I/O.

    Args:
        session_id: Active session identifier.
        text: Full OCR text to persist.
        bucket_name: Target GCS bucket (without ``gs://`` prefix).

    Returns:
        The ``gs://`` URI of the uploaded object.
    """
    blob_path = f"{session_id}/ocr_raw.txt"

    def _upload() -> None:
        client = storage.Client()
        bucket = client.bucket(bucket_name)
        blob = bucket.blob(blob_path)
        blob.upload_from_string(text, content_type="text/plain; charset=utf-8")

    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, _upload)

    gcs_uri = f"gs://{bucket_name}/{blob_path}"
    logger.info("OCR text uploaded to %s", gcs_uri)
    return gcs_uri


# ---------------------------------------------------------------------------
# Step 2 -- Semantic chunker (rule-based, no AI call)
# ---------------------------------------------------------------------------

_HEADING_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"^\s*(?:\d+(?:\.\d+)*|[IVX]+)[\.\)]\s+\S"),  # numbered/roman sections
    re.compile(r"^[A-Z][A-Z\s\d\-\—]{4,}$"),  # ALL-CAPS headings
]

_DATE_OR_PROPER_NOUN: re.Pattern[str] = re.compile(
    r"^(?:[A-Z][a-z]+|[A-Z]{2,}|\d{4}(?:[–\-]\d{4})?)"
)

_FALLBACK_CHUNK_CHARS: int = 3200  # ~800 tokens
_MIN_CHUNK_CHARS: int = 50


def _is_heading(line: str) -> bool:
    """Return ``True`` if *line* matches a structural heading pattern.

    Only lines of 120 characters or fewer are considered -- longer lines are
    almost certainly body text rather than headings.
    """
    stripped = line.strip()
    if len(stripped) > 120:
        return False
    return any(pat.search(stripped) for pat in _HEADING_PATTERNS)


def _is_topic_shift(prev_line: str, curr_line: str) -> bool:
    """Detect a likely topic boundary between two consecutive lines.

    A topic shift is signalled when the previous line is blank and the
    current line starts with a proper noun, uppercase word, or a year.
    """
    if prev_line.strip():
        return False
    return bool(_DATE_OR_PROPER_NOUN.match(curr_line.strip()))


def semantic_chunk(ocr_text: str, session_id: str) -> list[ChunkRecord]:
    """Split OCR text into semantically coherent chunks.

    The algorithm proceeds in three passes:

    1. **Page-aware line iteration** -- the text is split on ``\\f``
       (form-feed, injected by Document AI at page boundaries) to track page
       numbers.
    2. **Heading and topic-shift detection** -- whenever a heading or topic
       shift is detected the current buffer is flushed as a new chunk.
    3. **Hard fallback** -- any chunk exceeding ``_FALLBACK_CHUNK_CHARS`` is
       split into sub-chunks at sentence or whitespace boundaries.

    Args:
        ocr_text: Full document text from Document AI.
        session_id: Owning session identifier for the ``ChunkRecord`` objects.

    Returns:
        Ordered list of ``ChunkRecord`` objects.
    """
    pages = ocr_text.split("\f")
    chunks: list[ChunkRecord] = []
    sequence = 0

    current_lines: list[str] = []
    current_heading: str | None = None
    current_page_start: int = 1
    current_page_end: int = 1

    def _flush() -> None:
        nonlocal sequence, current_lines, current_heading, current_page_start, current_page_end

        raw = "\n".join(current_lines).strip()
        if len(raw) < _MIN_CHUNK_CHARS:
            current_lines = []
            return

        # Hard fallback: split oversized chunks
        text_segments = [raw]
        if len(raw) > _FALLBACK_CHUNK_CHARS:
            text_segments = []
            while len(raw) > _FALLBACK_CHUNK_CHARS:
                split_pos = raw.rfind(". ", 0, _FALLBACK_CHUNK_CHARS)
                if split_pos == -1:
                    split_pos = raw.rfind(" ", 0, _FALLBACK_CHUNK_CHARS)
                if split_pos == -1:
                    split_pos = _FALLBACK_CHUNK_CHARS
                text_segments.append(raw[: split_pos + 1].strip())
                raw = raw[split_pos + 1 :].strip()
            if raw:
                text_segments.append(raw)

        for segment in text_segments:
            if len(segment) < _MIN_CHUNK_CHARS:
                continue
            chunks.append(
                ChunkRecord(
                    chunk_id=f"chunk_{sequence:04d}",
                    session_id=session_id,
                    sequence=sequence,
                    page_start=current_page_start,
                    page_end=current_page_end,
                    raw_text=segment,
                    heading=current_heading,
                )
            )
            sequence += 1

        current_lines = []
        current_heading = None

    for page_idx, page_text in enumerate(pages, start=1):
        lines = page_text.split("\n")
        prev_line = ""

        for line in lines:
            if _is_heading(line):
                _flush()
                current_heading = line.strip()
                current_page_start = page_idx
                current_page_end = page_idx
            elif _is_topic_shift(prev_line, line):
                _flush()
                current_page_start = page_idx
                current_page_end = page_idx

            current_lines.append(line)
            current_page_end = page_idx
            prev_line = line

    # Flush remaining buffer
    _flush()

    logger.info(
        "Semantic chunker produced %d chunks from %d pages",
        len(chunks),
        len(pages),
    )
    return chunks


# ---------------------------------------------------------------------------
# Step 3 -- Chunk summariser (parallel Gemini 2.0 Flash calls)
# ---------------------------------------------------------------------------

_SUMMARISE_INSTRUCTION: str = (
    "Summarise this document section in 3-5 sentences. "
    "Preserve all proper names, dates, place names, and specific events "
    "exactly as written. Do not interpret or add context. "
    "If the section contains a list or table, describe its contents "
    "concisely.\n\n{text}"
)


async def _summarise_single_chunk(
    chunk: ChunkRecord,
    client: google_genai.Client,
    semaphore: asyncio.Semaphore,
    rate_limiter: GlobalRateLimiter | None = None,
) -> str:
    """Summarise a single chunk using Gemini 2.0 Flash.

    When a *rate_limiter* is provided, calls go through
    ``rate_limited_generate`` which adds concurrency gating and automatic
    retry with exponential backoff on 429/500/503 errors. Otherwise the
    call is gated by the legacy *semaphore*.

    On failure the first 200 characters of the raw text are returned as a
    degraded fallback so that downstream agents still receive context.

    Args:
        chunk: The chunk to summarise.
        client: Pre-constructed GenAI client.
        semaphore: Legacy concurrency limiter (used when no rate_limiter).
        rate_limiter: Optional ``GlobalRateLimiter`` for rate-limited calls.

    Returns:
        Summary text (3-5 sentences) or a truncated fallback.
    """
    limiter = rate_limiter or _fallback_limiter
    try:
        response = await rate_limited_generate(
            client,
            limiter,
            model="gemini-2.0-flash",
            contents=_SUMMARISE_INSTRUCTION.format(text=chunk.raw_text),
            config=genai_types.GenerateContentConfig(
                max_output_tokens=256,
                temperature=0.1,
            ),
            caller=f"summarizer:{chunk.chunk_id}",
        )
        return response.text
    except Exception as exc:
        logger.warning(
            "Summarisation failed for %s (%s), using fallback",
            chunk.chunk_id,
            exc,
        )
        return chunk.raw_text[:200] + "..."


async def _summarise_all_chunks(
    chunks: list[ChunkRecord],
    max_concurrent: int = 10,
    rate_limiter: GlobalRateLimiter | None = None,
) -> list[ChunkRecord]:
    """Summarise all chunks in parallel with bounded concurrency.

    Args:
        chunks: Ordered list of chunks to summarise.
        max_concurrent: Maximum number of simultaneous Gemini API calls.
        rate_limiter: Optional ``GlobalRateLimiter`` for rate-limited calls.

    Returns:
        New list of ``ChunkRecord`` objects with ``summary`` populated.
    """
    semaphore = asyncio.Semaphore(max_concurrent)
    client = google_genai.Client(
        vertexai=True,
        project=os.environ["GCP_PROJECT_ID"],
        location=os.environ.get("VERTEX_AI_LOCATION", "us-central1"),
    )

    summaries = await asyncio.gather(
        *[
            _summarise_single_chunk(c, client, semaphore, rate_limiter=rate_limiter)
            for c in chunks
        ]
    )

    return [
        c.model_copy(update={"summary": s})
        for c, s in zip(chunks, summaries)
    ]


# ---------------------------------------------------------------------------
# Firestore persistence helpers
# ---------------------------------------------------------------------------


def _chunked(lst: list, size: int) -> Iterator[list]:
    """Yield successive sublists of length ``size``."""
    for i in range(0, len(lst), size):
        yield lst[i : i + size]


async def _write_chunks_to_firestore(
    db: firestore.AsyncClient,
    chunks: list[ChunkRecord],
) -> None:
    """Persist chunks to Firestore in batches of 500 (Firestore limit)."""
    batches = list(_chunked(chunks, 500))
    if not batches:
        return
    if len(batches) == 1:
        batch = db.batch()
        for chunk in batches[0]:
            ref = (
                db.collection("sessions")
                .document(chunk.session_id)
                .collection("chunks")
                .document(chunk.chunk_id)
            )
            batch.set(ref, chunk.model_dump())
        await batch.commit()
        logger.info("Wrote %d chunks to Firestore (1 batch)", len(chunks))
    else:
        t0 = time.monotonic()
        for i, batch_chunks in enumerate(batches, 1):
            batch = db.batch()
            for chunk in batch_chunks:
                ref = (
                    db.collection("sessions")
                    .document(chunk.session_id)
                    .collection("chunks")
                    .document(chunk.chunk_id)
                )
                batch.set(ref, chunk.model_dump())
            await batch.commit()
            logger.info("Chunk batch %d/%d committed (%d ops)", i, len(batches), len(batch_chunks))
        logger.info("Wrote %d chunks in %d batches (%.2fs)", len(chunks), len(batches), time.monotonic() - t0)


async def _write_scene_briefs_to_firestore(
    db: firestore.AsyncClient,
    session_id: str,
    scene_briefs: list[SceneBrief],
) -> None:
    """Persist scene briefs to Firestore as a single document.

    Written to ``/sessions/{session_id}/sceneSelections/briefs``.

    Args:
        db: Async Firestore client.
        session_id: Owning session identifier.
        scene_briefs: List of scene briefs produced by the Narrative Curator.
    """
    ref = (
        db.collection("sessions")
        .document(session_id)
        .collection("sceneSelections")
        .document("briefs")
    )
    await ref.set({"briefs": [b.model_dump() for b in scene_briefs]})
    logger.info(
        "Wrote %d scene briefs to Firestore for session %s",
        len(scene_briefs),
        session_id,
    )


# ---------------------------------------------------------------------------
# Embedding helpers (RAG preparation — runs in background after chunk writes)
# ---------------------------------------------------------------------------


async def _embed_chunk_summaries(
    chunks: list[ChunkRecord],
    genai_client: google_genai.Client,
    semaphore: asyncio.Semaphore,  # kept for call-site compatibility; unused
) -> list[ChunkRecord]:
    """Embed chunk summaries in batches of 250 using gemini-embedding-2-preview.

    Runs all batches concurrently. Returns chunks with ``embedding`` populated.
    Failed batches leave affected chunks with ``embedding=None`` (skipped silently).
    """
    from google.genai import types as genai_types

    _MAX_BATCH = 250

    # Tag each chunk with its index so results can be aligned after batching
    indexed: list[tuple[int, str]] = [
        (i, c.summary or c.raw_text[:2000]) for i, c in enumerate(chunks)
    ]

    if not indexed:
        return chunks

    batches = list(_chunked(indexed, _MAX_BATCH))
    logger.info("Embedding %d chunks in %d batch(es)", len(chunks), len(batches))

    async def _embed_batch(batch: list[tuple[int, str]]) -> list[tuple[int, list[float]]]:
        indices, texts = zip(*batch)
        try:
            resp = await genai_client.aio.models.embed_content(
                model="gemini-embedding-2-preview",
                contents=list(texts),
                config=genai_types.EmbedContentConfig(
                    task_type="RETRIEVAL_DOCUMENT",
                    output_dimensionality=768,
                ),
            )
            return [(idx, emb.values) for idx, emb in zip(indices, resp.embeddings)]
        except Exception as exc:  # noqa: BLE001
            logger.warning("Batch embedding failed (%d chunks): %s", len(batch), exc)
            return []

    all_results = await asyncio.gather(*[_embed_batch(b) for b in batches])
    embedding_map: dict[int, list[float]] = {idx: vec for batch in all_results for idx, vec in batch}

    updated = [
        c.model_copy(update={"embedding": embedding_map.get(i)})
        for i, c in enumerate(chunks)
    ]
    successful = sum(1 for c in updated if c.embedding is not None)
    logger.info("Embedded %d/%d chunks successfully", successful, len(chunks))
    return updated


async def _write_embeddings_to_firestore(
    db: firestore.AsyncClient,
    chunks: list[ChunkRecord],
) -> None:
    """Write Vector embeddings to Firestore in batches of 500."""
    from google.cloud.firestore_v1.vector import Vector  # type: ignore[import]

    to_write = [c for c in chunks if c.embedding is not None]
    if not to_write:
        logger.warning("No embeddings to write — all chunks failed embedding step")
        return

    batches = list(_chunked(to_write, 500))
    if len(batches) == 1:
        batch = db.batch()
        for chunk in batches[0]:
            ref = (
                db.collection("sessions")
                .document(chunk.session_id)
                .collection("chunks")
                .document(chunk.chunk_id)
            )
            batch.update(ref, {"embedding": Vector(chunk.embedding)})
        await batch.commit()
        logger.info("Wrote embeddings for %d/%d chunks (1 batch)", len(to_write), len(chunks))
    else:
        t0 = time.monotonic()
        for i, batch_chunks in enumerate(batches, 1):
            batch = db.batch()
            for chunk in batch_chunks:
                ref = (
                    db.collection("sessions")
                    .document(chunk.session_id)
                    .collection("chunks")
                    .document(chunk.chunk_id)
                )
                batch.update(ref, {"embedding": Vector(chunk.embedding)})
            await batch.commit()
            logger.info("Embedding batch %d/%d committed (%d ops)", i, len(batches), len(batch_chunks))
        logger.info("Wrote embeddings for %d/%d chunks in %d batches (%.2fs)",
                    len(to_write), len(chunks), len(batches), time.monotonic() - t0)


async def _embed_and_write_background(
    db: firestore.AsyncClient,
    chunks: list[ChunkRecord],
    genai_client: google_genai.Client,
) -> None:
    """Fire-and-forget coroutine: embed chunks then persist vectors.

    Designed to run as an asyncio.Task so it does not block Phase II from
    starting. Errors are caught and logged — never propagated.
    """
    try:
        sem = asyncio.Semaphore(10)
        chunks_with_embeddings = await _embed_chunk_summaries(chunks, genai_client, sem)
        await _write_embeddings_to_firestore(db, chunks_with_embeddings)
        logger.info(
            "Background embedding complete for session %s",
            chunks[0].session_id if chunks else "unknown",
        )
    except Exception as exc:  # noqa: BLE001
        logger.error("Background embedding task failed: %s", exc, exc_info=True)


# ---------------------------------------------------------------------------
# Document Map builder
# ---------------------------------------------------------------------------


def _build_document_map(chunks: list[ChunkRecord]) -> str:
    """Build a human-readable Document Map from summarised chunks.

    The map is consumed by the Narrative Curator agent via ADK template
    substitution (``{document_map}``). Each entry includes the chunk
    identifier, heading, page span, and summary.

    Args:
        chunks: Ordered list of chunks with summaries populated.

    Returns:
        Formatted multi-line string suitable for LLM context.
    """
    parts: list[str] = []
    for chunk in chunks:
        heading = chunk.heading or "(untitled section)"
        summary = chunk.summary or "(no summary)"
        parts.append(
            f"[{chunk.chunk_id} -- {heading}]  "
            f"(pp. {chunk.page_start}-{chunk.page_end})\n"
            f"{summary}\n"
        )
    return "\n".join(parts)


# ---------------------------------------------------------------------------
# JSON extraction helper
# ---------------------------------------------------------------------------


def _extract_json(text: str) -> dict[str, Any]:
    """Extract a JSON object from LLM output, stripping markdown fences.

    Handles the common pattern where Gemini wraps JSON in
    ````json ... ``` `` markers despite being instructed not to.

    Args:
        text: Raw LLM response text.

    Returns:
        Parsed dictionary.

    Raises:
        json.JSONDecodeError: If the cleaned text is not valid JSON.
    """
    cleaned = text.strip()
    # Strip ```json ... ``` fences
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    return json.loads(cleaned)


# ---------------------------------------------------------------------------
# Step 4 -- Narrative Curator (ADK Agent)
# ---------------------------------------------------------------------------

_NARRATIVE_CURATOR_INSTRUCTION: str = """\
You are the Narrative Curator for an AI-generated historical documentary.

You receive a Document Map -- a structured summary of every section in a
historical document -- and an optional Visual Bible seed describing the
desired visual style.

Document Map:
{document_map}

Visual Bible Seed:
{visual_bible_seed}

YOUR TASK:
Select approximately {recommended_scene_count} cinematically compelling moments
(guidance based on document length; stay within 2–4 scenes total). Prioritise:
  - Narrative turning points that create dramatic tension
  - High-contrast scenes (conflict, transformation, revelation)
  - Visually specific moments (described settings, objects, weather, light)
  - Emotionally resonant passages (loss, triumph, wonder, dread)

For each selected moment, produce a SceneBrief with these exact fields:
  - scene_id: string (e.g. "scene_001")
  - title: string (working title for the scene)
  - document_excerpt: string (verbatim key passage from the source that anchors this scene)
  - source_chunk_ids: array of strings (chunk IDs containing relevant material)
  - era: string (time period, as specific as the document allows)
  - location: string (geographic setting)
  - key_entities: array of strings (people, objects, events central to this scene)
  - narrative_role: one of "opening", "rising_action", "climax", "resolution", "coda"
  - cinematic_hook: string (one sentence explaining why this scene works visually)
  - mood: string (emotional register, e.g. "solemn", "triumphant", "foreboding")

Also produce a "visual_bible" string: a comprehensive Imagen 3 style guide
that unifies the Visual Bible Seed with details discovered in the document.
Include era-appropriate colour palettes, lighting conventions, material
textures, composition rules, and any anachronisms to avoid.

Output a single JSON object with exactly two keys:
{
  "scene_briefs": [ ... array of SceneBrief objects ... ],
  "visual_bible": "... comprehensive style guide string ..."
}

Output ONLY the JSON object -- no markdown fences, no preamble.
"""

def _make_narrative_curator() -> Agent:
    """Create a fresh narrative_curator Agent each call — ADK agents cannot be shared across pipeline instances."""
    return Agent(
        name="narrative_curator",
        model="gemini-2.0-flash",
        description=(
            "Reads the full Document Map and selects 2-4 cinematically compelling "
            "scenes, producing structured SceneBriefs and a Visual Bible."
        ),
        instruction=_NARRATIVE_CURATOR_INSTRUCTION,
        output_key="narrative_curator_output",
    )


# ---------------------------------------------------------------------------
# DocumentAnalyzerAgent -- Phase I orchestrator
# ---------------------------------------------------------------------------


class DocumentAnalyzerAgent(BaseAgent):
    """Phase I orchestrator: OCR, Semantic Chunk, Parallel Summarise, Narrative Curator.

    This is a custom ``BaseAgent`` subclass that coordinates four sequential
    steps, mixing direct Python logic (OCR, chunking, summarisation) with an
    ADK sub-agent (Narrative Curator). It writes all intermediate and final
    results to ``session.state`` and Firestore, emitting SSE progress events
    at each stage for the frontend Expedition Log.

    Configuration is injected via the ``build_document_analyzer`` factory
    which reads environment variables.
    """

    model_config = ConfigDict(arbitrary_types_allowed=True)

    processor_name: str = Field(
        ...,
        description="Fully-qualified Document AI processor resource name.",
    )
    gcs_bucket: str = Field(
        ...,
        description="GCS bucket name for OCR text storage (no gs:// prefix).",
    )
    firestore_project: str = Field(
        ...,
        description="GCP project ID for Firestore operations.",
    )
    emitter: Any = Field(
        default=None,
        description="Optional SSE emitter for frontend progress events.",
    )
    rate_limiter: Any = Field(
        default=None,
        description="Optional GlobalRateLimiter for Gemini API call concurrency control.",
    )
    max_concurrent_summaries: int = Field(
        default=10,
        description="Maximum parallel Gemini calls during chunk summarisation.",
    )
    sub_agents: list[BaseAgent] = Field(
        default_factory=list,
        description="ADK sub-agents (populated by build_document_analyzer).",
    )

    async def _run_async_impl(
        self,
        ctx: InvocationContext,
    ) -> AsyncGenerator[Any, None]:
        """Execute the full Phase I pipeline.

        Yields ADK events from the Narrative Curator sub-agent. All other
        steps are direct async Python and communicate results via
        ``ctx.session.state`` writes and Firestore persistence.
        """
        session_id: str = ctx.session.id
        t_start = time.monotonic()

        # ------------------------------------------------------------------
        # Phase announcement
        # ------------------------------------------------------------------
        if self.emitter is not None:
            await self.emitter.emit(
                "pipeline_phase",
                build_pipeline_phase_event(
                    phase=1,
                    label="TRANSLATION & SCAN",
                    message="Analysing uploaded document with Document AI OCR",
                ),
            )

        # ------------------------------------------------------------------
        # 1. OCR
        # ------------------------------------------------------------------
        gcs_path: str | None = ctx.session.state.get("gcs_path")
        if not gcs_path:
            raise ValueError(
                "session.state['gcs_path'] is required but was not set. "
                "Ensure the document upload step writes the GCS URI before "
                "invoking the document analyzer."
            )

        if self.emitter is not None:
            await self.emitter.emit(
                "agent_status",
                build_agent_status_event(
                    agent_id="document_analyzer",
                    status="searching",
                    query="Running OCR on uploaded document",
                ),
            )

        t_ocr_start = time.monotonic()
        ocr_text, total_pages = await _run_ocr(gcs_path, self.processor_name)
        t_ocr_elapsed = time.monotonic() - t_ocr_start
        logger.info("OCR completed in %.1fs", t_ocr_elapsed)

        gcs_ocr_path = await _upload_ocr_text(session_id, ocr_text, self.gcs_bucket)

        ctx.session.state["gcs_ocr_path"] = gcs_ocr_path
        ctx.session.state["total_pages"] = total_pages

        # ------------------------------------------------------------------
        # 2. Semantic chunking
        # ------------------------------------------------------------------
        chunks = semantic_chunk(ocr_text, session_id)

        research_mode = ctx.session.state.get("research_mode", "normal")

        # In test mode, only keep the first 6 chunks to minimise API calls
        if research_mode == "test" and len(chunks) > 6:
            logger.info("Test mode: trimming %d chunks to 6", len(chunks))
            chunks = chunks[:6]

        total_chunks = len(chunks)
        if research_mode == "test":
            recommended_scene_count = 1
        else:
            recommended_scene_count = min(max(2, total_chunks // 3), 4)
        ctx.session.state["recommended_scene_count"] = recommended_scene_count
        logger.info("Dynamic scene count: %d chunks -> %d recommended scenes (mode=%s)", total_chunks, recommended_scene_count, research_mode)

        if self.emitter is not None:
            await self.emitter.emit(
                "stats_update",
                {
                    "type": "stats_update",
                    "sourcesFound": len(chunks),
                },
            )

        # ------------------------------------------------------------------
        # 3. Parallel summarisation
        # ------------------------------------------------------------------
        if self.emitter is not None:
            await self.emitter.emit(
                "agent_status",
                build_agent_status_event(
                    agent_id="document_analyzer",
                    status="evaluating",
                    query=f"Summarising {len(chunks)} document sections in parallel",
                ),
            )

        t_sum_start = time.monotonic()
        chunks_with_summaries = await _summarise_all_chunks(
            chunks,
            self.max_concurrent_summaries,
            rate_limiter=self.rate_limiter,
        )
        t_sum_elapsed = time.monotonic() - t_sum_start
        logger.info(
            "Summarised %d chunks in %.1fs",
            len(chunks_with_summaries),
            t_sum_elapsed,
        )

        # ------------------------------------------------------------------
        # Firestore persistence -- chunks
        # ------------------------------------------------------------------
        db = firestore.AsyncClient(project=self.firestore_project)
        await _write_chunks_to_firestore(db, chunks_with_summaries)

        # Embed chunk summaries in the background — does not block Phase II.
        # Vectors will be ready in Firestore before the user opens the live session.
        _embed_bg_client = google_genai.Client(
            vertexai=True,
            project=os.environ["GCP_PROJECT_ID"],
            location=os.environ.get("VERTEX_AI_LOCATION", "us-central1"),
        )
        _embed_task = asyncio.create_task(
            _embed_and_write_background(db, chunks_with_summaries, _embed_bg_client)
        )
        # Keep reference so GC doesn't cancel it
        ctx.session.state["_embedding_task_ref"] = id(_embed_task)

        # ------------------------------------------------------------------
        # Build Document Map for downstream agents
        # ------------------------------------------------------------------
        document_map_text = _build_document_map(chunks_with_summaries)
        ctx.session.state["document_map"] = document_map_text
        ctx.session.state["visual_bible_seed"] = ctx.session.state.get(
            "visual_bible_seed", ""
        )

        # ------------------------------------------------------------------
        # 4. Narrative Curator (ADK sub-agent)
        # ------------------------------------------------------------------
        if self.emitter is not None:
            await self.emitter.emit(
                "agent_status",
                build_agent_status_event(
                    agent_id="narrative_curator",
                    status="searching",
                    query="Selecting cinematically compelling scenes from the document",
                ),
            )

        t_curator_start = time.monotonic()
        async for event in self.sub_agents[0].run_async(ctx):
            yield event
        t_curator_elapsed = time.monotonic() - t_curator_start

        # ------------------------------------------------------------------
        # Parse Narrative Curator output
        # ------------------------------------------------------------------
        raw_output: str = ctx.session.state.get("narrative_curator_output", "")
        try:
            parsed = _extract_json(raw_output)
        except (json.JSONDecodeError, ValueError) as exc:
            logger.error(
                "Failed to parse Narrative Curator output as JSON: %s", exc
            )
            raise RuntimeError(
                f"Narrative Curator produced invalid JSON: {exc}"
            ) from exc

        # Build SceneBrief objects with per-item error tolerance
        scene_briefs: list[SceneBrief] = []
        raw_briefs: list[dict[str, Any]] = parsed.get("scene_briefs", [])
        for idx, brief_data in enumerate(raw_briefs):
            try:
                scene_briefs.append(SceneBrief(**brief_data))
            except Exception as exc:
                logger.warning(
                    "Skipping malformed scene brief at index %d: %s",
                    idx,
                    exc,
                )

        if not scene_briefs:
            logger.error(
                "Narrative Curator produced zero valid scene briefs from %d raw entries",
                len(raw_briefs),
            )

        visual_bible: str = parsed.get("visual_bible", "")

        # Write results to session state
        ctx.session.state["scene_briefs"] = [b.model_dump() for b in scene_briefs]
        ctx.session.state["visual_bible"] = visual_bible

        # ------------------------------------------------------------------
        # Firestore persistence -- scene briefs
        # ------------------------------------------------------------------
        await _write_scene_briefs_to_firestore(db, session_id, scene_briefs)

        # ------------------------------------------------------------------
        # Completion SSE events
        # ------------------------------------------------------------------
        t_total_elapsed = time.monotonic() - t_start

        if self.emitter is not None:
            await self.emitter.emit(
                "agent_status",
                build_agent_status_event(
                    agent_id="narrative_curator",
                    status="done",
                    query="Curating narrative arc from document analysis",
                    elapsed=round(t_curator_elapsed, 1),
                    facts=[b.title for b in scene_briefs],
                ),
            )
            await self.emitter.emit(
                "agent_status",
                build_agent_status_event(
                    agent_id="document_analyzer",
                    status="done",
                    query="Analyzing document structure and extracting scenes",
                    elapsed=round(t_total_elapsed, 1),
                    facts=[
                        f"{total_pages} pages processed",
                        f"{len(chunks_with_summaries)} chunks extracted",
                        f"{len(scene_briefs)} scenes selected",
                    ],
                ),
            )

        logger.info(
            "Phase I complete for session %s: %d pages, %d chunks, "
            "%d scene briefs in %.1fs",
            session_id,
            total_pages,
            len(chunks_with_summaries),
            len(scene_briefs),
            t_total_elapsed,
        )


# ---------------------------------------------------------------------------
# Factory function
# ---------------------------------------------------------------------------


def build_document_analyzer(
    emitter: SSEEmitter | None = None,
    rate_limiter: GlobalRateLimiter | None = None,
) -> DocumentAnalyzerAgent:
    """Construct a ``DocumentAnalyzerAgent`` from environment variables.

    Required environment variables:
        - ``DOCUMENT_AI_PROCESSOR_NAME``: Fully-qualified Document AI
          processor resource name (e.g.
          ``projects/123/locations/us/processors/abc``).
        - ``GCS_BUCKET_NAME``: GCS bucket for storing OCR output.
        - ``GCP_PROJECT_ID``: Google Cloud project ID for Firestore.

    Args:
        emitter: Optional SSE emitter for frontend progress events.
        rate_limiter: Optional ``GlobalRateLimiter`` for Gemini API call
            concurrency control during parallel chunk summarisation.

    Returns:
        Configured ``DocumentAnalyzerAgent`` ready for pipeline integration.
    """
    return DocumentAnalyzerAgent(
        name="document_analyzer",
        description=(
            "Phase I: OCR -> Semantic Chunk -> Parallel Summarize "
            "-> Narrative Curator scene selection."
        ),
        processor_name=os.environ["DOCUMENT_AI_PROCESSOR_NAME"],
        gcs_bucket=os.environ["GCS_BUCKET_NAME"],
        firestore_project=os.environ["GCP_PROJECT_ID"],
        emitter=emitter,
        rate_limiter=rate_limiter,
        sub_agents=[_make_narrative_curator()],
    )
