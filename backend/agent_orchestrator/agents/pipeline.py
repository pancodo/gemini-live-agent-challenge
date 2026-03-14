"""ADK Pipeline -- SequentialAgent orchestrating the full documentary generation flow.

Workstream B: Per-segment streaming pipeline
---------------------------------------------
After global phases (Phase I document analysis + Phase II scene research)
complete, the pipeline switches to per-segment coroutines. Each segment
runs: Script -> FactCheck -> Geo -> VisualResearch -> Imagen3 -> emit
segment_playable -> Veo2 background.

Scene 0 runs FIRST (fastest path to first playable segment). Scenes 1-N
stagger with ``asyncio.Semaphore(2)`` for API quota safety.

Legacy pipeline (``build_pipeline``) and the batch sequential pipeline
(``ResumablePipelineAgent``) are preserved for reference and fallback.

Current pipeline order (Phases I-V fully integrated, with III.5 fact validation
and 3.8 geographic mapping):
    1. document_analyzer            -- OCR, semantic chunking, parallel summarisation,
                                      narrative curation -> scene_briefs + visual_bible
    2. scene_research_orch          -- Parallel scene research (one google_search agent
                                      per SceneBrief) -> research_0 ... research_N
    3. aggregator_agent             -- Merges all research_N outputs into unified context
    --- Per-segment from here (Workstream B) ---
    4. script generation            -- Per-scene Gemini call -> SegmentScript
   4b. fact_validator               -- Per-segment hallucination firewall
   4c. geo_location                 -- Per-segment geographic extraction
    5. narrative_visual_planner     -- Single Gemini Pro call producing VisualStoryboard
                                      (run once after first script, optional)
    6. visual_research_orch         -- Per-scene 6-stage micro-pipeline
    7. visual_director_orch         -- Per-segment Imagen 3 + Veo 2

ADK constraints:
    - google_search cannot be combined with other tools in the same Agent
    - Agent results shared via output_key -> session.state[key]
    - Downstream agents reference state via {key} template syntax in instructions
    - ParallelAgent provides no shared state during execution
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from collections.abc import AsyncGenerator
from typing import Any

from google import genai as google_genai
from google.adk.agents import Agent
from google.adk.agents.base_agent import BaseAgent
from google.adk.agents.invocation_context import InvocationContext
from google.adk.agents.parallel_agent import ParallelAgent
from google.adk.agents.sequential_agent import SequentialAgent
from google.adk.tools import google_search
from google.cloud import firestore, storage
from pydantic import ConfigDict, Field

from .checkpoint_helpers import load_checkpoint, save_checkpoint
from .document_analyzer import build_document_analyzer
from .fact_validator_agent import build_fact_validator_agent, validate_single_segment
from .geo_location_agent import build_geo_location_agent, extract_geo_for_segment
from .narrative_visual_planner import build_narrative_visual_planner
from .rate_limiter import GlobalRateLimiter
from .scene_research_agent import build_scene_research_orchestrator
from .narrative_director_agent import build_narrative_director_agent
from .script_agent_orchestrator import (
    build_script_agent_orchestrator,
    generate_single_segment,
)
from .sse_helpers import (
    SSEEmitter,
    build_agent_status_event,
    build_pipeline_phase_event,
    build_segment_playable_event,
    build_segment_update_event,
)
from .visual_director_orchestrator import build_visual_director_orchestrator
from .visual_research_agent import visual_research_agent
from .visual_research_orchestrator import build_visual_research_orchestrator

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# GCS URL signing utility
# ---------------------------------------------------------------------------

from datetime import timedelta
from google.cloud import storage as gcs_storage


def _sign_gcs_url(gcs_uri: str, bucket_name: str) -> str:
    """Convert a ``gs://`` URI to a 4-hour signed HTTPS URL.

    If *gcs_uri* does not start with ``gs://``, it is returned unchanged
    (already an HTTPS URL or other format).

    Args:
        gcs_uri: The GCS URI to sign, e.g. ``gs://bucket/path/to/blob``.
        bucket_name: The GCS bucket name (used to strip the URI prefix).

    Returns:
        A signed HTTPS URL valid for 4 hours, or the original URI if not
        a ``gs://`` path.
    """
    if not gcs_uri.startswith("gs://"):
        return gcs_uri
    blob_path = gcs_uri.replace(f"gs://{bucket_name}/", "")
    client = gcs_storage.Client()
    blob = client.bucket(bucket_name).blob(blob_path)
    return blob.generate_signed_url(
        expiration=timedelta(hours=4),
        method="GET",
        version="v4",
    )


# ---------------------------------------------------------------------------
# 1. Scan Agent
# ---------------------------------------------------------------------------
scan_agent = Agent(
    name="scan_agent",
    model="gemini-2.0-flash",
    description="Analyzes OCR'd historical document text to extract entities, visual gaps, and research queries.",
    instruction="""\
You receive an OCR'd historical document text.
Document text: {ocr_text}

Produce a JSON object with:
{
  "summary": "3-5 sentence document summary",
  "entities": ["person/place/event/date list"],
  "visual_gaps": ["things referenced but not depicted in the document"],
  "research_queries": ["one targeted query per entity/gap, minimum 5"],
  "visual_bible": "style reference for Imagen 3 prompts: era, region, palette, composition rules"
}

Be specific in research_queries -- each should be a single focused question
that google_search can answer definitively. Include era, location, and subject
in each query for maximum relevance.
""",
    output_key="scan_result",
)


# ---------------------------------------------------------------------------
# 2. Parallel Research Agents (dynamically constructed)
# ---------------------------------------------------------------------------
def build_research_agents(num_queries: int) -> ParallelAgent:
    """Build N parallel research agents, one per scan_agent query.

    Each agent uses google_search exclusively (ADK constraint: cannot combine
    with other tools). Results are written to session.state[f"research_{i}"].

    Args:
        num_queries: Number of research queries from the scan agent.

    Returns:
        A ParallelAgent wrapping all research sub-agents.
    """
    research_agents = [
        Agent(
            name=f"researcher_{i}",
            model="gemini-2.0-flash",
            description=f"Researches query {i} using Google Search with source evaluation.",
            instruction=f"""\
Research query: {{query_{i}}}
Document context: {{document_summary}}
Visual Bible style: {{visual_bible}}

1. Search the web for this query
2. Evaluate each result: accept or reject with a one-line reason
3. From accepted sources, extract minimum 3 key historical facts
4. Build a detailed Imagen 3 visual prompt:
   - Start with the Visual Bible style prefix
   - Describe scene: setting, lighting, figures, mood
   - 16:9 composition, no anachronisms
Output as JSON: {{ "sources": [...], "accepted_sources": [...], "rejected_sources": [...], "facts": [...], "visual_prompt": "..." }}
""",
            tools=[google_search],
            output_key=f"research_{i}",
        )
        for i in range(num_queries)
    ]

    return ParallelAgent(
        name="parallel_research",
        sub_agents=research_agents,
        description="Runs all research queries in parallel via Google Search.",
    )


# ---------------------------------------------------------------------------
# 3. Aggregator Agent
# ---------------------------------------------------------------------------
# References research_0 through research_9 to accommodate up to 10 scenes
# produced by the Narrative Curator (typical range: 4-8). Keys that do not
# exist in session.state are left unresolved by ADK and treated as empty
# by the model -- no error is raised for absent keys.
# ---------------------------------------------------------------------------
_AGGREGATOR_INSTRUCTION = """\
You receive research results from parallel scene research agents.
Each result is a JSON object with sources, accepted_sources, rejected_sources,
facts, and a visual_prompt. Some slots below may be empty if fewer than 10
scenes were researched -- ignore empty or unresolved entries.

Document Map (full outline of the source document):
{document_map}

Scene Briefs (the planned documentary scenes):
{scene_briefs}

Visual Bible (style guide for Imagen 3):
{visual_bible}

Research outputs (one per scene):
Scene 0: {research_0}
Scene 1: {research_1}
Scene 2: {research_2}
Scene 3: {research_3}
Scene 4: {research_4}
Scene 5: {research_5}
Scene 6: {research_6}
Scene 7: {research_7}
Scene 8: {research_8}
Scene 9: {research_9}

Merge all research into a unified context document:
1. Deduplicate facts across all scene research agents
2. Rank facts by relevance and historical significance
3. Note any contradictions between sources and flag the more reliable one
4. Compile a master list of accepted sources with citations
5. Create a unified Visual Bible enriched with details from all research,
   incorporating the original Visual Bible style preferences

Output as JSON:
{{
  "unified_facts": ["fact 1", "fact 2", ...],
  "source_citations": ["citation 1", "citation 2", ...],
  "contradictions": ["if any"],
  "enriched_visual_bible": "Comprehensive style guide combining visual_bible + research details",
  "total_sources_accepted": N,
  "total_sources_rejected": N
}}
"""


def _make_aggregator_agent() -> Agent:
    """Create a fresh aggregator Agent -- ADK agents cannot be reused across pipeline instances."""
    return Agent(
        name="aggregator_agent",
        model="gemini-2.0-flash",
        description="Merges all parallel scene research outputs into a unified research context.",
        instruction=_AGGREGATOR_INSTRUCTION,
        output_key="aggregated_research",
    )


# ---------------------------------------------------------------------------
# 4. Script Agent (legacy, kept for build_pipeline)
# ---------------------------------------------------------------------------
script_agent = Agent(
    name="script_agent",
    model="gemini-2.0-pro",
    description="Generates documentary segments grounded in scene briefs and aggregated research.",
    instruction="""\
You are the scriptwriter for an AI-generated historical documentary.

Scene Briefs (the planned scenes, grounded in the source document):
{scene_briefs}

Aggregated Research (corroborated historical facts and enriched Visual Bible):
{aggregated_research}

Generate one documentary segment per scene brief. Each segment must directly
correspond to its scene brief (same scene_id, title from the brief, same era
and location). Do not invent new scenes or reorder the narrative arc.

For each scene brief, produce a JSON segment:
{{
  "id": "segment_N",
  "scene_id": "scene_N",
  "title": "Scene title (from the brief)",
  "narration_script": "Full narration text, 60-120 seconds when spoken aloud",
  "visual_descriptions": [
    "Frame 1: detailed Imagen 3 prompt (starts with enriched_visual_bible prefix)",
    "Frame 2: ...",
    "Frame 3: ...",
    "Frame 4: ..."
  ],
  "veo2_scene": "Optional: one dramatic scene description for Veo 2 video generation",
  "mood": "cinematic | reflective | dramatic | scholarly",
  "sources": ["citation 1", "citation 2"]
}}

Ensure visual_descriptions are grounded in the research facts -- period-accurate,
no anachronisms, specific to the era and location from each scene brief.
Each visual prompt must specify: era, location, lighting, composition, subjects, mood.
""",
    output_key="script",
)


# ---------------------------------------------------------------------------
# 5. Visual Research Agent (imported from visual_research_agent.py)
# ---------------------------------------------------------------------------
# visual_research_agent is imported at module top.
# It reads {script} and {visual_bible}, outputs to session.state["visual_research"].
# Uses google_search exclusively (ADK constraint).


# ---------------------------------------------------------------------------
# 6. Visual Director Agent (legacy)
# ---------------------------------------------------------------------------
visual_director = Agent(
    name="visual_director",
    model="gemini-2.0-flash",
    description="Generates Imagen 3 images and Veo 2 videos for each documentary segment.",
    instruction="""\
You are the visual director for a historical documentary.

Script segments: {script}
Visual Bible: {visual_bible}
Visual research manifests (enriched prompts, one per scene_id): {visual_research_manifest}

Priority rule -- for each segment:
1. If session.state["visual_research_manifest"][segment.scene_id]["enriched_prompt"] exists
   and is non-empty -> use that as the SOLE Imagen 3 prompt base. It already incorporates
   period-accurate archival research. Apply the Visual Bible style prefix and 16:9 framing.
2. If no manifest exists or enriched_prompt is empty -> fall back to the segment's
   visual_descriptions from the script.

For each segment, produce:
1. Four Imagen 3 prompts (one per visual frame).
   Each prompt must:
   - Start with the Visual Bible style prefix
   - Be 100-300 words of flowing descriptive text, 16:9 composition
   - Include period-accurate details (lighting, materials, colors)
   - End with "Exclude: [era_markers from manifest if present]"
   - Contain NO modern elements or anachronisms

2. One Veo 2 prompt for the segment's dramatic scene (if veo2_scene exists).
   - 8 seconds, cinematic camera movement, same Visual Bible style

Output as JSON:
{{
  "segments": [
    {{
      "segment_id": "segment_N",
      "scene_id": "scene_N",
      "imagen_prompts": ["prompt_1", "prompt_2", "prompt_3", "prompt_4"],
      "veo2_prompt": "optional prompt for video generation",
      "used_manifest": true,
      "mood": "cinematic"
    }}
  ]
}}
""",
    output_key="visual_direction",
)


# ---------------------------------------------------------------------------
# Full Pipeline Assembly (Legacy)
# ---------------------------------------------------------------------------


def build_pipeline(num_research_queries: int = 5) -> SequentialAgent:
    """[LEGACY] Assemble the original scan-based documentary pipeline.

    Uses the old ``scan_agent`` + ``build_research_agents`` path. Kept for
    reference until all phases are fully integrated and tested.

    Args:
        num_research_queries: Number of parallel research queries (from the
            scan_agent output). Defaults to 5.

    Returns:
        A SequentialAgent running the legacy pipeline:
        scan -> parallel_research -> aggregator -> script -> visual_research
        -> visual_director
    """
    parallel_research = build_research_agents(num_research_queries)

    return SequentialAgent(
        name="historian_pipeline_legacy",
        description=(
            "Legacy documentary pipeline: scan, research, script, "
            "visual research, visual direction."
        ),
        sub_agents=[
            scan_agent,
            parallel_research,
            _make_aggregator_agent(),
            script_agent,
            visual_research_agent,
            visual_director,
        ],
    )


# ---------------------------------------------------------------------------
# ResumablePipelineAgent -- checkpoint-aware pipeline executor (batch mode)
# ---------------------------------------------------------------------------

# Phase mapping: (phase_number, [agent_indices_in_sub_agents_list])
# Agent order in sub_agents:
#   0: document_analyzer        (Phase I)
#   1: scene_research           (Phase II)
#   2: aggregator               (Phase II -- grouped with scene_research)
#   3: script_orch              (Phase III)
#   4: narrative_director       (Phase 3.1)
#   5: fact_validator           (Phase III.5)
#   6: geo_location             (Phase 3.8)
#   7: narrative_visual_planner (Phase 4.0)
#   8: visual_research_orch     (Phase IV)
#   9: visual_director_orch     (Phase V)

_PHASE_AGENT_MAP: list[tuple[int | float, list[int]]] = [
    (1,   [0]),     # Phase I:     document_analyzer
    (2,   [1, 2]),  # Phase II:    scene_research + aggregator
    (3,   [3]),     # Phase III:   script_orch
    (3.1, [4]),     # Phase 3.1:   narrative_director (Gemini TEXT+IMAGE interleaved)
    (3.5, [5]),     # Phase III.5: fact_validator
    (3.8, [6]),     # Phase 3.8:   geo_location -- Geographic Mapping
    (4,   [7]),     # Phase 4.0:   narrative_visual_planner
    (5,   [8]),     # Phase IV:    visual_research_orch
    (6,   [9]),     # Phase V:     visual_director_orch
]


class ResumablePipelineAgent(BaseAgent):
    """Checkpoint-aware pipeline executor (batch mode).

    Wraps the sequential agent list with load/save checkpoint logic.
    On startup, loads any previously completed phases from Firestore and
    restores the session state snapshot. Phases already completed are skipped.
    After each phase completes, the new session state is checkpointed.

    This allows the pipeline to resume from where it left off after a crash,
    timeout, or user-triggered retry on error.
    """

    model_config = ConfigDict(arbitrary_types_allowed=True)

    firestore_project: str = Field(
        ...,
        description="GCP project ID for Firestore checkpoint operations.",
    )
    emitter: Any = Field(
        default=None,
        description="Optional SSE emitter for frontend progress events.",
    )
    sub_agents: list[BaseAgent] = Field(
        default_factory=list,
        description="Ordered list of pipeline phase agents.",
    )

    async def _run_async_impl(
        self,
        ctx: InvocationContext,
    ) -> AsyncGenerator[Any, None]:
        """Execute pipeline phases with checkpoint persistence.

        For each phase in ``_PHASE_AGENT_MAP``:
        1. Skip if the phase is already in completed_phases.
        2. Run each agent index in the phase, yielding all ADK events.
        3. Save a checkpoint after the phase completes.
        """
        session_id: str = ctx.session.id
        t_pipeline_start = time.monotonic()

        # ------------------------------------------------------------------
        # Load checkpoint -- restore completed phases and state snapshot
        # ------------------------------------------------------------------
        db = firestore.AsyncClient(project=self.firestore_project)

        completed_phases, state_snapshot = await load_checkpoint(db, session_id)

        # Restore state from checkpoint
        if state_snapshot:
            for key, value in state_snapshot.items():
                ctx.session.state[key] = value
            logger.info(
                "Restored %d state keys from checkpoint for session %s",
                len(state_snapshot),
                session_id,
            )

        # ------------------------------------------------------------------
        # Execute phases sequentially, skipping completed ones
        # ------------------------------------------------------------------
        for phase_num, agent_indices in _PHASE_AGENT_MAP:
            if phase_num in completed_phases:
                logger.info(
                    "Skipping phase %s for session %s (already completed)",
                    phase_num,
                    session_id,
                )
                continue

            t_phase_start = time.monotonic()
            logger.info(
                "Starting phase %s for session %s",
                phase_num,
                session_id,
            )

            # Run each agent in this phase sequentially
            for agent_idx in agent_indices:
                if agent_idx >= len(self.sub_agents):
                    logger.warning(
                        "Agent index %d out of range for phase %s (have %d agents)",
                        agent_idx,
                        phase_num,
                        len(self.sub_agents),
                    )
                    continue

                agent = self.sub_agents[agent_idx]
                async for event in agent.run_async(ctx):
                    yield event

            t_phase_elapsed = time.monotonic() - t_phase_start
            logger.info(
                "Phase %s completed in %.1fs for session %s",
                phase_num,
                t_phase_elapsed,
                session_id,
            )

            # Save checkpoint after phase completion
            await save_checkpoint(db, session_id, phase_num, ctx.session.state)

        t_total = time.monotonic() - t_pipeline_start
        logger.info(
            "Resumable pipeline complete for session %s in %.1fs",
            session_id,
            t_total,
        )


# ---------------------------------------------------------------------------
# StreamingPipelineAgent -- per-segment streaming pipeline (Workstream B)
# ---------------------------------------------------------------------------

# Concurrency limits for per-segment pipeline
_SEGMENT_SEMAPHORE_LIMIT: int = 2  # Max concurrent segments processing
_GEMINI_SEMAPHORE_LIMIT: int = 6   # Max concurrent Gemini API calls


class StreamingPipelineAgent(BaseAgent):
    """Per-segment streaming pipeline executor (Workstream B).

    After global phases (Phase I document_analyzer + Phase II scene_research +
    aggregator) complete, switches to per-segment coroutines:

    For each segment:
      1. Script generation (per-scene Gemini call)
      2. Fact validation (per-segment)
      3. Geo extraction (per-segment)
      4. Visual research (per-segment, if available)
      5. Image generation (per-segment Imagen 3)
      6. Emit segment_playable
      7. Veo 2 generation (background)

    Scene 0 runs FIRST without concurrency overlap to provide the fastest
    path to the first playable segment. Session status is set to "ready"
    when Scene 0 has images. Scenes 1-N are staggered with a semaphore.
    """

    model_config = ConfigDict(arbitrary_types_allowed=True)

    firestore_project: str = Field(
        ...,
        description="GCP project ID for Firestore and Vertex AI.",
    )
    gcs_bucket_name: str = Field(
        default="",
        description="GCS bucket for generated images and videos.",
    )
    emitter: Any = Field(
        default=None,
        description="Optional SSE emitter for frontend progress events.",
    )
    gemini_limiter: Any = Field(
        default=None,
        description="GlobalRateLimiter for Gemini API calls.",
    )
    imagen_limiter: Any = Field(
        default=None,
        description="GlobalRateLimiter for Imagen 3 API calls.",
    )
    sub_agents: list[BaseAgent] = Field(
        default_factory=list,
        description="Global-phase agents: [document_analyzer, scene_research, aggregator].",
    )

    async def _run_segment_pipeline(
        self,
        *,
        scene_index: int,
        scene_brief: dict[str, Any],
        aggregated_research: str,
        visual_bible: str,
        document_map: str,
        total_scenes: int,
        session_id: str,
        segment_semaphore: asyncio.Semaphore,
    ) -> dict[str, Any] | None:
        """Run the full per-segment pipeline for one scene.

        Steps:
        1. Script generation via generate_single_segment
        2. Fact validation via validate_single_segment
        3. Geo extraction via extract_geo_for_segment
        4. Emit segment_playable (once images exist, handled by visual phases)

        Returns the validated segment dict, or None on failure.
        """
        async with segment_semaphore:
            t_start = time.monotonic()
            is_last = scene_index == total_scenes - 1
            segment_id = f"segment_{scene_index}"
            scene_id = scene_brief.get("scene_id", f"scene_{scene_index}")

            logger.info(
                "Starting per-segment pipeline for scene %d/%d (%s) session %s",
                scene_index + 1,
                total_scenes,
                scene_brief.get("title", ""),
                session_id,
            )

            # -- Step 1: Script generation ------------------------------------
            segment = await generate_single_segment(
                scene_index=scene_index,
                scene_brief=scene_brief,
                aggregated_research=aggregated_research,
                visual_bible=visual_bible,
                document_map=document_map,
                is_last_scene=is_last,
                total_scenes=total_scenes,
                session_id=session_id,
                firestore_project=self.firestore_project,
                emitter=self.emitter,
            )

            if segment is None:
                logger.error(
                    "Script generation failed for scene %d, skipping segment pipeline",
                    scene_index,
                )
                return None

            segment_dict = segment.model_dump()

            # -- Step 2: Fact validation --------------------------------------
            try:
                validated_dict, report = await validate_single_segment(
                    segment=segment_dict,
                    scene_brief=scene_brief,
                    aggregated_research=aggregated_research,
                    emitter=self.emitter,
                )
                segment_dict = validated_dict

                # Update Firestore with validated narration if changed
                if validated_dict.get("narration_script") != segment.narration_script:
                    try:
                        db = firestore.AsyncClient(project=self.firestore_project)
                        await (
                            db.collection("sessions")
                            .document(session_id)
                            .collection("segments")
                            .document(segment_id)
                            .update({
                                "script": validated_dict.get("narration_script", ""),
                            })
                        )
                    except Exception as exc:
                        logger.warning(
                            "Failed to update validated narration for %s: %s",
                            segment_id,
                            exc,
                        )
            except Exception as exc:
                logger.warning(
                    "Fact validation failed for %s, continuing with original: %s",
                    segment_id,
                    exc,
                )

            # -- Step 3: Geo extraction ---------------------------------------
            try:
                geo_data = await extract_geo_for_segment(
                    segment=segment_dict,
                    scene_brief=scene_brief,
                    session_id=session_id,
                    emitter=self.emitter,
                )
                if geo_data is not None:
                    segment_dict["geo"] = geo_data
            except Exception as exc:
                logger.warning(
                    "Geo extraction failed for %s, continuing: %s",
                    segment_id,
                    exc,
                )

            t_elapsed = round(time.monotonic() - t_start, 1)
            logger.info(
                "Per-segment pipeline (script+validate+geo) complete for "
                "scene %d in %.1fs, session %s",
                scene_index,
                t_elapsed,
                session_id,
            )

            return segment_dict

    async def _run_async_impl(
        self,
        ctx: InvocationContext,
    ) -> AsyncGenerator[Any, None]:
        """Execute the streaming pipeline: global phases then per-segment.

        1. Run global phase agents (document_analyzer, scene_research, aggregator)
           via normal ADK agent execution.
        2. Switch to per-segment coroutines for Script -> FactCheck -> Geo.
        3. Run visual phases (NarrativeVisualPlanner, VisualResearch, VisualDirector)
           using the existing batch orchestrators on the accumulated script state.
        """
        session_id: str = ctx.session.id
        t_pipeline_start = time.monotonic()

        # ------------------------------------------------------------------
        # Load checkpoint
        # ------------------------------------------------------------------
        db = firestore.AsyncClient(project=self.firestore_project)
        completed_phases, state_snapshot = await load_checkpoint(db, session_id)

        if state_snapshot:
            for key, value in state_snapshot.items():
                ctx.session.state[key] = value
            logger.info(
                "Restored %d state keys from checkpoint for session %s",
                len(state_snapshot),
                session_id,
            )

        # ------------------------------------------------------------------
        # Phase I + II: Global phases (document_analyzer + scene_research + aggregator)
        # ------------------------------------------------------------------
        global_phases: list[tuple[int | float, list[int]]] = [
            (1, [0]),     # document_analyzer
            (2, [1, 2]),  # scene_research + aggregator
        ]

        for phase_num, agent_indices in global_phases:
            if phase_num in completed_phases:
                logger.info(
                    "Skipping global phase %s for session %s (checkpoint)",
                    phase_num,
                    session_id,
                )
                continue

            t_phase_start = time.monotonic()
            logger.info(
                "Starting global phase %s for session %s",
                phase_num,
                session_id,
            )

            for agent_idx in agent_indices:
                if agent_idx < len(self.sub_agents):
                    agent = self.sub_agents[agent_idx]
                    async for event in agent.run_async(ctx):
                        yield event

            await save_checkpoint(db, session_id, phase_num, ctx.session.state)
            logger.info(
                "Global phase %s completed in %.1fs for session %s",
                phase_num,
                time.monotonic() - t_phase_start,
                session_id,
            )

        # ------------------------------------------------------------------
        # Per-segment pipeline: Script -> FactCheck -> Geo
        # ------------------------------------------------------------------
        scene_briefs: list[dict[str, Any]] = ctx.session.state.get("scene_briefs", [])
        aggregated_research: str = str(ctx.session.state.get("aggregated_research", ""))
        visual_bible: str = str(ctx.session.state.get("visual_bible", ""))
        document_map: str = str(ctx.session.state.get("document_map", ""))
        total_scenes = len(scene_briefs)

        if not scene_briefs:
            logger.error(
                "No scene_briefs found after global phases for session %s",
                session_id,
            )
            return
            yield  # noqa: unreachable

        # Check if Phase III already completed (checkpoint resume)
        if 3 not in completed_phases:
            # Emit Phase III announcement
            if self.emitter is not None:
                await self.emitter.emit(
                    "pipeline_phase",
                    build_pipeline_phase_event(
                        phase=3,
                        label="SYNTHESIS",
                        message="Writing narration per scene -- segments stream as they complete",
                    ),
                )

            segment_semaphore = asyncio.Semaphore(_SEGMENT_SEMAPHORE_LIMIT)

            # -- Scene 0 runs FIRST (no overlap) ------------------------------
            logger.info(
                "Starting Scene 0 (priority) for session %s",
                session_id,
            )

            scene_0_result = await self._run_segment_pipeline(
                scene_index=0,
                scene_brief=scene_briefs[0],
                aggregated_research=aggregated_research,
                visual_bible=visual_bible,
                document_map=document_map,
                total_scenes=total_scenes,
                session_id=session_id,
                segment_semaphore=segment_semaphore,
            )

            all_segment_dicts: list[dict[str, Any] | None] = [scene_0_result]

            # Set session status to "ready" when Scene 0 script is done
            # (visual generation happens later, but the script is playable)
            if scene_0_result is not None:
                try:
                    await (
                        db.collection("sessions")
                        .document(session_id)
                        .update({"status": "ready"})
                    )
                    logger.info(
                        "Session %s status set to 'ready' (Scene 0 scripted)",
                        session_id,
                    )
                except Exception as exc:
                    logger.warning(
                        "Failed to update session status to ready: %s", exc
                    )

            # -- Scenes 1-N run concurrently with semaphore --------------------
            if total_scenes > 1:
                logger.info(
                    "Starting scenes 1-%d concurrently for session %s",
                    total_scenes - 1,
                    session_id,
                )

                remaining_tasks = [
                    self._run_segment_pipeline(
                        scene_index=i,
                        scene_brief=scene_briefs[i],
                        aggregated_research=aggregated_research,
                        visual_bible=visual_bible,
                        document_map=document_map,
                        total_scenes=total_scenes,
                        session_id=session_id,
                        segment_semaphore=segment_semaphore,
                    )
                    for i in range(1, total_scenes)
                ]

                remaining_results = await asyncio.gather(
                    *remaining_tasks, return_exceptions=True
                )

                for result in remaining_results:
                    if isinstance(result, Exception):
                        logger.error(
                            "Per-segment pipeline error: %s", result
                        )
                        all_segment_dicts.append(None)
                    else:
                        all_segment_dicts.append(result)

            # Accumulate all segments into session state
            accumulated_scripts: list[dict[str, Any]] = []
            geo_manifest: dict[str, dict[str, Any]] = {}

            for seg_dict in all_segment_dicts:
                if seg_dict is not None:
                    accumulated_scripts.append(seg_dict)
                    if "geo" in seg_dict:
                        geo_manifest[seg_dict.get("id", "")] = seg_dict["geo"]

            ctx.session.state["script"] = accumulated_scripts
            ctx.session.state["geo_manifest"] = geo_manifest

            # Save Phase III checkpoint
            await save_checkpoint(db, session_id, 3, ctx.session.state)
            # Also mark fact validation and geo as done (ran per-segment)
            await save_checkpoint(db, session_id, 3.5, ctx.session.state)
            await save_checkpoint(db, session_id, 3.8, ctx.session.state)

            # Emit stats
            if self.emitter is not None:
                await self.emitter.emit(
                    "stats_update",
                    {
                        "type": "stats_update",
                        "segmentsReady": len(accumulated_scripts),
                    },
                )

            logger.info(
                "Per-segment pipeline complete: %d/%d segments for session %s",
                len(accumulated_scripts),
                total_scenes,
                session_id,
            )

        # ------------------------------------------------------------------
        # Visual phases: run remaining batch agents (3.1, 4.0, IV, V)
        # These run on the accumulated script state from per-segment pipeline.
        # Phase 3.5 and 3.8 are skipped (already done per-segment).
        # ------------------------------------------------------------------
        visual_phase_map: list[tuple[int | float, list[int]]] = [
            (3.1, [3]),   # narrative_director
            (4,   [4]),   # narrative_visual_planner
            (5,   [5]),   # visual_research_orch
            (6,   [6]),   # visual_director_orch
        ]

        for phase_num, agent_indices in visual_phase_map:
            if phase_num in completed_phases:
                logger.info(
                    "Skipping visual phase %s for session %s (checkpoint)",
                    phase_num,
                    session_id,
                )
                continue

            t_phase_start = time.monotonic()
            logger.info(
                "Starting visual phase %s for session %s",
                phase_num,
                session_id,
            )

            for agent_idx in agent_indices:
                if agent_idx < len(self.sub_agents):
                    agent = self.sub_agents[agent_idx]
                    async for event in agent.run_async(ctx):
                        yield event

            await save_checkpoint(db, session_id, phase_num, ctx.session.state)
            logger.info(
                "Visual phase %s completed in %.1fs for session %s",
                phase_num,
                time.monotonic() - t_phase_start,
                session_id,
            )

        # ------------------------------------------------------------------
        # Sign GCS URLs and emit segment_playable for each segment
        # ------------------------------------------------------------------
        bucket_name = self.gcs_bucket_name
        image_url_store: dict[str, list[str]] = ctx.session.state.get(
            "image_urls", {}
        )
        video_url_store: dict[str, str] = ctx.session.state.get(
            "video_urls", {}
        )

        # Sign all GCS image/video URLs and re-emit segment_update with
        # HTTPS URLs, then emit segment_playable for each segment.
        if bucket_name:
            for seg_dict in accumulated_scripts:
                if seg_dict is None:
                    continue
                seg_id = seg_dict.get("id", "")
                scene_id_val = seg_dict.get("scene_id", "")

                # Sign image URLs
                raw_image_urls = image_url_store.get(seg_id, [])
                signed_image_urls: list[str] = []
                for url in raw_image_urls:
                    try:
                        signed_image_urls.append(
                            _sign_gcs_url(url, bucket_name)
                        )
                    except Exception as exc:
                        logger.warning(
                            "Failed to sign image URL %s: %s", url, exc
                        )
                        signed_image_urls.append(url)

                # Sign video URL
                raw_video_url = video_url_store.get(seg_id)
                signed_video_url: str | None = None
                if raw_video_url:
                    try:
                        signed_video_url = _sign_gcs_url(
                            raw_video_url, bucket_name
                        )
                    except Exception as exc:
                        logger.warning(
                            "Failed to sign video URL %s: %s",
                            raw_video_url,
                            exc,
                        )
                        signed_video_url = raw_video_url

                # Emit segment_update with signed URLs
                if self.emitter and signed_image_urls:
                    await self.emitter.emit(
                        "segment_update",
                        build_segment_update_event(
                            segment_id=seg_id,
                            scene_id=scene_id_val,
                            status="complete",
                            title=seg_dict.get("title"),
                            mood=seg_dict.get("mood"),
                            image_urls=signed_image_urls,
                            video_url=signed_video_url,
                        ),
                    )

                # Emit segment_playable
                if self.emitter:
                    await self.emitter.emit(
                        "segment_playable",
                        build_segment_playable_event(segment_id=seg_id),
                    )

                logger.info(
                    "Emitted segment_playable for %s (session %s, "
                    "%d signed images, video=%s)",
                    seg_id,
                    session_id,
                    len(signed_image_urls),
                    bool(signed_video_url),
                )
        else:
            # No bucket configured -- emit segment_playable without signing
            for seg_dict in accumulated_scripts:
                if seg_dict is None:
                    continue
                seg_id = seg_dict.get("id", "")
                if self.emitter:
                    await self.emitter.emit(
                        "segment_playable",
                        build_segment_playable_event(segment_id=seg_id),
                    )

        t_total = time.monotonic() - t_pipeline_start
        logger.info(
            "Streaming pipeline complete for session %s in %.1fs",
            session_id,
            t_total,
        )


# ---------------------------------------------------------------------------
# Factory: batch pipeline (original)
# ---------------------------------------------------------------------------


def build_new_pipeline(
    emitter: SSEEmitter | None = None,
) -> ResumablePipelineAgent:
    """Assemble the complete Phase I-V documentary generation pipeline (batch mode).

    This is the original batch pipeline. All phases run sequentially.

    Args:
        emitter: Optional SSE emitter forwarded to all phase orchestrators.

    Returns:
        A ResumablePipelineAgent running all phases sequentially.
    """
    # Shared rate limiters
    gemini_limiter = GlobalRateLimiter(limit=12, label="gemini")
    imagen_limiter = GlobalRateLimiter(limit=8, label="imagen")

    document_analyzer = build_document_analyzer(
        emitter=emitter, rate_limiter=gemini_limiter,
    )
    scene_research = build_scene_research_orchestrator(emitter=emitter)
    script_orch = build_script_agent_orchestrator(emitter=emitter)
    narrative_director = build_narrative_director_agent(emitter=emitter)
    fact_validator = build_fact_validator_agent(emitter=emitter)
    geo_location = build_geo_location_agent(emitter=emitter)
    narrative_visual_planner_orch = build_narrative_visual_planner(emitter=emitter)
    visual_research_orch = build_visual_research_orchestrator(
        emitter=emitter, rate_limiter=gemini_limiter,
        imagen_rate_limiter=imagen_limiter,
    )
    visual_director_orch = build_visual_director_orchestrator(
        emitter=emitter, gemini_rate_limiter=gemini_limiter,
        imagen_rate_limiter=imagen_limiter,
    )

    return ResumablePipelineAgent(
        name="historian_pipeline",
        description=(
            "AI Historian documentary pipeline: document analysis (Phase I), "
            "scene research (Phase II), script generation (Phase III), "
            "fact validation (Phase III.5), geographic mapping (Phase 3.8), "
            "visual storyboard planning (Phase 4.0), visual research (Phase IV), "
            "and visual generation (Phase V). "
            "Supports checkpoint-based resumption on failure."
        ),
        firestore_project=os.environ.get("GCP_PROJECT_ID", ""),
        emitter=emitter,
        sub_agents=[
            document_analyzer,               # [0] Phase I
            scene_research,                  # [1] Phase II
            _make_aggregator_agent(),        # [2] Phase II (aggregator)
            script_orch,                     # [3] Phase III
            narrative_director,              # [4] Phase 3.1 -- Gemini TEXT+IMAGE interleaved
            fact_validator,                  # [5] Phase III.5
            geo_location,                    # [6] Phase 3.8 -- Geographic Mapping
            narrative_visual_planner_orch,   # [7] Phase 4.0
            visual_research_orch,            # [8] Phase IV
            visual_director_orch,            # [9] Phase V
        ],
    )


# ---------------------------------------------------------------------------
# Factory: streaming pipeline (Workstream B)
# ---------------------------------------------------------------------------


def build_streaming_pipeline(
    emitter: SSEEmitter | None = None,
) -> StreamingPipelineAgent:
    """Assemble the per-segment streaming documentary pipeline (Workstream B).

    Global phases (I + II) run first, then per-segment coroutines handle
    Script -> FactCheck -> Geo for each scene. Visual phases (3.1, 4.0, IV, V)
    run as batch after all segments are scripted.

    Scene 0 runs first with no overlap for fastest time-to-first-playable.
    Scenes 1-N run concurrently with semaphore-based throttling.

    Args:
        emitter: Optional SSE emitter forwarded to all phase orchestrators.

    Returns:
        A StreamingPipelineAgent.
    """
    # Shared rate limiters
    gemini_limiter = GlobalRateLimiter(limit=12, label="gemini")
    imagen_limiter = GlobalRateLimiter(limit=8, label="imagen")

    # Global phase agents (indices 0, 1, 2)
    document_analyzer = build_document_analyzer(
        emitter=emitter, rate_limiter=gemini_limiter,
    )
    scene_research = build_scene_research_orchestrator(emitter=emitter)
    aggregator = _make_aggregator_agent()

    # Visual phase agents (indices 3, 4, 5, 6) -- run after per-segment pipeline
    narrative_director = build_narrative_director_agent(emitter=emitter)
    narrative_visual_planner_orch = build_narrative_visual_planner(emitter=emitter)
    visual_research_orch = build_visual_research_orchestrator(
        emitter=emitter, rate_limiter=gemini_limiter,
        imagen_rate_limiter=imagen_limiter,
    )
    visual_director_orch = build_visual_director_orchestrator(
        emitter=emitter, gemini_rate_limiter=gemini_limiter,
        imagen_rate_limiter=imagen_limiter,
    )

    return StreamingPipelineAgent(
        name="historian_streaming_pipeline",
        description=(
            "AI Historian per-segment streaming pipeline (Workstream B). "
            "Global phases I+II run first, then per-segment Script/FactCheck/Geo "
            "coroutines produce segments incrementally. Visual phases run after. "
            "Scene 0 is prioritized for fastest time-to-first-playable."
        ),
        firestore_project=os.environ.get("GCP_PROJECT_ID", ""),
        gcs_bucket_name=os.environ.get("GCS_BUCKET_NAME", ""),
        emitter=emitter,
        gemini_limiter=gemini_limiter,
        imagen_limiter=imagen_limiter,
        sub_agents=[
            document_analyzer,               # [0] Phase I
            scene_research,                  # [1] Phase II
            aggregator,                      # [2] Phase II (aggregator)
            narrative_director,              # [3] Phase 3.1
            narrative_visual_planner_orch,   # [4] Phase 4.0
            visual_research_orch,            # [5] Phase IV
            visual_director_orch,            # [6] Phase V
        ],
    )
