"""Phase II of the AI Historian documentary pipeline: Scene Research.

Orchestrates parallel per-scene research, where each scene's agent
corroborates the specific historical claims found in its source document
chunks rather than performing generic era research.

Architecture
------------
``SceneResearchOrchestrator`` is a custom ``BaseAgent`` subclass. It:

1. Reads the ``scene_briefs`` list from ``session.state`` (written by Phase I).
2. Fetches the full raw text of each scene's source chunks from Firestore in
   parallel using ``asyncio.gather``.
3. Injects the per-scene context into ``session.state`` as
   ``scene_{i}_brief`` and ``scene_{i}_chunks`` so that ADK's template
   substitution makes them available inside each sub-agent instruction.
4. Dynamically builds a ``ParallelAgent`` with one ``google_search``-only
   ADK ``Agent`` per scene.
5. Runs the ``ParallelAgent`` via ``run_async(ctx)`` and yields every ADK
   event upstream.

Each research sub-agent writes its output to ``session.state["research_{i}"]``
using the same JSON schema expected by the downstream ``aggregator_agent``::

    {
      "sources":          [...],
      "accepted_sources": [...],
      "rejected_sources": [...],
      "facts":            [...],
      "visual_prompt":    "..."
    }

This output key naming (``research_0``, ``research_1`` …) ensures backward
compatibility with the aggregator without requiring changes to that agent.

Session state contract
----------------------
**Inputs** (must be set before Phase II runs):
    - ``session.state["scene_briefs"]``  — ``list[dict]`` of serialised
      ``SceneBrief`` objects written by Phase I.
    - ``session.state["visual_bible"]``  — Imagen 3 style guide written
      by the Narrative Curator in Phase I.
    - ``session.state["document_map"]``  — Full document outline written
      by Phase I.

**Outputs** (written by this agent):
    - ``session.state["research_{n}"]``  — Per-scene JSON research result
      for ``n`` in ``range(len(scene_briefs))``.
    - ``session.state["scene_{n}_brief"]``  — JSON-serialised ``SceneBrief``
      injected for ADK template resolution (not consumed by downstream agents
      directly).
    - ``session.state["scene_{n}_chunks"]``  — Concatenated raw chunk texts
      for scene ``n``, injected for ADK template resolution.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from collections.abc import AsyncGenerator
from typing import Any

from google.adk.agents import Agent
from google.adk.agents.base_agent import BaseAgent
from google.adk.agents.invocation_context import InvocationContext
from google.adk.agents.parallel_agent import ParallelAgent
from google.adk.tools import google_search
from google.cloud import firestore
from pydantic import ConfigDict, Field

from .chunk_types import SceneBrief
from .sse_helpers import SSEEmitter, build_agent_status_event, build_pipeline_phase_event

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Firestore helpers
# ---------------------------------------------------------------------------


async def _fetch_single_chunk_text(
    db: firestore.AsyncClient,
    session_id: str,
    chunk_id: str,
) -> str:
    """Fetch the ``raw_text`` field of a single chunk document from Firestore.

    Args:
        db: Async Firestore client.
        session_id: Session that owns the chunk.
        chunk_id: Document ID of the chunk (e.g. ``"chunk_003"``).

    Returns:
        The ``raw_text`` string, or an empty string if the document does not
        exist or has no ``raw_text`` field.
    """
    ref = (
        db.collection("sessions")
        .document(session_id)
        .collection("chunks")
        .document(chunk_id)
    )
    snap = await ref.get()
    if snap.exists:
        return (snap.to_dict() or {}).get("raw_text", "")
    logger.warning(
        "Chunk %s not found in Firestore for session %s", chunk_id, session_id
    )
    return ""


async def _fetch_chunk_texts(
    db: firestore.AsyncClient,
    session_id: str,
    chunk_ids: list[str],
) -> str:
    """Fetch and concatenate raw texts for a list of chunk IDs.

    Fetches all chunks in parallel via ``asyncio.gather``, then joins them in
    ascending ``chunk_id`` order separated by a horizontal rule so the agent
    can read them as distinct document sections.

    Args:
        db: Async Firestore client.
        session_id: Session that owns the chunks.
        chunk_ids: Ordered list of chunk IDs to fetch.

    Returns:
        Concatenated chunk texts (sections separated by ``---``), or an empty
        string if *chunk_ids* is empty or all fetches returned nothing.
    """
    if not chunk_ids:
        return ""

    raw_texts: list[str] = await asyncio.gather(
        *[_fetch_single_chunk_text(db, session_id, cid) for cid in chunk_ids]
    )

    # Sort by chunk_id to preserve document order regardless of input order
    pairs = sorted(zip(chunk_ids, raw_texts), key=lambda p: p[0])
    return "\n\n---\n\n".join(text for _, text in pairs if text)


# ---------------------------------------------------------------------------
# Agent instruction builder
# ---------------------------------------------------------------------------

def _build_researcher_instruction(scene_index: int) -> str:
    """Build the instruction string for scene research agent ``scene_index``.

    Uses f-string escaping to embed ADK template variable references:
    ``{{scene_0_brief}}`` in the f-string produces ``{scene_0_brief}`` in the
    output string, which ADK resolves from ``session.state`` at runtime.

    Args:
        scene_index: Zero-based index of the scene (matches state key suffix).

    Returns:
        Full instruction string for the ADK ``Agent``.
    """
    i = scene_index
    return f"""\
You are a historical research specialist working on an AI-generated documentary.
Your job is to corroborate the SPECIFIC claims found in a scene's source document
excerpt using targeted web searches — not to do general era research.

═══════════════════════════════════════════════════════════
SCENE BRIEF (the planned documentary scene):
═══════════════════════════════════════════════════════════
{{scene_{i}_brief}}

═══════════════════════════════════════════════════════════
SOURCE DOCUMENT EXCERPT (verbatim text from the historical document):
═══════════════════════════════════════════════════════════
{{scene_{i}_chunks}}

═══════════════════════════════════════════════════════════
VISUAL BIBLE:
═══════════════════════════════════════════════════════════
{{visual_bible}}

════════════════════════════════════════════════════════════════════════════════
YOUR TASK
════════════════════════════════════════════════════════════════════════════════

Read the SOURCE DOCUMENT EXCERPT carefully. Identify every specific claim,
named person, named place, event, and date mentioned in it. These are your
research targets — not broad historical topics.

STEP 1 — Build targeted search queries
For each named entity or factual claim in the excerpt:
  • Construct 2–3 search queries that are as specific as possible.
  • Always include the person/place/event name AND the era/location in each query.
  • GOOD: "Halil Pasha Ottoman governor Thessaloniki 1762 trade"
  • BAD:  "Ottoman Empire 18th century"
  • GOOD: "grain harvest Ottoman Macedonia 1760s agricultural records"
  • BAD:  "Ottoman agriculture history"

STEP 2 — Search and evaluate each source
For each search result:
  • ACCEPT if it provides specific factual information that corroborates or
    expands on what is stated in the document excerpt.
  • REJECT if it is generic, off-topic, contradictory without evidence, or
    anachronistic.
  • Prefer: archival databases, academic journals, primary-source transcriptions,
    museum catalogues, period photographs, official records.
  • Avoid: tourist sites, opinion pieces, AI-generated content, undated Wikipedia stubs.
  • One-line reason required for both accepted and rejected sources.

STEP 3 — Extract key historical facts
From accepted sources only, extract minimum 3 historical facts that are:
  • Specific (names, dates, quantities, descriptions — not generalisations)
  • Directly relevant to the scene depicted in the Scene Brief
  • Different from facts already stated in the source excerpt

STEP 4 — Build a detailed Imagen 3 visual prompt
Combine the Scene Brief's cinematic hook and mood with the period-accurate
details found in accepted sources. Produce a single flowing paragraph:
  • Open with the Visual Bible style prefix
  • Describe the exact scene (setting, subjects, action, light, atmosphere)
  • Incorporate specific period-accurate details from your research
    (materials, clothing, architecture, palette, lighting conditions)
  • 16:9 composition, no modern elements or anachronisms
  • 100–200 words of flowing descriptive text (no bullet points)

═══════════════════════════════════════════════════════════
OUTPUT FORMAT (JSON only — no markdown fences, no preamble)
═══════════════════════════════════════════════════════════
{{ "sources": ["source title or URL for each search performed"],
  "accepted_sources": ["accepted source: <title> — <one-line reason>"],
  "rejected_sources": ["rejected source: <title> — <one-line reason>"],
  "facts": ["fact 1", "fact 2", "fact 3"],
  "visual_prompt": "In the style of [Visual Bible prefix]. A wide establishing shot of ..."
}}
"""


# ---------------------------------------------------------------------------
# Dynamic ParallelAgent builder
# ---------------------------------------------------------------------------


def _build_parallel_research(num_scenes: int) -> ParallelAgent:
    """Construct a ``ParallelAgent`` with one ``google_search`` agent per scene.

    Each sub-agent reads its scene brief and chunk texts from ``session.state``
    via ADK template substitution and writes its result to
    ``session.state["research_{i}"]``.

    ADK constraint: ``google_search`` cannot be combined with any other tool
    in a single ``Agent``. These agents are search-only by design.

    Args:
        num_scenes: Number of scenes to research (one agent per scene).

    Returns:
        ``ParallelAgent`` ready to be run via ``parallel.run_async(ctx)``.
    """
    sub_agents: list[Agent] = [
        Agent(
            name=f"scene_researcher_{i}",
            model="gemini-2.0-flash",
            description=(
                f"Researches scene {i}: corroborates specific historical claims "
                f"from the source document excerpt using google_search."
            ),
            instruction=_build_researcher_instruction(i),
            tools=[google_search],
            output_key=f"research_{i}",
        )
        for i in range(num_scenes)
    ]

    return ParallelAgent(
        name="scene_research_parallel",
        sub_agents=sub_agents,
        description=(
            "Parallel scene research: one dedicated google_search agent per "
            "scene, each corroborating the specific claims in its source chunks."
        ),
    )


# ---------------------------------------------------------------------------
# SceneResearchOrchestrator — Phase II BaseAgent
# ---------------------------------------------------------------------------


class SceneResearchOrchestrator(BaseAgent):
    """Phase II orchestrator: Firestore chunk fetch → parallel scene research.

    Reads ``scene_briefs`` from ``session.state``, fetches each scene's
    source chunk texts from Firestore in parallel, injects all per-scene
    context into ``session.state`` for ADK template resolution, then runs
    a dynamically constructed ``ParallelAgent`` of ``google_search``-only
    agents — one per scene.

    Results land in ``session.state["research_{n}"]`` for every n in
    ``range(len(scene_briefs))``, matching the format expected by the
    downstream ``aggregator_agent``.
    """

    model_config = ConfigDict(arbitrary_types_allowed=True)

    firestore_project: str = Field(
        ...,
        description="GCP project ID for Firestore operations.",
    )
    emitter: SSEEmitter | None = Field(
        default=None,
        description="Optional SSE emitter for frontend progress events.",
    )
    sub_agents: list[BaseAgent] = Field(
        default_factory=list,
        description=(
            "Populated dynamically at runtime inside _run_async_impl. "
            "Empty at construction time — N is only known after Phase I."
        ),
    )

    async def _run_async_impl(
        self,
        ctx: InvocationContext,
    ) -> AsyncGenerator[Any, None]:
        """Execute Phase II: load scene briefs, fetch chunks, run researchers.

        Yields every ADK event produced by the downstream ``ParallelAgent``
        so the ADK runtime can track sub-agent progress correctly.
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
                    phase=2,
                    label="FIELD RESEARCH",
                    message="Corroborating historical claims across all scenes",
                ),
            )

        # ------------------------------------------------------------------
        # Load and validate scene briefs from Phase I output
        # ------------------------------------------------------------------
        scene_briefs_raw: list[dict[str, Any]] = ctx.session.state.get(
            "scene_briefs", []
        )
        if not scene_briefs_raw:
            logger.error(
                "Phase II: session.state['scene_briefs'] is empty for session %s. "
                "Ensure Phase I (DocumentAnalyzerAgent) completed successfully.",
                session_id,
            )
            return

        scene_briefs: list[SceneBrief] = []
        for idx, raw in enumerate(scene_briefs_raw):
            try:
                scene_briefs.append(SceneBrief(**raw))
            except Exception as exc:
                logger.warning(
                    "Skipping malformed SceneBrief at index %d: %s", idx, exc
                )

        num_scenes = len(scene_briefs)
        if num_scenes == 0:
            logger.error(
                "Phase II: all %d SceneBriefs were malformed for session %s.",
                len(scene_briefs_raw),
                session_id,
            )
            return

        logger.info(
            "Phase II: %d valid scene briefs loaded for session %s",
            num_scenes,
            session_id,
        )

        if self.emitter is not None:
            await self.emitter.emit(
                "agent_status",
                build_agent_status_event(
                    agent_id="scene_research_orchestrator",
                    status="searching",
                    query=f"Loading source chunks for {num_scenes} scenes from Firestore",
                ),
            )

        # ------------------------------------------------------------------
        # Fetch chunk texts from Firestore — all scenes in parallel
        # ------------------------------------------------------------------
        db = firestore.AsyncClient(project=self.firestore_project)
        t_fetch_start = time.monotonic()

        chunk_texts: list[str] = await asyncio.gather(
            *[
                _fetch_chunk_texts(db, session_id, brief.source_chunk_ids)
                for brief in scene_briefs
            ]
        )

        t_fetch_elapsed = time.monotonic() - t_fetch_start
        logger.info(
            "Fetched chunk texts for %d scenes in %.1fs",
            num_scenes,
            t_fetch_elapsed,
        )

        # ------------------------------------------------------------------
        # Inject per-scene context into session.state for ADK template
        # resolution. Each key is referenced as {scene_N_brief} and
        # {scene_N_chunks} in the sub-agent instructions.
        # ------------------------------------------------------------------
        for i, (brief, chunks_text) in enumerate(zip(scene_briefs, chunk_texts)):
            ctx.session.state[f"scene_{i}_brief"] = json.dumps(
                brief.model_dump(), indent=2, ensure_ascii=False
            )
            ctx.session.state[f"scene_{i}_chunks"] = (
                chunks_text if chunks_text else "(no source chunk text found)"
            )

        # Announce each scene agent as queued now that context is ready
        if self.emitter is not None:
            for i, brief in enumerate(scene_briefs):
                await self.emitter.emit(
                    "agent_status",
                    build_agent_status_event(
                        agent_id=f"scene_researcher_{i}",
                        status="queued",
                        query=brief.title,
                    ),
                )

        # ------------------------------------------------------------------
        # Build the parallel agent and flip all scenes to "searching"
        # ------------------------------------------------------------------
        parallel = _build_parallel_research(num_scenes)

        if self.emitter is not None:
            for i, brief in enumerate(scene_briefs):
                await self.emitter.emit(
                    "agent_status",
                    build_agent_status_event(
                        agent_id=f"scene_researcher_{i}",
                        status="searching",
                        query=brief.cinematic_hook,
                    ),
                )

        # ------------------------------------------------------------------
        # Run all scene research agents in parallel
        # ------------------------------------------------------------------
        t_research_start = time.monotonic()
        async for event in parallel.run_async(ctx):
            yield event
        t_research_elapsed = time.monotonic() - t_research_start

        logger.info(
            "Parallel scene research completed in %.1fs for session %s",
            t_research_elapsed,
            session_id,
        )

        # ------------------------------------------------------------------
        # Emit per-scene completion events and compute summary stats
        # ------------------------------------------------------------------
        completed = 0
        failed = 0

        for i, brief in enumerate(scene_briefs):
            result = ctx.session.state.get(f"research_{i}")
            if result:
                completed += 1
                if self.emitter is not None:
                    await self.emitter.emit(
                        "agent_status",
                        build_agent_status_event(
                            agent_id=f"scene_researcher_{i}",
                            status="done",
                            elapsed=round(t_research_elapsed, 1),
                        ),
                    )
            else:
                failed += 1
                logger.warning(
                    "scene_researcher_%d produced no output for session %s (scene: %s)",
                    i,
                    session_id,
                    brief.title,
                )
                if self.emitter is not None:
                    await self.emitter.emit(
                        "agent_status",
                        build_agent_status_event(
                            agent_id=f"scene_researcher_{i}",
                            status="error",
                            elapsed=round(t_research_elapsed, 1),
                        ),
                    )

        # Emit stats_update so the Expedition Log counters update
        if self.emitter is not None:
            # Count total accepted sources across all research outputs
            total_accepted = 0
            for i in range(num_scenes):
                raw_result = ctx.session.state.get(f"research_{i}", "")
                if raw_result:
                    try:
                        parsed = json.loads(
                            raw_result.strip()
                            .lstrip("```json").lstrip("```")
                            .rstrip("```")
                        )
                        total_accepted += len(parsed.get("accepted_sources", []))
                    except (json.JSONDecodeError, AttributeError):
                        pass

            await self.emitter.emit(
                "stats_update",
                {
                    "type": "stats_update",
                    "sourcesFound": total_accepted,
                },
            )

        # ------------------------------------------------------------------
        # Orchestrator completion event
        # ------------------------------------------------------------------
        t_total_elapsed = time.monotonic() - t_start

        if self.emitter is not None:
            await self.emitter.emit(
                "agent_status",
                build_agent_status_event(
                    agent_id="scene_research_orchestrator",
                    status="done",
                    elapsed=round(t_total_elapsed, 1),
                    facts=[
                        f"{completed}/{num_scenes} scenes researched successfully",
                        f"research_0 through research_{num_scenes - 1} "
                        "written to session state",
                        *(
                            [f"{failed} scene(s) failed — fallback available"]
                            if failed
                            else []
                        ),
                    ],
                ),
            )

        logger.info(
            "Phase II complete for session %s: %d/%d scenes in %.1fs",
            session_id,
            completed,
            num_scenes,
            t_total_elapsed,
        )


# ---------------------------------------------------------------------------
# Factory function
# ---------------------------------------------------------------------------


def build_scene_research_orchestrator(
    emitter: SSEEmitter | None = None,
) -> SceneResearchOrchestrator:
    """Construct a ``SceneResearchOrchestrator`` from environment variables.

    Required environment variables:
        - ``GCP_PROJECT_ID``: Google Cloud project ID for Firestore reads.

    Args:
        emitter: Optional SSE emitter for frontend progress events.

    Returns:
        Configured ``SceneResearchOrchestrator`` ready for pipeline integration.
    """
    return SceneResearchOrchestrator(
        name="scene_research_orchestrator",
        description=(
            "Phase II: Reads scene_briefs from session.state, fetches source "
            "chunk texts from Firestore, injects per-scene context, and runs "
            "one google_search ADK Agent per scene in parallel."
        ),
        firestore_project=os.environ["GCP_PROJECT_ID"],
        emitter=emitter,
    )
