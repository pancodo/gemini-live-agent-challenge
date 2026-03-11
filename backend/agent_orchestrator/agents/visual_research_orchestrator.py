"""Phase IV of the AI Historian documentary pipeline: Visual Research.

Orchestrates a per-scene micro-pipeline (Stages 0–6) that transforms each
SceneBrief + SegmentScript into a ``VisualDetailManifest`` — a richly sourced,
period-accurate Imagen 3 prompt grounded in real archival research.

Architecture
------------
``VisualResearchOrchestrator`` is a custom ``BaseAgent`` subclass that does NOT
use any ADK sub-agents.  All AI calls are made directly through the
``google-genai`` client (``client.aio.models.generate_content``) for complete
control over concurrency, error handling, and SSE emission timing.

Two tracks run concurrently via ``asyncio.gather``:

**Fast Path (Scene 0)**
  Cap: 3 sources.  Skips PDFs and images.  Early exit after 2 accepted sources.
  Target: manifest ready within 35 seconds of Phase IV starting.

**Deep Path (Scenes 1–N)**
  Cap: 8–10 sources.  All source types enabled.  No early exit.
  Runs in the background while the user watches Scene 0 play.

As each scene's manifest completes, the orchestrator:
  1. Writes the manifest to Firestore.
  2. Updates ``session.state["visual_research_manifest"][scene_id]``.
  3. Emits ``segment_update(status="ready")`` → frontend SegmentCard reveals.
  4. Emits ``agent_status(done)`` for the scene's research agent card.

Session state contract
----------------------
**Inputs** (must be set before Phase IV runs):
  - ``session.state["scene_briefs"]`` — list[dict] of SceneBrief dicts (Phase I) **required**
  - ``session.state["visual_bible"]`` — Imagen 3 style guide (Phase I) **required**
  - ``session.state["script"]``       — list[dict] of SegmentScript dicts (Phase III) **optional**
    When present, title/mood are taken from the script segment; otherwise stub values
    from the SceneBrief are used.  This allows Phase III and Phase IV to run in
    parallel via a ParallelAgent without a sequential dependency.

**Outputs** (written by this agent):
  - ``session.state["visual_research_manifest"]`` — dict[scene_id, dict] of serialised
    ``VisualDetailManifest`` objects.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from collections.abc import AsyncGenerator
from typing import Any

from google import genai as google_genai
from google.adk.agents.base_agent import BaseAgent
from google.adk.agents.invocation_context import InvocationContext
from google.cloud import firestore
from pydantic import ConfigDict, Field

from .script_types import SegmentScript
from .sse_helpers import (
    SSEEmitter,
    build_agent_source_evaluation_event,
    build_agent_status_event,
    build_pipeline_phase_event,
    build_segment_update_event,
)
from .storyboard_types import SceneVisualPlan, VisualStoryboard
from .visual_detail_types import EvaluatedSource, FetchedContent, VisualDetailManifest
from .visual_director_orchestrator import _run_segment_generation
from .visual_research_stages import (
    stage_0_generate_queries,
    stage_1_discover_sources,
    stage_2_detect_types,
    stage_3_fetch_content,
    stage_4_dual_evaluate,
    stage_5_extract_details,
    stage_6_synthesize_manifest,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_FAST_PATH_MAX_SOURCES: int = 3
_DEEP_PATH_MAX_SOURCES: int = 5
_SEMAPHORE_LIMIT: int = 6  # Max concurrent Gemini calls across all scenes


# ---------------------------------------------------------------------------
# Firestore persistence helper
# ---------------------------------------------------------------------------


async def _write_manifest_to_firestore(
    db: firestore.AsyncClient,
    session_id: str,
    manifest: VisualDetailManifest,
) -> None:
    """Write a ``VisualDetailManifest`` to Firestore.

    Written to ``/sessions/{sessionId}/visualManifests/{sceneId}``.

    Args:
        db: Async Firestore client.
        session_id: Parent session ID.
        manifest: The completed manifest to persist.
    """
    ref = (
        db.collection("sessions")
        .document(session_id)
        .collection("visualManifests")
        .document(manifest.scene_id)
    )
    data = manifest.model_dump()
    # Firestore cannot store nested Pydantic models directly — use json-round-trip
    data["reference_sources"] = [s.model_dump() for s in manifest.reference_sources]
    data["detail_fields"] = manifest.detail_fields.model_dump()
    data["createdAt"] = firestore.SERVER_TIMESTAMP
    await ref.set(data)


async def _update_segment_status_in_firestore(
    db: firestore.AsyncClient,
    session_id: str,
    segment_id: str,
) -> None:
    """Update the segment document status to 'visual_ready' after Phase IV."""
    ref = (
        db.collection("sessions")
        .document(session_id)
        .collection("segments")
        .document(segment_id)
    )
    try:
        await ref.set({"status": "visual_ready"}, merge=True)
    except Exception as exc:
        logger.warning("Failed to update segment status for %s: %s", segment_id, exc)


# ---------------------------------------------------------------------------
# Batch source evaluation (single-call replacement for dual Stage 4)
# ---------------------------------------------------------------------------


async def _batch_evaluate_sources(
    fetched_content: list[FetchedContent],
    scene_brief: dict[str, Any],
    storyboard_plan: dict[str, Any] | None,
    client: google_genai.Client,
    semaphore: asyncio.Semaphore,
) -> tuple[list[EvaluatedSource], list[EvaluatedSource]]:
    """Evaluate all fetched sources in a single Gemini 2.0 Flash call.

    When a storyboard plan is available, its ``primary_subject`` provides
    sharper relevance criteria than the generic scene title.  This function
    replaces the two-call (quality + relevance) ``stage_4_dual_evaluate``
    with one merged evaluation call, halving the Gemini call count for
    Stage 4.

    Args:
        fetched_content: Sources with extracted text from Stage 3.
        scene_brief: Serialised SceneBrief dict.
        storyboard_plan: Matching ``SceneVisualPlan`` dict, or ``None``.
        client: Shared google-genai async client.
        semaphore: Rate-limit gate.

    Returns:
        Tuple of (accepted, rejected) ``EvaluatedSource`` lists.
    """
    from google.genai import types as genai_types

    visual_focus = (
        storyboard_plan.get("primary_subject", scene_brief.get("title", ""))
        if storyboard_plan
        else scene_brief.get("title", "")
    )

    sources_for_prompt = [
        {
            "url": s.url,
            "title": s.title,
            "content_preview": s.content[:600],
        }
        for s in fetched_content
    ]

    prompt = f"""You are evaluating web sources for a documentary scene about:
Scene title: {scene_brief.get('title', '')}
Era: {scene_brief.get('era', '')}
Visual focus: {visual_focus}

Evaluate each source and return a JSON array. Accept sources with visual_detail_density >= 6 AND relevance >= 7.

Sources to evaluate:
{json.dumps(sources_for_prompt, indent=2)}

Return JSON array only, no markdown:
[
  {{
    "url": "...",
    "accepted": true,
    "authority_score": 1,
    "detail_density_score": 1,
    "era_accuracy_score": 1,
    "relevance_score": 1,
    "reason": "one sentence",
    "relevant_passages": ["quote1", "quote2"]
  }}
]
"""

    # Build a URL→FetchedContent lookup for source_type resolution
    content_by_url: dict[str, FetchedContent] = {s.url: s for s in fetched_content}

    for attempt in range(3):
        try:
            async with semaphore:
                response = await client.aio.models.generate_content(
                    model="gemini-2.0-flash",
                    contents=prompt,
                    config=genai_types.GenerateContentConfig(
                        max_output_tokens=2048,
                        temperature=0.1,
                    ),
                )

            raw_text = response.text.strip()
            # Strip markdown fences if present
            if raw_text.startswith("```"):
                raw_text = raw_text.split("\n", 1)[-1]
            if raw_text.endswith("```"):
                raw_text = raw_text.rsplit("```", 1)[0]

            evaluations = json.loads(raw_text.strip())
            if not isinstance(evaluations, list):
                raise ValueError(f"Expected JSON array, got {type(evaluations).__name__}")

            accepted: list[EvaluatedSource] = []
            rejected: list[EvaluatedSource] = []

            for ev in evaluations:
                url = ev.get("url", "")
                source = content_by_url.get(url)
                source_type = source.source_type if source else "unknown"

                evaluated = EvaluatedSource(
                    url=url,
                    title=ev.get("title", source.title if source else ""),
                    source_type=source_type,
                    accepted=bool(ev.get("accepted", False)),
                    authority_score=int(ev.get("authority_score", 0)),
                    detail_density_score=int(ev.get("detail_density_score", 0)),
                    era_accuracy_score=int(ev.get("era_accuracy_score", 0)),
                    relevance_score=int(ev.get("relevance_score", 0)),
                    reason=ev.get("reason", ""),
                    relevant_passages=ev.get("relevant_passages", []),
                )

                if evaluated.accepted:
                    accepted.append(evaluated)
                else:
                    rejected.append(evaluated)

            logger.info(
                "Batch evaluate: %d accepted, %d rejected for scene %s",
                len(accepted),
                len(rejected),
                scene_brief.get("scene_id", "?"),
            )
            return accepted, rejected

        except (json.JSONDecodeError, ValueError, KeyError) as exc:
            logger.warning(
                "Batch evaluate attempt %d failed for scene %s: %s",
                attempt + 1,
                scene_brief.get("scene_id", "?"),
                exc,
            )
            if attempt == 2:
                # Final attempt failed — return all sources as rejected
                logger.error(
                    "Batch evaluate exhausted retries for scene %s — rejecting all",
                    scene_brief.get("scene_id", "?"),
                )
                return [], [
                    EvaluatedSource(
                        url=s.url,
                        title=s.title,
                        source_type=s.source_type,
                        accepted=False,
                        reason="Batch evaluation failed after 3 attempts",
                    )
                    for s in fetched_content
                ]
        except Exception as exc:
            logger.warning(
                "Batch evaluate attempt %d unexpected error for scene %s: %s",
                attempt + 1,
                scene_brief.get("scene_id", "?"),
                exc,
            )
            if attempt == 2:
                return [], [
                    EvaluatedSource(
                        url=s.url,
                        title=s.title,
                        source_type=s.source_type,
                        accepted=False,
                        reason="Batch evaluation failed after 3 attempts",
                    )
                    for s in fetched_content
                ]

    # Unreachable, but satisfies the type checker
    return [], []


# ---------------------------------------------------------------------------
# Per-scene micro-pipeline runner
# ---------------------------------------------------------------------------


async def _run_scene_pipeline(
    scene_brief: dict[str, Any],
    segment: dict[str, Any],
    storyboard_plan: dict[str, Any] | None,
    client: google_genai.Client,
    semaphore: asyncio.Semaphore,
    db: firestore.AsyncClient,
    session_id: str,
    processor_name: str | None,
    emitter: SSEEmitter | None,
    fast_path: bool,
    visual_bible: str = "",
) -> VisualDetailManifest | None:
    """Run Stages 0–6 for a single scene and return the completed manifest.

    Emits per-source ``agent_source_evaluation`` SSE events during Stage 4,
    and ``agent_status`` transitions throughout.

    Args:
        scene_brief: Serialised SceneBrief dict.
        segment: Serialised SegmentScript dict.
        storyboard_plan: Matching ``SceneVisualPlan`` dict from the storyboard,
            or ``None`` if no storyboard exists for this scene.  When provided,
            Stage 0 is skipped (pre-planned queries) and Stage 4 uses single-call
            batch evaluation.
        client: Shared google-genai async client.
        semaphore: Shared rate-limit gate (across all concurrent scenes).
        db: Async Firestore client.
        session_id: Active session ID.
        processor_name: Document AI processor resource name (optional).
        emitter: SSE emitter for frontend progress events (optional).
        fast_path: Whether to use the fast-path caps and early exit.
        visual_bible: Imagen 3 style guide for the documentary.

    Returns:
        The completed ``VisualDetailManifest``, or ``None`` if all stages fail.
    """
    scene_id = scene_brief.get("scene_id", "unknown")
    segment_id = segment.get("id", "unknown")
    track = "fast" if fast_path else "deep"
    max_sources = _FAST_PATH_MAX_SOURCES if fast_path else _DEEP_PATH_MAX_SOURCES

    t_start = time.monotonic()
    logger.info("Phase IV [%s]: starting pipeline for %s", track, scene_id)

    # ---- Announce scene as queued ----
    if emitter:
        await emitter.emit(
            "agent_status",
            build_agent_status_event(
                agent_id=f"visual_research_{scene_id}",
                status="queued",
                query=scene_brief.get("title", scene_id),
            ),
        )

    # ---- Stage 0: Query Generation ----
    # If a storyboard plan exists for this scene, use its pre-planned queries
    # instead of running Stage 0 (query generation). This saves 1 Gemini call
    # per scene and ensures queries are differentiated across scenes.
    if storyboard_plan and storyboard_plan.get("targeted_searches"):
        queries = storyboard_plan["targeted_searches"][:3]  # max 3
        logger.info(
            "Phase IV [%s]: using storyboard queries for %s (skip Stage 0)",
            track, scene_id,
        )
    else:
        # Fallback: run Stage 0 query generation as before
        queries = await stage_0_generate_queries(scene_brief, client, semaphore)
        if not queries:
            logger.warning("Stage 0 produced no queries for %s — aborting", scene_id)
            if emitter:
                await emitter.emit(
                    "agent_status",
                    build_agent_status_event(
                        agent_id=f"visual_research_{scene_id}",
                        status="error",
                        elapsed=round(time.monotonic() - t_start, 1),
                    ),
                )
            return None

    # ---- Stage 1: Source Discovery ----
    if emitter:
        await emitter.emit(
            "agent_status",
            build_agent_status_event(
                agent_id=f"visual_research_{scene_id}",
                status="searching",
                query=f"Finding visual references ({len(queries)} targeted queries)",
            ),
        )

    sources = await stage_1_discover_sources(queries, client, semaphore, max_sources=max_sources)
    if not sources:
        logger.warning("Stage 1 found no sources for %s — aborting", scene_id)
        if emitter:
            await emitter.emit(
                "agent_status",
                build_agent_status_event(
                    agent_id=f"visual_research_{scene_id}",
                    status="error",
                    elapsed=round(time.monotonic() - t_start, 1),
                ),
            )
        return None

    logger.info("Stage 1 [%s]: discovered %d sources for %s", track, len(sources), scene_id)

    # ---- Stage 2: Type Detection ----
    typed_sources = await stage_2_detect_types(sources, client, semaphore)

    # ---- Stage 3: Content Fetch ----
    fetched_content = await stage_3_fetch_content(
        typed_sources,
        client,
        semaphore,
        processor_name=processor_name,
        fast_path=fast_path,
    )
    if not fetched_content:
        logger.warning("Stage 3 fetched no content for %s — aborting", scene_id)
        if emitter:
            await emitter.emit(
                "agent_status",
                build_agent_status_event(
                    agent_id=f"visual_research_{scene_id}",
                    status="error",
                    elapsed=round(time.monotonic() - t_start, 1),
                ),
            )
        return None

    # ---- Stage 4: Source Evaluation ----
    if emitter:
        await emitter.emit(
            "agent_status",
            build_agent_status_event(
                agent_id=f"visual_research_{scene_id}",
                status="evaluating",
                query=f"Evaluating {len(fetched_content)} sources for quality and relevance",
            ),
        )

    if storyboard_plan:
        # Single-call batch evaluation when storyboard is available
        accepted_sources, rejected_sources = await _batch_evaluate_sources(
            fetched_content, scene_brief, storyboard_plan, client, semaphore
        )
    else:
        # Fallback to original dual evaluate
        accepted_sources, rejected_sources = await stage_4_dual_evaluate(
            fetched_content,
            scene_brief,
            client,
            semaphore,
            fast_path=fast_path,
            early_exit_count=2,
        )

    # Emit per-source evaluation events for the frontend AgentModal
    if emitter:
        all_evaluated: list[EvaluatedSource] = accepted_sources + rejected_sources
        for src in all_evaluated:
            await emitter.emit(
                "agent_source_evaluation",
                build_agent_source_evaluation_event(
                    agent_id=f"visual_research_{scene_id}",
                    url=src.url,
                    title=src.title,
                    accepted=src.accepted,
                    reason=src.reason,
                ),
            )

        await emitter.emit(
            "stats_update",
            {
                "type": "stats_update",
                "sourcesFound": len(accepted_sources) + len(rejected_sources),
                "factsVerified": len(accepted_sources),
            },
        )

    logger.info(
        "Stage 4 [%s]: %d accepted, %d rejected for %s",
        track,
        len(accepted_sources),
        len(rejected_sources),
        scene_id,
    )

    # ---- Stage 5: Detail Extraction ----
    fragments = []
    if accepted_sources:
        fragments = await stage_5_extract_details(
            accepted_sources, scene_brief, client, semaphore
        )
    else:
        logger.warning("Stage 4: no accepted sources for %s — manifest will be empty", scene_id)

    # ---- Stage 6: Manifest Synthesis ----
    frame_concepts = storyboard_plan.get("frame_concepts", []) if storyboard_plan else []

    manifest = await stage_6_synthesize_manifest(
        fragments,
        accepted_sources,
        rejected_sources,
        scene_brief,
        segment_id,
        client,
        visual_bible=visual_bible,
        narrative_role=scene_brief.get("narrative_role", ""),
        frame_concepts=frame_concepts,
    )

    t_elapsed = round(time.monotonic() - t_start, 1)

    # ---- Persist to Firestore ----
    try:
        await _write_manifest_to_firestore(db, session_id, manifest)
        await _update_segment_status_in_firestore(db, session_id, segment_id)
    except Exception as exc:
        logger.warning("Firestore write failed for manifest %s: %s", scene_id, exc)

    # ---- Emit completion events ----
    if emitter:
        await emitter.emit(
            "segment_update",
            build_segment_update_event(
                segment_id=segment_id,
                scene_id=scene_id,
                status="ready",
                title=segment.get("title"),
                mood=segment.get("mood"),
            ),
        )
        await emitter.emit(
            "agent_status",
            build_agent_status_event(
                agent_id=f"visual_research_{scene_id}",
                status="done",
                elapsed=t_elapsed,
                facts=[
                    f"{manifest.sources_accepted} sources accepted, "
                    f"{manifest.sources_rejected} rejected",
                    "Enriched Imagen 3 prompt ready" if manifest.enriched_prompt
                    else "No enriched prompt — Visual Director will use script fallback",
                ],
            ),
        )

    logger.info(
        "Phase IV [%s]: completed %s in %.1fs — %d accepted, %d rejected, prompt: %s",
        track,
        scene_id,
        t_elapsed,
        manifest.sources_accepted,
        manifest.sources_rejected,
        "yes" if manifest.enriched_prompt else "empty (fallback)",
    )

    return manifest


# ---------------------------------------------------------------------------
# VisualResearchOrchestrator — Phase IV BaseAgent
# ---------------------------------------------------------------------------


class VisualResearchOrchestrator(BaseAgent):
    """Phase IV orchestrator: per-scene visual research via 6-stage micro-pipeline.

    Reads SegmentScript list from ``session.state["script"]`` and SceneBrief list
    from ``session.state["scene_briefs"]``, then runs a Stages 0–6 visual
    research pipeline for every scene concurrently.

    Scene 0 runs on the fast path (3 sources, early exit at 2 accepted) to
    produce its manifest within ~35 seconds.  All other scenes run on the deep
    path (8–10 sources) in the background.

    When each scene's manifest completes, the orchestrator writes it to
    Firestore, updates ``session.state["visual_research_manifest"]``, and emits
    ``segment_update(ready)`` so the frontend SegmentCard transitions from
    skeleton to content.
    """

    model_config = ConfigDict(arbitrary_types_allowed=True)

    firestore_project: str = Field(
        ...,
        description="GCP project ID for Firestore writes.",
    )
    processor_name: str | None = Field(
        default=None,
        description=(
            "Document AI processor resource name for PDF OCR. "
            "Optional — if absent, PDFs fall back to plain text extraction."
        ),
    )
    gcs_bucket: str = Field(
        default="",
        description="GCS bucket for Imagen 3 image uploads. When non-empty, image generation runs inline after each manifest completes.",
    )
    emitter: Any = Field(
        default=None,
        description="Optional SSE emitter for frontend progress events.",
    )
    sub_agents: list[BaseAgent] = Field(
        default_factory=list,
        description="Declared for ADK BaseAgent compatibility. Unused — all AI calls are direct.",
    )

    async def _run_async_impl(
        self,
        ctx: InvocationContext,
    ) -> AsyncGenerator[Any, None]:
        """Execute Phase IV: announce → concurrent scene pipelines → write manifests.

        This generator yields nothing (no ADK sub-agent events) because all AI
        calls in Phase IV are made directly via the google-genai client.  The
        ``yield`` at the end satisfies the ``AsyncGenerator`` protocol required
        by ADK's ``BaseAgent._run_async_impl`` signature.
        """
        session_id: str = ctx.session.id
        t_start = time.monotonic()

        # ------------------------------------------------------------------
        # Phase announcement
        # ------------------------------------------------------------------
        if self.emitter:
            await self.emitter.emit(
                "pipeline_phase",
                build_pipeline_phase_event(
                    phase=4,
                    label="VISUAL COMPOSITION",
                    message="Researching period-accurate visual references for each scene",
                ),
            )

        # ------------------------------------------------------------------
        # Load scene briefs (primary — no script dependency so Phase III+IV
        # can run in parallel).  If script is already in state (sequential
        # fallback or re-run), enrich stub segments with title/mood from it.
        # ------------------------------------------------------------------
        scene_briefs_raw: list[dict[str, Any]] = ctx.session.state.get("scene_briefs", [])

        if not scene_briefs_raw:
            logger.error(
                "Phase IV: session.state['scene_briefs'] is empty for session %s. "
                "Ensure Phase I (DocumentAnalyzerAgent) completed successfully.",
                session_id,
            )
            return

        # Optional enrichment from script (available when running sequentially)
        script_raw: list[dict[str, Any]] = ctx.session.state.get("script", [])
        script_by_scene: dict[str, dict[str, Any]] = {
            s["scene_id"]: s for s in script_raw if "scene_id" in s
        }

        # Load visual storyboard (produced by Phase III-B storyboard agent)
        storyboard_raw: dict = ctx.session.state.get("visual_storyboard", {})
        storyboard_scenes: dict[str, dict] = (
            storyboard_raw.get("scenes", {}) if storyboard_raw else {}
        )

        # Build (brief, segment) pairs — use script segment when available,
        # otherwise construct a stub from the scene brief so Phase IV can run
        # in parallel with Phase III without waiting for it.
        pairs: list[tuple[dict[str, Any], dict[str, Any]]] = []
        for brief in scene_briefs_raw:
            scene_id = brief.get("scene_id", "")
            if not scene_id:
                continue
            seg = script_by_scene.get(scene_id) or {
                "id": scene_id,
                "scene_id": scene_id,
                "title": brief.get("title", ""),
                "mood": "",
            }
            pairs.append((brief, seg))

        if not pairs:
            logger.error(
                "Phase IV: no valid (brief, segment) pairs for session %s.",
                session_id,
            )
            return

        logger.info(
            "Phase IV: starting visual research for %d scenes (%s)",
            len(pairs),
            ", ".join(p[0].get("scene_id", "?") for p in pairs),
        )

        # ------------------------------------------------------------------
        # Initialise shared resources
        # ------------------------------------------------------------------
        client = google_genai.Client(
            vertexai=True,
            project=os.environ["GCP_PROJECT_ID"],
            location=os.environ.get("VERTEX_AI_LOCATION", "us-central1"),
        )
        semaphore = asyncio.Semaphore(_SEMAPHORE_LIMIT)
        imagen_semaphore = asyncio.Semaphore(8)
        image_url_store: dict[str, list[str]] = {}
        db = firestore.AsyncClient(project=self.firestore_project)

        # Initialise manifest store in session state
        if "visual_research_manifest" not in ctx.session.state:
            ctx.session.state["visual_research_manifest"] = {}

        # ------------------------------------------------------------------
        # Build concurrent pipeline tasks — fast path for scene 0, deep for rest
        # ------------------------------------------------------------------
        # Resolve visual_bible once for all scenes
        _visual_bible: str = ctx.session.state.get("visual_bible", "")

        async def _run_and_store(
            brief: dict[str, Any],
            seg: dict[str, Any],
            fast_path: bool,
        ) -> None:
            """Run the pipeline for one scene and store the result in session state.

            When gcs_bucket is set, image generation runs inline immediately after
            the manifest is ready — giving the frontend progressive delivery without
            waiting for all scenes to finish Phase IV.
            """
            # Look up storyboard plan for this scene (may be None)
            scene_id = brief.get("scene_id", "")
            sb_plan = storyboard_scenes.get(scene_id)

            manifest = await _run_scene_pipeline(
                scene_brief=brief,
                segment=seg,
                storyboard_plan=sb_plan,
                client=client,
                semaphore=semaphore,
                db=db,
                session_id=session_id,
                processor_name=self.processor_name,
                emitter=self.emitter,
                fast_path=fast_path,
                visual_bible=_visual_bible,
            )
            if manifest:
                ctx.session.state["visual_research_manifest"][manifest.scene_id] = (
                    manifest.model_dump()
                )

                # ── Inline image generation ──────────────────────────────────
                # Immediately generate Imagen 3 frames for this scene as soon
                # as its manifest is ready, without waiting for other scenes.
                # Phase V will skip image generation for segments already here.
                if self.gcs_bucket:
                    visual_bible = ctx.session.state.get("visual_bible", "")
                    await _run_segment_generation(
                        client=client,
                        semaphore=imagen_semaphore,
                        db=db,
                        segment=seg,
                        manifest=manifest.model_dump(),
                        visual_bible=visual_bible,
                        session_id=session_id,
                        bucket_name=self.gcs_bucket,
                        emitter=self.emitter,
                        image_url_store=image_url_store,
                        narrative_role=brief.get("narrative_role", ""),
                    )

        tasks = []
        for i, (brief, seg) in enumerate(pairs):
            tasks.append(_run_and_store(brief, seg, fast_path=(i == 0)))

        # Run all tracks concurrently — fast path finishes first by construction
        await asyncio.gather(*tasks, return_exceptions=True)

        # Persist inline-generated image URLs so Phase V can skip those segments
        if image_url_store:
            ctx.session.state["image_urls"] = image_url_store

        # ------------------------------------------------------------------
        # Completion summary
        # ------------------------------------------------------------------
        t_elapsed = round(time.monotonic() - t_start, 1)
        manifests_written = len(ctx.session.state.get("visual_research_manifest", {}))

        if self.emitter:
            await self.emitter.emit(
                "agent_status",
                build_agent_status_event(
                    agent_id="visual_research_orchestrator",
                    status="done",
                    elapsed=t_elapsed,
                    facts=[
                        f"{manifests_written}/{len(pairs)} visual manifests completed",
                        "session.state['visual_research_manifest'] populated",
                        f"Phase IV completed in {t_elapsed}s",
                    ],
                ),
            )

        logger.info(
            "Phase IV complete for session %s: %d/%d manifests in %.1fs",
            session_id,
            manifests_written,
            len(pairs),
            t_elapsed,
        )

        # Required by ADK BaseAgent — yield nothing (no sub-agent events)
        return
        yield  # noqa: unreachable — satisfies AsyncGenerator protocol


# ---------------------------------------------------------------------------
# Factory function
# ---------------------------------------------------------------------------


def build_visual_research_orchestrator(
    emitter: SSEEmitter | None = None,
) -> VisualResearchOrchestrator:
    """Construct a ``VisualResearchOrchestrator`` from environment variables.

    Required environment variables:
        - ``GCP_PROJECT_ID``: Google Cloud project ID for Firestore writes.

    Optional environment variables:
        - ``DOCUMENT_AI_PROCESSOR_NAME``: Full processor resource name for PDF OCR.
          If absent, PDF sources fall back to plain-text httpx extraction.

    Args:
        emitter: Optional SSE emitter for frontend progress events.

    Returns:
        Configured ``VisualResearchOrchestrator`` ready for pipeline integration.
    """
    return VisualResearchOrchestrator(
        name="visual_research_orchestrator",
        description=(
            "Phase IV: Runs a 6-stage per-scene visual research micro-pipeline "
            "(query generation → source discovery → type detection → content fetch "
            "→ dual evaluation → detail extraction → manifest synthesis). "
            "Produces a VisualDetailManifest per scene with a 200–400 word "
            "period-accurate Imagen 3 prompt grounded in archival research."
        ),
        firestore_project=os.environ["GCP_PROJECT_ID"],
        processor_name=os.environ.get("DOCUMENT_AI_PROCESSOR_NAME"),
        gcs_bucket=os.environ.get("GCS_BUCKET_NAME", ""),
        emitter=emitter,
    )
