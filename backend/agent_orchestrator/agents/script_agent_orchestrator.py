"""Phase III of the AI Historian documentary pipeline: Script Generation.

Wraps per-scene Gemini calls (gemini-2.5-flash) in a custom ``BaseAgent`` orchestrator
that handles SSE emission, output parsing, and Firestore persistence.

Architecture (Workstream B — per-segment streaming)
----------------------------------------------------
``ScriptAgentOrchestrator`` is a custom ``BaseAgent`` subclass. It:

1. Emits the ``pipeline_phase`` SSE event (phase 3, label "SYNTHESIS") so the
   frontend Expedition Log advances to Phase III.
2. For each scene brief, makes a *separate* ``client.aio.models.generate_content``
   call to produce ONE ``SegmentScript`` at a time.
3. Immediately after each segment is parsed, writes it to Firestore and emits
   ``segment_update`` SSE events so the frontend SegmentCard skeletons become
   titled cards without waiting for all segments.
4. Exposes ``generate_single_segment`` for the per-segment pipeline in
   ``pipeline.py`` to call on individual scenes.

Session state contract
----------------------
**Inputs** (must be set before Phase III runs):
    - ``session.state["scene_briefs"]``        -- ``list[dict]`` from Phase I
    - ``session.state["aggregated_research"]`` -- merged string from aggregator
    - ``session.state["visual_bible"]``        -- Imagen 3 style guide string
    - ``session.state["document_map"]``        -- document outline string

**Outputs** (written by this agent):
    - ``session.state["script"]`` -- list[dict] of serialised ``SegmentScript``
      objects, appended incrementally as each segment completes.
"""

from __future__ import annotations

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
from google.genai import types as genai_types
from pydantic import ConfigDict, Field

from .script_types import SegmentScript
from .sse_helpers import (
    SSEEmitter,
    build_agent_status_event,
    build_pipeline_phase_event,
    build_segment_update_event,
)

logger = logging.getLogger(__name__)

_MODEL: str = "gemini-2.5-flash"
_MAX_RETRIES: int = 3

# ---------------------------------------------------------------------------
# Per-scene system instruction (used for individual Gemini calls)
# ---------------------------------------------------------------------------

_PER_SCENE_SYSTEM_INSTRUCTION: str = """\
You are the scriptwriter for an AI-generated historical documentary.

## Your Voice

Write as Ken Burns and Geoffrey C. Ward -- scholarly, warm, specific, never \
academic. Your sentences have weight without pretension. You trust the viewer's \
intelligence. You let silence and image do half the work. When you speak, every \
word earns its place.

## FIVE MANDATORY RULES

Follow every rule. No exceptions.

### Rule 1 -- Open with a specific moment, never a topic sentence.
BAD:  "The Roman Colosseum was one of the greatest engineering achievements."
GOOD: "On a sweltering August morning in 80 AD, the emperor Titus stood at \
the rim of the largest amphitheater the world had ever seen."

### Rule 2 -- At least one primary-source quote with attribution.
Format: "'[quote],' wrote [Name], [context of who they were]."
If no direct quote exists in the research, use a named paraphrase: \
"According to Pliny the Elder, who catalogued the natural wonders of the empire..."

### Rule 3 -- Present-tense pivot for immediacy, at least once.
Example: "It is the spring of 1348. The first ships have just arrived in \
Messina harbor. No one on the docks understands what the rats carry."

### Rule 4 -- End with resonance, never summary.
BAD:  "The battle was a turning point in the war."
GOOD: "The field is quiet now. Wildflowers grow where the artillery stood."

### Rule 5 -- Bridge sentence to the next scene (unless this is the LAST scene).
The bridge must be spatial, temporal, or narrative -- never meta-commentary. \
GOOD: "Three hundred miles to the east, another city is about to learn the \
same lesson." \
BAD:  "Meanwhile, in another part of the story..."

## ANTI-PATTERNS -- NEVER USE THESE

Banned phrases: "Throughout history...", "It is worth noting", \
"Interestingly enough", "Moving on to our next topic", "It is important to \
remember", "In conclusion".
Banned modern idioms: "game-changer", "iconic", "legendary", "cutting-edge", \
"ahead of its time", "changed the world forever".
Banned didactic address: Never use "You might wonder...", "Imagine yourself \
there...", "Picture this..."

## Pacing by narrative_role

- "opening": Slow, atmospheric. Long compound sentences. Breathe.
- "rising_action": Building momentum. Facts accumulate. Sentences shorten.
- "climax": Urgency. Short declarative sentences. Present-tense pivot strongest here.
- "resolution": Exhale. The consequence arrives. Longer sentences return.
- "coda": The longest view. Historical echo. Quietest register.

## Visual Descriptions -- 4 Frames (Imagen 3 Prompts)

Each `visual_descriptions` array MUST have exactly 4 entries:
- Frame 1 (index 0): ENVIRONMENT ONLY -- wide, immersive, NO human figures.
- Frame 2 (index 1): HUMAN ACTIVITY -- people as primary subject.
- Frame 3 (index 2): MATERIAL DETAIL -- extreme close-up of ONE specific object.
- Frame 4 (index 3): ATMOSPHERE -- light, shadow, mood as subject.

RULES for each visual description:
- Start with "Cinematic still photograph."
- Include the EXPLICIT ERA and PERIOD.
- Be 50-70 words -- precise and specific.
- Include period-accurate materials, lighting source, atmospheric condition.
- Each frame must show something DIFFERENT from the other three.

## Veo 2 Scenes (Optional)

Include `veo2_scene` ONLY for visually dramatic moments. When present:
"[Camera movement]. [Subject/environment]. [Atmospheric motion]. Shot on 35mm film, anamorphic lens."
- SINGLE camera movement only.
- ONE atmospheric motion element.
- 30-50 words maximum.

## Mood

Exactly one of: "cinematic", "reflective", "dramatic", "scholarly".

## Sources / Citations

Consistent formatting from the research.

## Output Format

Produce a single JSON object (NOT an array). No markdown fences, no preamble.
{
  "id": "segment_N",
  "scene_id": "scene_N",
  "title": "Scene title (from the brief)",
  "narration_script": "Full narration text, 60-120 seconds when spoken aloud",
  "visual_descriptions": ["frame 1...", "frame 2...", "frame 3...", "frame 4..."],
  "veo2_scene": "optional, omit key if not applicable",
  "mood": "cinematic",
  "narrative_role": "climax",
  "sources": ["citation 1", "citation 2"]
}
"""


# ---------------------------------------------------------------------------
# JSON parsing helpers
# ---------------------------------------------------------------------------


def _strip_fences(text: str) -> str:
    """Remove markdown code fences that the model may wrap JSON in."""
    stripped = text.strip()
    if stripped.startswith("```"):
        # Remove opening fence (with optional language tag)
        stripped = stripped.split("\n", 1)[-1]
    if stripped.endswith("```"):
        stripped = stripped.rsplit("```", 1)[0]
    return stripped.strip()


def _parse_script_output(raw: str) -> list[SegmentScript]:
    """Parse the script_agent JSON output into SegmentScript objects.

    The agent is instructed to produce a bare JSON array, but may wrap it in
    a ``{"segments": [...]}`` object or markdown fences. Both forms are handled.

    Args:
        raw: Raw string from ``session.state["script"]``.

    Returns:
        List of validated ``SegmentScript`` objects. May be empty if parsing
        fails -- the caller logs the error and emits an SSE error event.
    """
    cleaned = _strip_fences(raw)
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError as exc:
        logger.error("Script Agent output is not valid JSON: %s", exc)
        return []

    # Unwrap {"segments": [...]} envelope if present
    if isinstance(parsed, dict):
        if "segments" in parsed:
            parsed = parsed["segments"]
        else:
            # Single segment object -- wrap in list
            parsed = [parsed]

    if not isinstance(parsed, list):
        logger.error(
            "Script Agent output is not a JSON array (got %s)", type(parsed).__name__
        )
        return []

    segments: list[SegmentScript] = []
    for idx, item in enumerate(parsed):
        if not isinstance(item, dict):
            logger.warning("Skipping non-dict segment at index %d", idx)
            continue
        try:
            segments.append(SegmentScript(**item))
        except Exception as exc:
            logger.warning("Skipping malformed segment at index %d: %s", idx, exc)

    return segments


def _parse_single_segment(raw: str) -> SegmentScript | None:
    """Parse a single segment JSON from a per-scene Gemini call.

    Args:
        raw: Raw JSON string from the model response.

    Returns:
        A validated ``SegmentScript`` or ``None`` on failure.
    """
    cleaned = _strip_fences(raw)
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError as exc:
        logger.error("Per-scene script output is not valid JSON: %s", exc)
        return None

    # Handle array wrapping (model may return [{}] instead of {})
    if isinstance(parsed, list) and len(parsed) >= 1:
        parsed = parsed[0]

    if not isinstance(parsed, dict):
        logger.error(
            "Per-scene script output is not a JSON object (got %s)",
            type(parsed).__name__,
        )
        return None

    try:
        return SegmentScript(**parsed)
    except Exception as exc:
        logger.warning("Failed to validate per-scene segment: %s", exc)
        return None


# ---------------------------------------------------------------------------
# Firestore persistence helper
# ---------------------------------------------------------------------------


def _segment_to_firestore_doc(segment: SegmentScript) -> dict[str, Any]:
    """Convert a ``SegmentScript`` to the Firestore document dict.

    Factored out so the same data shape is used whether writing via batch or
    individually.

    Args:
        segment: Parsed and validated segment.

    Returns:
        Firestore document fields.
    """
    return {
        "sceneId": segment.scene_id,
        "title": segment.title,
        "script": segment.narration_script,
        "visualDescriptions": segment.visual_descriptions,
        "veo2Scene": segment.veo2_scene,
        "mood": segment.mood,
        "narrativeRole": segment.narrative_role,
        "sources": segment.sources,
        "imageUrls": [],       # Populated by Phase V
        "videoUrl": None,      # Populated by Phase V
        "graphEdges": [],      # Reserved for future branching
        "status": "pending",   # Updated to "ready" by Phase V
        "createdAt": firestore.SERVER_TIMESTAMP,
    }


async def _write_segment_to_firestore(
    db: firestore.AsyncClient,
    session_id: str,
    segment: SegmentScript,
) -> None:
    """Write a single SegmentScript to Firestore.

    Creates or overwrites the document at
    ``/sessions/{sessionId}/segments/{segmentId}``.

    Args:
        db: Async Firestore client.
        session_id: Parent session.
        segment: Parsed and validated segment to persist.
    """
    ref = (
        db.collection("sessions")
        .document(session_id)
        .collection("segments")
        .document(segment.id)
    )
    await ref.set(_segment_to_firestore_doc(segment))


async def _write_segments_to_firestore(
    db: firestore.AsyncClient,
    session_id: str,
    segments: list[SegmentScript],
) -> None:
    """Batch-write all SegmentScript objects to Firestore in a single commit.

    Creates or overwrites documents at
    ``/sessions/{sessionId}/segments/{segmentId}`` for every segment. Uses a
    ``WriteBatch`` to collapse N sequential round-trips into one atomic commit.

    Args:
        db: Async Firestore client.
        session_id: Parent session.
        segments: Parsed and validated segments to persist.
    """
    batch = db.batch()
    for segment in segments:
        ref = (
            db.collection("sessions")
            .document(session_id)
            .collection("segments")
            .document(segment.id)
        )
        batch.set(ref, _segment_to_firestore_doc(segment))
    await batch.commit()


# ---------------------------------------------------------------------------
# Per-scene Gemini call (for per-segment streaming pipeline)
# ---------------------------------------------------------------------------


async def generate_single_segment(
    *,
    scene_index: int,
    scene_brief: dict[str, Any],
    aggregated_research: str,
    visual_bible: str,
    document_map: str,
    is_last_scene: bool,
    total_scenes: int,
    session_id: str,
    firestore_project: str,
    emitter: SSEEmitter | None = None,
) -> SegmentScript | None:
    """Generate a single segment script for one scene via a direct Gemini call.

    This function is the per-segment entry point used by the streaming pipeline
    (``pipeline.py`` Workstream B). It replaces the monolithic ADK agent call
    with a targeted Gemini call that produces ONE ``SegmentScript`` and immediately
    writes it to Firestore + emits SSE events.

    Args:
        scene_index: Zero-based index of this scene.
        scene_brief: The scene brief dict for this scene.
        aggregated_research: Merged research string from Phase II aggregator.
        visual_bible: Imagen 3 style guide string from Phase I.
        document_map: Document outline string from Phase I.
        is_last_scene: Whether this is the final scene (controls bridge sentence rule).
        total_scenes: Total number of scenes in the documentary.
        session_id: Parent session ID.
        firestore_project: GCP project ID for Firestore.
        emitter: Optional SSE emitter for frontend events.

    Returns:
        The generated ``SegmentScript``, or ``None`` if generation failed.
    """
    import asyncio

    segment_id = f"segment_{scene_index}"
    scene_id = scene_brief.get("scene_id", f"scene_{scene_index}")
    title = scene_brief.get("title", f"Scene {scene_index}")
    agent_id = f"script_agent_{scene_id}"

    t_start = time.monotonic()

    # -- Emit queued/searching status ------------------------------------------
    if emitter is not None:
        await emitter.emit(
            "agent_status",
            build_agent_status_event(
                agent_id=agent_id,
                status="queued",
                query=f"Scripting scene {scene_index + 1}/{total_scenes}: {title}",
            ),
        )
        await emitter.emit(
            "agent_status",
            build_agent_status_event(
                agent_id=agent_id,
                status="searching",
                query=f"Composing narration for: {title}",
            ),
        )

    # -- Build per-scene prompt ------------------------------------------------
    bridge_note = (
        ""
        if is_last_scene
        else "\n\nIMPORTANT: This is NOT the last scene. Include a bridge sentence (Rule 5) at the end."
    )
    if is_last_scene:
        bridge_note = "\n\nIMPORTANT: This IS the last scene. Do NOT include a bridge sentence. End with resonance (Rule 4)."

    prompt = (
        f"Generate a single documentary segment for the following scene.\n\n"
        f"Scene Brief (scene {scene_index + 1} of {total_scenes}):\n"
        f"{json.dumps(scene_brief, indent=2, ensure_ascii=False)}\n\n"
        f"Aggregated Research:\n{aggregated_research}\n\n"
        f"Visual Bible (style guide):\n{visual_bible}\n\n"
        f"Document Map:\n{document_map}\n\n"
        f"The segment id MUST be \"{segment_id}\".\n"
        f"The scene_id MUST be \"{scene_id}\".\n"
        f"The narrative_role MUST be \"{scene_brief.get('narrative_role', '')}\"."
        f"{bridge_note}"
    )

    # -- Initialize Gemini client ----------------------------------------------
    project_id = firestore_project or os.environ.get("GCP_PROJECT_ID", "")
    client = google_genai.Client(
        vertexai=True if project_id else False,
        project=project_id or None,
        location="us-central1" if project_id else None,
    )

    # -- Call Gemini with retry ------------------------------------------------
    raw_text: str | None = None
    last_error: Exception | None = None

    for attempt in range(_MAX_RETRIES):
        try:
            response = await client.aio.models.generate_content(
                model=_MODEL,
                contents=prompt,
                config=genai_types.GenerateContentConfig(
                    system_instruction=_PER_SCENE_SYSTEM_INSTRUCTION,
                    max_output_tokens=4096,
                    temperature=0.7,
                    response_mime_type="application/json",
                ),
            )
            raw_text = response.text
            break
        except Exception as exc:
            last_error = exc
            wait = 2 ** attempt
            logger.warning(
                "Per-scene script call attempt %d/%d failed for %s: %s. "
                "Retrying in %ds.",
                attempt + 1,
                _MAX_RETRIES,
                segment_id,
                exc,
                wait,
            )
            await asyncio.sleep(wait)

    if raw_text is None:
        logger.error(
            "Per-scene script generation failed for %s after %d retries: %s",
            segment_id,
            _MAX_RETRIES,
            last_error,
        )
        if emitter is not None:
            await emitter.emit(
                "agent_status",
                build_agent_status_event(
                    agent_id=agent_id,
                    status="error",
                    elapsed=round(time.monotonic() - t_start, 1),
                    error_message=f"Script generation failed for {title}",
                ),
            )
        return None

    # -- Parse single segment --------------------------------------------------
    segment = _parse_single_segment(raw_text)

    if segment is None:
        logger.error(
            "Per-scene script parsing failed for %s. Raw (first 500 chars): %s",
            segment_id,
            raw_text[:500],
        )
        if emitter is not None:
            await emitter.emit(
                "agent_status",
                build_agent_status_event(
                    agent_id=agent_id,
                    status="error",
                    elapsed=round(time.monotonic() - t_start, 1),
                    error_message=f"Script parsing failed for {title}",
                ),
            )
        return None

    # Ensure IDs are correct (model may hallucinate different IDs)
    segment.id = segment_id
    segment.scene_id = scene_id

    # Enrich narrative_role from scene brief if missing
    if not segment.narrative_role:
        segment.narrative_role = scene_brief.get("narrative_role", "")

    # -- Write to Firestore immediately ----------------------------------------
    db = firestore.AsyncClient(project=project_id)
    try:
        await _write_segment_to_firestore(db, session_id, segment)
        logger.debug(
            "Wrote segment %s to Firestore for session %s",
            segment_id,
            session_id,
        )
    except Exception as exc:
        logger.warning(
            "Failed to write segment %s to Firestore: %s",
            segment_id,
            exc,
        )

    # -- Entity extraction (non-critical) --------------------------------------
    try:
        from .entity_extractor import extract_entities

        # Note: ocr_pages not available here since we don't have session.state
        # Entity extraction will be done in the pipeline if needed
    except Exception:
        pass

    # -- Emit SSE events immediately -------------------------------------------
    t_elapsed = round(time.monotonic() - t_start, 1)

    if emitter is not None:
        await emitter.emit(
            "segment_update",
            build_segment_update_event(
                segment_id=segment_id,
                scene_id=scene_id,
                status="generating",
                title=segment.title,
                mood=segment.mood,
                narration_script=segment.narration_script,
            ),
        )
        await emitter.emit(
            "agent_status",
            build_agent_status_event(
                agent_id=agent_id,
                status="done",
                elapsed=t_elapsed,
                facts=[
                    f"Segment \"{segment.title}\" scripted in {t_elapsed}s",
                ],
            ),
        )

    logger.info(
        "Per-scene script complete: %s (%s) in %.1fs for session %s",
        segment_id,
        segment.title,
        t_elapsed,
        session_id,
    )

    return segment


# ---------------------------------------------------------------------------
# ScriptAgentOrchestrator -- Phase III BaseAgent (per-scene streaming)
# ---------------------------------------------------------------------------


class ScriptAgentOrchestrator(BaseAgent):
    """Phase III orchestrator: per-scene Gemini calls -> parse -> store -> emit.

    Makes N sequential ``client.aio.models.generate_content`` calls (gemini-2.5-flash),
    one per scene brief, producing and emitting each ``SegmentScript`` immediately
    without waiting for the entire script to be generated.
    """

    model_config = ConfigDict(arbitrary_types_allowed=True)

    firestore_project: str = Field(
        ...,
        description="GCP project ID for Firestore operations.",
    )
    emitter: Any = Field(
        default=None,
        description="Optional SSE emitter for frontend progress events.",
    )
    sub_agents: list[BaseAgent] = Field(
        default_factory=list,
        description=(
            "Declared for ADK BaseAgent compatibility. "
            "No sub-agents -- all work is done via direct Gemini calls."
        ),
    )

    async def _run_async_impl(
        self,
        ctx: InvocationContext,
    ) -> AsyncGenerator[Any, None]:
        """Execute Phase III: per-scene script generation.

        For each scene brief, makes a Gemini call, parses the result, writes
        to Firestore, and emits SSE events immediately.

        Yields nothing (no ADK sub-agent events). The method signature
        satisfies the AsyncGenerator protocol required by ADK.
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
                    phase=3,
                    label="SYNTHESIS",
                    message="Writing narration and visual direction for each scene",
                ),
            )

        # ------------------------------------------------------------------
        # Read inputs from session state
        # ------------------------------------------------------------------
        scene_briefs: list[dict[str, Any]] = ctx.session.state.get("scene_briefs", [])
        aggregated_research: str = str(
            ctx.session.state.get("aggregated_research", "")
        )
        visual_bible: str = str(ctx.session.state.get("visual_bible", ""))
        document_map: str = str(ctx.session.state.get("document_map", ""))

        num_scenes = len(scene_briefs)

        if not scene_briefs:
            logger.error(
                "Phase III: no scene_briefs in session state for session %s",
                session_id,
            )
            return
            yield  # noqa: unreachable -- satisfies AsyncGenerator protocol

        # ------------------------------------------------------------------
        # Announce script agent as queued
        # ------------------------------------------------------------------
        if self.emitter is not None:
            await self.emitter.emit(
                "agent_status",
                build_agent_status_event(
                    agent_id="script_agent",
                    status="queued",
                    query=(
                        f"Scripting {num_scenes} scene"
                        f"{'s' if num_scenes != 1 else ''}"
                    ),
                ),
            )
            await self.emitter.emit(
                "agent_status",
                build_agent_status_event(
                    agent_id="script_agent",
                    status="searching",
                    query="Composing narration and visual prompts per scene",
                ),
            )

        # ------------------------------------------------------------------
        # Per-scene sequential generation
        # ------------------------------------------------------------------
        segments: list[SegmentScript] = []

        for i, brief in enumerate(scene_briefs):
            is_last = i == num_scenes - 1

            segment = await generate_single_segment(
                scene_index=i,
                scene_brief=brief,
                aggregated_research=aggregated_research,
                visual_bible=visual_bible,
                document_map=document_map,
                is_last_scene=is_last,
                total_scenes=num_scenes,
                session_id=session_id,
                firestore_project=self.firestore_project,
                emitter=self.emitter,
            )

            if segment is not None:
                segments.append(segment)

                # Append incrementally to session state so downstream agents
                # can start processing this segment immediately
                existing: list[dict[str, Any]] = ctx.session.state.get("script", [])
                existing.append(segment.model_dump())
                ctx.session.state["script"] = existing

        # ------------------------------------------------------------------
        # Entity extraction for all segments (non-critical)
        # ------------------------------------------------------------------
        db = firestore.AsyncClient(project=self.firestore_project)
        ocr_pages: list[str] = ctx.session.state.get("ocr_pages", [])
        for segment in segments:
            if ocr_pages and segment.narration_script:
                try:
                    from .entity_extractor import extract_entities

                    highlights = await extract_entities(
                        narration_script=segment.narration_script,
                        page_texts=ocr_pages,
                        segment_id=segment.id,
                    )
                    if highlights:
                        await (
                            db.collection("sessions")
                            .document(session_id)
                            .collection("segments")
                            .document(segment.id)
                            .update({"entityHighlights": highlights})
                        )
                except Exception:
                    pass  # Non-critical -- don't break the pipeline

        # ------------------------------------------------------------------
        # Stats update and completion event
        # ------------------------------------------------------------------
        t_total_elapsed = time.monotonic() - t_start

        if self.emitter is not None:
            await self.emitter.emit(
                "stats_update",
                {
                    "type": "stats_update",
                    "segmentsReady": len(segments),
                },
            )
            await self.emitter.emit(
                "agent_status",
                build_agent_status_event(
                    agent_id="script_agent",
                    status="done",
                    query="Generating documentary narration and visual descriptions",
                    elapsed=round(t_total_elapsed, 1),
                    facts=[
                        f"{len(segments)} segment(s) scripted and written to Firestore",
                        "session.state['script'] updated with validated SegmentScript list",
                    ],
                ),
            )

        logger.info(
            "Phase III complete for session %s: %d segments in %.1fs",
            session_id,
            len(segments),
            t_total_elapsed,
        )

        return
        yield  # noqa: unreachable -- satisfies AsyncGenerator protocol


# ---------------------------------------------------------------------------
# Factory function
# ---------------------------------------------------------------------------


def build_script_agent_orchestrator(
    emitter: SSEEmitter | None = None,
) -> ScriptAgentOrchestrator:
    """Construct a ``ScriptAgentOrchestrator`` from environment variables.

    Required environment variables:
        - ``GCP_PROJECT_ID``: Google Cloud project ID for Firestore writes.

    Args:
        emitter: Optional SSE emitter for frontend progress events.

    Returns:
        Configured ``ScriptAgentOrchestrator`` ready for pipeline integration.
    """
    return ScriptAgentOrchestrator(
        name="script_agent_orchestrator",
        description=(
            "Phase III: Makes per-scene Gemini calls (gemini-2.5-flash) to generate "
            "narration and visual descriptions for each SceneBrief individually, "
            "validates the output, writes segments to Firestore immediately, "
            "and emits segment_update SSE events so the frontend updates "
            "incrementally without waiting for all segments."
        ),
        firestore_project=os.environ["GCP_PROJECT_ID"],
        emitter=emitter,
    )
