"""Phase 4.0 of the AI Historian documentary pipeline: Narrative Visual Planner.

Makes a single Gemini Pro call to produce a ``VisualStoryboard`` -- the
director's shot list that assigns unique visual territory to each scene
before any Phase IV archival research begins.

Session state contract
----------------------
**Inputs** (must be set before this agent runs):
  - ``session.state["scene_briefs"]`` -- list[dict] of SceneBrief dicts (Phase I) **required**
  - ``session.state["script"]``       -- list[dict] of SegmentScript dicts (Phase III) **optional**
  - ``session.state["visual_bible"]`` -- Imagen 3 style guide (Phase I) **optional**

**Outputs** (written by this agent):
  - ``session.state["visual_storyboard"]`` -- serialised ``VisualStoryboard`` dict
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
from collections.abc import AsyncGenerator
from typing import Any

from google import genai as google_genai
from google.adk.agents.base_agent import BaseAgent
from google.adk.agents.invocation_context import InvocationContext
from google.genai import types as genai_types
from pydantic import ConfigDict, Field, ValidationError

from .sse_helpers import (
    SSEEmitter,
    build_agent_status_event,
    build_pipeline_phase_event,
)
from .storyboard_types import SceneVisualPlan, VisualStoryboard

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_MAX_RETRIES: int = 3
_MODEL: str = "gemini-2.5-flash"

# Default frame concept used when the model produces an invalid entry.
_DEFAULT_FRAME_CONCEPT: str = (
    "A wide establishing shot of the historical setting, "
    "showing architecture and ambient lighting"
)

# Default search query used when the model produces an invalid entry.
_DEFAULT_SEARCH_QUERY: str = "historical primary source archival photograph {era} {location}"


# ---------------------------------------------------------------------------
# Prompt construction
# ---------------------------------------------------------------------------


def _build_prompt(
    scene_briefs: list[dict[str, Any]],
    script_segments: list[dict[str, Any]],
    visual_bible: str,
    session_id: str,
) -> str:
    """Build the structured prompt for the Gemini Pro storyboard call.

    Args:
        scene_briefs: Serialised SceneBrief dicts from session.state.
        script_segments: Serialised SegmentScript dicts (may be empty).
        visual_bible: Visual bible string from Phase I (may be empty).
        session_id: Session ID for the output schema.

    Returns:
        Complete prompt string.
    """
    n_scenes = len(scene_briefs)

    # Build a concise scene summary for each brief
    scene_summary_lines: list[str] = []
    for brief in scene_briefs:
        sid = brief.get("scene_id", "unknown")
        title = brief.get("title", "Untitled")
        era = brief.get("era", "unknown era")
        location = brief.get("location", "unknown location")
        mood = brief.get("mood", "")
        role = brief.get("narrative_role", "")
        hook = brief.get("cinematic_hook", "")
        entities = ", ".join(brief.get("key_entities", [])[:5])
        scene_summary_lines.append(
            f"  - {sid}: \"{title}\" | era={era} | location={location} | "
            f"mood={mood} | role={role} | entities=[{entities}] | hook=\"{hook}\""
        )
    scene_summaries = "\n".join(scene_summary_lines)

    # Build optional script enrichment
    script_section = ""
    if script_segments:
        script_lines: list[str] = []
        for seg in script_segments:
            sid = seg.get("scene_id", "unknown")
            title = seg.get("title", "")
            mood = seg.get("mood", "")
            role = seg.get("narrative_role", "")
            script_lines.append(
                f"  - {sid}: title=\"{title}\" | mood={mood} | narrative_role={role}"
            )
        script_section = (
            "\n\nSCRIPT SEGMENT TITLES AND MOODS (from Phase III):\n"
            + "\n".join(script_lines)
        )

    # Build optional visual bible excerpt
    bible_section = ""
    if visual_bible:
        # Truncate to keep prompt manageable
        truncated = visual_bible[:2000]
        bible_section = f"\n\nVISUAL BIBLE EXCERPT:\n{truncated}"

    # JSON schema example
    schema_example = json.dumps(
        {
            "session_id": session_id,
            "scenes": {
                "scene_0": {
                    "scene_id": "scene_0",
                    "primary_subject": "The grand bazaar at its commercial peak",
                    "temporal_state": "Grand Bazaar in active daily use circa 1560, "
                    "freshly expanded under Suleiman the Magnificent, stone vaults "
                    "intact with recent masonry, painted interior arches in Ottoman "
                    "geometric patterns — NOT the modern tourist market",
                    "perspective": "Eye-level walking through crowded market stalls",
                    "time_of_day": "Late afternoon golden hour",
                    "color_palette": ["burnt sienna", "saffron gold", "deep indigo"],
                    "avoid_list": [
                        "Do not show military formations (scene_1 territory)",
                        "Do not show religious ceremonies (scene_2 territory)",
                        "Modern tourist bazaar with electric lighting and contemporary goods",
                    ],
                    "targeted_searches": [
                        "Ottoman bazaar merchant stalls 16th century archaeological reconstruction",
                        "Istanbul Grand Bazaar Suleiman era original appearance scholarly illustration",
                        "Ottoman marketplace 1560 historical reconstruction museum rendering",
                    ],
                    "frame_concepts": [
                        "Wide shot of covered bazaar interior with shafts of dusty "
                        "light falling through roof openings onto silk merchants, "
                        "freshly laid stone vaults with painted geometric arches, "
                        "warm amber tones",
                        "Medium shot of a spice merchant weighing goods on a brass "
                        "scale, surrounded by pyramids of coloured powder, soft "
                        "side-lighting from an oil lantern in a recently built stall",
                        "Close-up of ornate metalwork on a merchant's strongbox, "
                        "showing period-specific geometric patterns, shallow depth "
                        "of field with bokeh background",
                        "Dramatic low-angle shot looking up at the bazaar's vaulted "
                        "ceiling with smoke from incense drifting through light beams, "
                        "high contrast chiaroscuro, stone arches pristine and unweathered",
                    ],
                    "narrative_bridge": "From the commerce of the bazaar, we follow "
                    "a royal messenger carrying trade reports toward the palace walls",
                },
            },
            "global_palette": "Ottoman warm tones: amber, terracotta, deep blue, "
            "gold leaf highlights. Consistent grain texture across all scenes.",
            "color_temperature_arc": "Warm gold opening (scene_0) -> neutral "
            "documentary tone (scene_1) -> cool, high-contrast tension (scene_2) "
            "-> warm amber resolution (scene_3)",
        },
        indent=2,
    )

    prompt = f"""You are the visual director for a cinematic documentary. You have analyzed a historical document divided into {n_scenes} scenes. Your job is to write a SHOT LIST ensuring each scene is visually distinct.

RULES:
1. No two scenes may depict the same primary_subject. If scene_0 shows workers building X, scene_1 cannot also show workers — it must show a completely different aspect of the story.
2. Each avoid_list MUST reference what is shown in adjacent scenes by name, preventing visual repetition across the documentary.
3. targeted_searches must be archival-grade queries (museum databases, academic archaeology, primary historical sources) — NOT queries that would find tourist photography or stock photos. Exactly 3 per scene.
4. frame_concepts must be 4 genuinely different MOMENTS or SUBJECTS — not the same subject from 4 camera angles. Each frame_concept must describe who/what is in the frame, what is happening, and the lighting condition. Each must be at least 20 characters long.
5. color_temperature_arc across ALL scenes should create emotional progression matching the dramatic arc: warm opening -> neutral rising_action -> cool/high-contrast climax -> warm resolution -> melancholic coda.
6. perspective should vary across scenes — do not use the same camera philosophy twice.
7. time_of_day should vary across scenes to create visual rhythm.
8. For each scene, specify the TEMPORAL STATE of the primary subject in the "temporal_state" field. This is CRITICAL for historical accuracy.
  - If depicting a building being constructed: specify how far along construction is, what materials are visible, scaffolding details.
  - If depicting a building in its prime: specify "fully intact, in active use at [date]" with specific architectural details that distinguish it from its modern state.
  - If depicting a building after destruction/abandonment: specify the exact damage state at that moment in history.
  - ALWAYS include whether it should look NEWLY BUILT or AGED/USED — never leave this ambiguous.
  - Example: "Colosseum freshly completed in 80 AD, all four exterior stories intact, travertine limestone cream-white, marble cladding on exterior, velarium awning deployed, bronze shields between arches, NO weathering, no damage, no ruins."
9. For ancient Greek and Roman scenes, ALWAYS specify polychrome paint in temporal_state. Ancient buildings and sculptures were vividly painted, NOT plain white marble. Include: "painted in vivid polychrome — cinnabar red, Egyptian blue, and gold leaf over marble — NOT plain white unpainted marble."
10. targeted_searches must find PERIOD-ACCURATE RECONSTRUCTION sources, not tourist photos. For any famous historical site, use queries like:
  - "[site] [year] archaeological reconstruction digital rendering"
  - "[site] original appearance [era] museum scholarly illustration"
  - "[site] polychrome fully intact historical reconstruction"
  NEVER use queries that would return modern tourist photography of ruins.
11. avoid_list MUST include the modern/ruined state of any famous historical site. Example: "modern Colosseum ruins with missing walls", "weathered modern tourist version", "contemporary ruin photographs", "plain white unpainted marble."
12. frame_concepts must specify the temporal state in each concept. Each frame concept should mention: who is present, what they are doing, AND what state the architecture is in. Example: "Workers finishing the marble cladding on the second story, freshly cut white marble with crisp edges, wooden scaffolding still in place, late afternoon light."

SCENE BRIEFS:
{scene_summaries}{script_section}{bible_section}

OUTPUT INSTRUCTION:
Return ONLY a valid JSON object matching this exact schema (no markdown fences, no explanation, no commentary):

{schema_example}

Your response must contain exactly {n_scenes} scene entries, one per scene_id listed above. The session_id must be "{session_id}"."""

    return prompt


# ---------------------------------------------------------------------------
# Response parsing
# ---------------------------------------------------------------------------


def _strip_markdown_fences(text: str) -> str:
    """Remove markdown code fences from a response string.

    Handles ```json ... ```, ``` ... ```, and leading/trailing whitespace.
    """
    stripped = text.strip()
    # Remove opening fence
    stripped = re.sub(r"^```(?:json)?\s*\n?", "", stripped)
    # Remove closing fence
    stripped = re.sub(r"\n?\s*```\s*$", "", stripped)
    return stripped.strip()


def _repair_scene_plan(
    scene_id: str,
    raw: dict[str, Any],
    brief: dict[str, Any],
) -> dict[str, Any]:
    """Attempt to repair a SceneVisualPlan dict that would fail validation.

    Fills missing or invalid fields with sensible defaults derived from the
    scene brief rather than crashing the pipeline.

    Args:
        scene_id: The scene ID this plan belongs to.
        raw: Raw dict parsed from the model's JSON output.
        brief: The corresponding SceneBrief dict for fallback data.

    Returns:
        A repaired dict that should pass SceneVisualPlan validation.
    """
    repaired = dict(raw)
    repaired.setdefault("scene_id", scene_id)

    era = brief.get("era", "historical period")
    location = brief.get("location", "the location")
    title = brief.get("title", "the scene")

    # Ensure primary_subject
    if not repaired.get("primary_subject"):
        repaired["primary_subject"] = title

    # Ensure perspective
    if not repaired.get("perspective"):
        repaired["perspective"] = "Eye-level documentary framing"

    # Ensure time_of_day
    if not repaired.get("time_of_day"):
        repaired["time_of_day"] = "Natural daylight"

    # Ensure color_palette has 3-4 items
    palette = repaired.get("color_palette", [])
    if not isinstance(palette, list) or len(palette) < 3:
        repaired["color_palette"] = ["warm amber", "muted earth", "deep shadow"]

    # Ensure avoid_list
    if not repaired.get("avoid_list"):
        repaired["avoid_list"] = ["Avoid repeating subjects from adjacent scenes"]

    # Ensure exactly 3 targeted_searches
    searches = repaired.get("targeted_searches", [])
    if not isinstance(searches, list):
        searches = []
    # Filter out empty strings
    searches = [s for s in searches if isinstance(s, str) and s.strip()]
    while len(searches) < 3:
        searches.append(
            _DEFAULT_SEARCH_QUERY.format(era=era, location=location)
        )
    repaired["targeted_searches"] = searches[:3]

    # Ensure exactly 4 frame_concepts, each >= 20 chars
    concepts = repaired.get("frame_concepts", [])
    if not isinstance(concepts, list):
        concepts = []
    # Pad short or missing concepts
    valid_concepts: list[str] = []
    for c in concepts:
        if isinstance(c, str) and len(c) >= 20:
            valid_concepts.append(c)
    while len(valid_concepts) < 4:
        valid_concepts.append(_DEFAULT_FRAME_CONCEPT)
    repaired["frame_concepts"] = valid_concepts[:4]

    # Ensure temporal_state
    if not repaired.get("temporal_state"):
        era = brief.get("era", "historical period")
        repaired["temporal_state"] = (
            f"Historical reconstruction of this scene from {era}, fully intact "
            f"and in active use, period-accurate construction materials and "
            f"decoration, no modern elements or damage"
        )

    # Ensure narrative_bridge
    if not repaired.get("narrative_bridge"):
        repaired["narrative_bridge"] = ""

    return repaired


# ---------------------------------------------------------------------------
# NarrativeVisualPlanner -- Phase 4.0 BaseAgent
# ---------------------------------------------------------------------------


class NarrativeVisualPlanner(BaseAgent):
    """Phase 4.0: Plans unique visual territory for each scene.

    Makes a single Gemini Pro call to produce a ``VisualStoryboard`` with
    per-scene primary subjects, avoid lists, targeted search queries, and
    4 distinct frame concepts.  This storyboard is consumed by the Visual
    Research Orchestrator (Phase IV) to drive targeted archival searches
    and by the Visual Director (Phase V) for frame generation.

    The agent writes ``session.state["visual_storyboard"]`` and emits SSE
    events for frontend progress display.
    """

    model_config = ConfigDict(arbitrary_types_allowed=True)

    emitter: Any = Field(
        default=None,
        description="Optional SSE emitter for frontend progress events.",
    )
    sub_agents: list[BaseAgent] = Field(
        default_factory=list,
        description="Declared for ADK BaseAgent compatibility. Unused.",
    )

    async def _run_async_impl(
        self,
        ctx: InvocationContext,
    ) -> AsyncGenerator[Any, None]:
        """Execute Phase 4.0: build prompt -> Gemini Pro call -> parse storyboard.

        Yields nothing (no ADK sub-agent events).  The trailing ``yield``
        satisfies the ``AsyncGenerator`` protocol required by ADK.
        """
        session_id: str = ctx.session.id
        t_start = time.monotonic()

        # --------------------------------------------------------------
        # Phase announcement
        # --------------------------------------------------------------
        if self.emitter:
            await self.emitter.emit(
                "pipeline_phase",
                build_pipeline_phase_event(
                    phase=4,
                    label="VISUAL STORYBOARD",
                    message="Director is planning unique visual territory for each scene",
                ),
            )
            await self.emitter.emit(
                "agent_status",
                build_agent_status_event(
                    agent_id="narrative_visual_planner",
                    status="searching",
                    query="Planning visual storyboard for all scenes",
                ),
            )

        # --------------------------------------------------------------
        # Read inputs from session state
        # --------------------------------------------------------------
        scene_briefs: list[dict[str, Any]] = ctx.session.state.get(
            "scene_briefs", []
        )

        if not scene_briefs:
            logger.error(
                "Phase 4.0: session.state['scene_briefs'] is empty for session %s. "
                "Ensure Phase I (DocumentAnalyzerAgent) completed successfully.",
                session_id,
            )
            if self.emitter:
                await self.emitter.emit(
                    "agent_status",
                    build_agent_status_event(
                        agent_id="narrative_visual_planner",
                        status="error",
                        query="Planning visual storyboard for documentary scenes",
                        elapsed=round(time.monotonic() - t_start, 1),
                    ),
                )
            return
            yield  # noqa: unreachable

        script_segments: list[dict[str, Any]] = ctx.session.state.get(
            "script", []
        )
        visual_bible: str = ctx.session.state.get("visual_bible", "")

        # Build brief lookup for repair fallbacks
        brief_by_scene: dict[str, dict[str, Any]] = {
            b.get("scene_id", f"scene_{i}"): b
            for i, b in enumerate(scene_briefs)
        }

        # --------------------------------------------------------------
        # Build prompt
        # --------------------------------------------------------------
        prompt = _build_prompt(
            scene_briefs=scene_briefs,
            script_segments=script_segments,
            visual_bible=visual_bible,
            session_id=session_id,
        )

        logger.debug(
            "Phase 4.0: built prompt (%d chars) for %d scenes",
            len(prompt),
            len(scene_briefs),
        )

        # --------------------------------------------------------------
        # Call Gemini Pro with retry
        # --------------------------------------------------------------
        client = google_genai.Client(
            vertexai=True,
            project=os.environ["GCP_PROJECT_ID"],
            location=os.environ.get("VERTEX_AI_LOCATION", "us-central1"),
        )

        raw_text: str | None = None
        last_error: Exception | None = None

        for attempt in range(_MAX_RETRIES):
            try:
                response = await client.aio.models.generate_content(
                    model=_MODEL,
                    contents=prompt,
                    config=genai_types.GenerateContentConfig(
                        temperature=0.7,
                        response_mime_type="application/json",
                    ),
                )
                raw_text = response.text
                break
            except Exception as exc:
                last_error = exc
                wait = 2**attempt
                logger.warning(
                    "Phase 4.0: Gemini call attempt %d/%d failed: %s. "
                    "Retrying in %ds.",
                    attempt + 1,
                    _MAX_RETRIES,
                    exc,
                    wait,
                )
                await asyncio.sleep(wait)

        if raw_text is None:
            logger.error(
                "Phase 4.0: all %d Gemini retries exhausted for session %s: %s",
                _MAX_RETRIES,
                session_id,
                last_error,
            )
            if self.emitter:
                await self.emitter.emit(
                    "agent_status",
                    build_agent_status_event(
                        agent_id="narrative_visual_planner",
                        status="error",
                        query="Planning visual storyboard for documentary scenes",
                        elapsed=round(time.monotonic() - t_start, 1),
                    ),
                )
            return
            yield  # noqa: unreachable

        # --------------------------------------------------------------
        # Parse response
        # --------------------------------------------------------------
        cleaned = _strip_markdown_fences(raw_text)

        try:
            parsed = json.loads(cleaned)
        except json.JSONDecodeError as exc:
            logger.error(
                "Phase 4.0: failed to parse Gemini JSON for session %s: %s\n"
                "Raw response (first 2000 chars): %s",
                session_id,
                exc,
                raw_text[:2000],
            )
            if self.emitter:
                await self.emitter.emit(
                    "agent_status",
                    build_agent_status_event(
                        agent_id="narrative_visual_planner",
                        status="error",
                        query="Planning visual storyboard for documentary scenes",
                        elapsed=round(time.monotonic() - t_start, 1),
                    ),
                )
            return
            yield  # noqa: unreachable

        # --------------------------------------------------------------
        # Validate and repair each scene plan
        # --------------------------------------------------------------
        raw_scenes: dict[str, Any] = parsed.get("scenes", {})
        validated_scenes: dict[str, SceneVisualPlan] = {}

        for brief in scene_briefs:
            scene_id = brief.get("scene_id", "")
            if not scene_id:
                continue

            raw_plan = raw_scenes.get(scene_id, {})
            if not raw_plan:
                logger.warning(
                    "Phase 4.0: model output missing scene %s — building from brief",
                    scene_id,
                )
                raw_plan = {}

            # Repair before validation
            repaired = _repair_scene_plan(scene_id, raw_plan, brief)

            try:
                plan = SceneVisualPlan.model_validate(repaired)
                validated_scenes[scene_id] = plan
            except ValidationError as exc:
                logger.warning(
                    "Phase 4.0: SceneVisualPlan validation failed for %s "
                    "even after repair: %s. Applying aggressive defaults.",
                    scene_id,
                    exc,
                )
                # Last-resort fallback: build a minimal valid plan
                era_fb = brief.get("era", "historical period")
                fallback = SceneVisualPlan(
                    scene_id=scene_id,
                    primary_subject=brief.get("title", "Historical scene"),
                    perspective="Eye-level documentary framing",
                    time_of_day="Natural daylight",
                    color_palette=["warm amber", "muted earth", "deep shadow"],
                    avoid_list=["Avoid repeating subjects from adjacent scenes"],
                    targeted_searches=[
                        _DEFAULT_SEARCH_QUERY.format(
                            era=brief.get("era", "historical"),
                            location=brief.get("location", "the region"),
                        )
                    ]
                    * 3,
                    frame_concepts=[_DEFAULT_FRAME_CONCEPT] * 4,
                    temporal_state=(
                        f"Historical reconstruction of this scene from {era_fb}, "
                        f"fully intact and in active use, period-accurate "
                        f"construction materials and decoration, no modern "
                        f"elements or damage"
                    ),
                    narrative_bridge="",
                )
                validated_scenes[scene_id] = fallback

        # Build the storyboard
        storyboard = VisualStoryboard(
            session_id=session_id,
            scenes=validated_scenes,
            global_palette=parsed.get(
                "global_palette",
                visual_bible[:500] if visual_bible else "Period-appropriate tones",
            ),
            color_temperature_arc=parsed.get(
                "color_temperature_arc",
                "warm opening -> neutral middle -> warm resolution",
            ),
        )

        # --------------------------------------------------------------
        # Write to session state
        # --------------------------------------------------------------
        ctx.session.state["visual_storyboard"] = storyboard.model_dump()

        t_elapsed = round(time.monotonic() - t_start, 1)

        logger.info(
            "Phase 4.0 complete for session %s: %d scene plans in %.1fs. "
            "Arc: %s",
            session_id,
            len(validated_scenes),
            t_elapsed,
            storyboard.color_temperature_arc,
        )
        logger.debug(
            "Phase 4.0 storyboard primary subjects: %s",
            {sid: p.primary_subject for sid, p in validated_scenes.items()},
        )

        # --------------------------------------------------------------
        # Emit completion
        # --------------------------------------------------------------
        if self.emitter:
            await self.emitter.emit(
                "agent_status",
                build_agent_status_event(
                    agent_id="narrative_visual_planner",
                    status="done",
                    query="Planning visual storyboard for documentary scenes",
                    elapsed=t_elapsed,
                    facts=[
                        f"{len(validated_scenes)} scene visual plans created",
                        f"Color arc: {storyboard.color_temperature_arc}",
                        "session.state['visual_storyboard'] populated",
                    ],
                ),
            )

        # Required by ADK BaseAgent -- yield nothing (no sub-agent events)
        return
        yield  # noqa: unreachable -- satisfies AsyncGenerator protocol


# ---------------------------------------------------------------------------
# Factory function
# ---------------------------------------------------------------------------


def build_narrative_visual_planner(
    emitter: SSEEmitter | None = None,
) -> NarrativeVisualPlanner:
    """Construct a ``NarrativeVisualPlanner`` ready for pipeline integration.

    Args:
        emitter: Optional SSE emitter for frontend progress events.

    Returns:
        Configured ``NarrativeVisualPlanner`` instance.
    """
    return NarrativeVisualPlanner(
        name="narrative_visual_planner",
        description=(
            "Phase 4.0: Plans unique visual territory for each scene before "
            "research begins. Produces a VisualStoryboard with per-scene "
            "primary subjects, avoid lists, targeted searches, and 4 distinct "
            "frame concepts."
        ),
        emitter=emitter,
    )
