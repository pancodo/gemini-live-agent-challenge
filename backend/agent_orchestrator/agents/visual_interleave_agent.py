"""Phase 3.3 — Visual Interleave Agent: assigns visual_type to each beat.

Reads beat data from Phase 3.2 and assigns each beat a ``visual_type``
(illustration / cinematic / video) using Gemini 2.0 Flash.  The resulting
``beat_visual_plan`` tells Phase V which generation path to use per beat:

- ``illustration`` — keep the Phase 3.2 Gemini TEXT+IMAGE (no extra work)
- ``cinematic`` — generate an Imagen 3 photorealistic frame
- ``video`` — generate a Veo 2 short clip

Session state contract
----------------------
Inputs (must be present before Phase 3.3 runs):
    session.state["beats"]         -- dict[segment_id, list[dict]] from Phase 3.2
    session.state["script"]        -- list[dict] SegmentScript dicts (Phase III)
    session.state["visual_bible"]  -- Imagen 3 style guide string (Phase I)

Outputs (written by this agent):
    session.state["beat_visual_plan"]  -- dict[segment_id, list[dict]]
                                          BeatVisualAssignment dicts
"""

from __future__ import annotations

import asyncio
import json as _json
import logging
import os
import time
from collections.abc import AsyncGenerator
from typing import Any

from google import genai as google_genai
from google.adk.agents.base_agent import BaseAgent
from google.adk.agents.invocation_context import InvocationContext
from google.genai import types as genai_types
from pydantic import ConfigDict, Field

from .sse_helpers import (
    SSEEmitter,
    build_agent_status_event,
    build_pipeline_phase_event,
)
from .visual_interleave_types import BeatVisualAssignment

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Assignment prompt
# ---------------------------------------------------------------------------

_ASSIGNMENT_PROMPT = """You are the visual director of a cinematic historical documentary.

You must assign a visual generation type to each narration beat.

VISUAL BIBLE (style guide):
{visual_bible}

SEGMENT: "{title}" | MOOD: {mood}

BEATS:
{beats_json}

RULES:
1. Each beat must be assigned exactly one visual_type: "illustration", "cinematic", or "video".
2. If there are 3 or more beats, the segment MUST have at least 1 beat of EACH type.
3. Assignment guidelines:
   - "video" → beats with motion, action, transformation, battles, journeys, ceremonies, processions, flowing water, fire, weather
   - "cinematic" → wide establishing shots, portraits, landscapes, architecture, static grandeur, detailed environments
   - "illustration" → introspective moments, abstract concepts, transitional beats, emotional interludes, philosophical reflection
4. For "cinematic" and "video" beats: write a generation_prompt that combines the beat's narration context with the Visual Bible style. The prompt should be a vivid, detailed scene description suitable for Imagen 3 or Veo 2. 1-3 sentences.
5. For "illustration" beats: set generation_prompt to null (Phase 3.2 already generated the image).

Return ONLY a JSON array (no markdown fences, no wrapper object) where each element is:
{{
  "beat_index": <int>,
  "visual_type": "illustration" | "cinematic" | "video",
  "generation_prompt": "<string or null>"
}}
"""

# ---------------------------------------------------------------------------
# Fallback pattern when Gemini call fails
# ---------------------------------------------------------------------------

_FALLBACK_PATTERN = ["illustration", "cinematic", "illustration", "video"]


def _fallback_assignments(beat_count: int) -> list[dict[str, Any]]:
    """Generate pattern-based visual assignments as a fallback."""
    assignments: list[dict[str, Any]] = []
    for i in range(beat_count):
        vtype = _FALLBACK_PATTERN[i % len(_FALLBACK_PATTERN)]
        assignments.append({
            "beat_index": i,
            "visual_type": vtype,
            "generation_prompt": None,
        })
    return assignments


# ---------------------------------------------------------------------------
# VisualInterleaveAgent
# ---------------------------------------------------------------------------


class VisualInterleaveAgent(BaseAgent):
    """Phase 3.3: assigns visual_type to each beat for downstream generation.

    For each segment, makes a single Gemini 2.0 Flash call that reads all
    beats and assigns visual types (illustration / cinematic / video).
    Segments are processed concurrently with a semaphore of 3.

    Writes ``beat_visual_plan`` to session state for Phase V consumption.
    """

    model_config = ConfigDict(arbitrary_types_allowed=True)

    emitter: Any = Field(default=None)
    gcp_project: str = Field(default="")

    async def _run_async_impl(
        self,
        ctx: InvocationContext,
    ) -> AsyncGenerator[Any, None]:
        """Execute Phase 3.3: visual interleave assignment for all segments."""

        session_id: str = ctx.session.id
        t_start = time.monotonic()

        # ── Emit pipeline phase marker ─────────────────────────────────
        if self.emitter:
            await self.emitter.emit(
                "pipeline_phase",
                build_pipeline_phase_event(
                    phase=3.3,
                    label="VISUAL INTERLEAVE",
                    message=(
                        "Assigning visual generation paths — illustration, "
                        "cinematic frame, or video clip — to each narration beat."
                    ),
                ),
            )
            await self.emitter.emit(
                "agent_status",
                build_agent_status_event(
                    agent_id="visual_interleave",
                    status="queued",
                ),
            )

        # ── Read session state ─────────────────────────────────────────
        beats_map: dict[str, list[dict[str, Any]]] = ctx.session.state.get(
            "beats", {}
        )
        script_raw: list[dict[str, Any]] = ctx.session.state.get("script", [])
        visual_bible: str = ctx.session.state.get("visual_bible", "")

        if not beats_map:
            logger.warning(
                "[VisualInterleave] No beats found for session %s — skipping.",
                session_id,
            )
            if self.emitter:
                await self.emitter.emit(
                    "agent_status",
                    build_agent_status_event(
                        agent_id="visual_interleave",
                        status="done",
                        error_message="No beats to process",
                    ),
                )
            return
            yield  # AsyncGenerator protocol

        # Build a lookup from segment_id → script dict for title/mood
        script_lookup: dict[str, dict[str, Any]] = {}
        for i, seg in enumerate(script_raw):
            sid = seg.get("id", f"segment_{i}")
            script_lookup[sid] = seg

        # ── Emit searching status ──────────────────────────────────────
        if self.emitter:
            await self.emitter.emit(
                "agent_status",
                build_agent_status_event(
                    agent_id="visual_interleave",
                    status="searching",
                    query=f"Assigning visual types for {len(beats_map)} segments",
                ),
            )

        # ── Initialise Gemini client ───────────────────────────────────
        client = google_genai.Client(
            vertexai=True,
            project=self.gcp_project,
            location="us-central1",
        )

        # ── Process segments concurrently ──────────────────────────────
        sem = asyncio.Semaphore(3)
        beat_visual_plan: dict[str, list[dict[str, Any]]] = {}

        async def process_segment(
            segment_id: str,
            beats: list[dict[str, Any]],
        ) -> tuple[str, list[dict[str, Any]]]:
            async with sem:
                seg_info = script_lookup.get(segment_id, {})
                assignments = await self._assign_visual_types(
                    client=client,
                    segment_id=segment_id,
                    beats=beats,
                    title=seg_info.get("title", "Untitled"),
                    mood=seg_info.get("mood", "cinematic"),
                    visual_bible=visual_bible,
                )
                return segment_id, assignments

        results = await asyncio.gather(
            *[
                process_segment(seg_id, seg_beats)
                for seg_id, seg_beats in beats_map.items()
            ],
            return_exceptions=True,
        )

        for result in results:
            if isinstance(result, Exception):
                logger.error("[VisualInterleave] Segment processing failed: %s", result)
            else:
                seg_id, assignments = result
                beat_visual_plan[seg_id] = assignments

        # ── Store in session state ─────────────────────────────────────
        ctx.session.state["beat_visual_plan"] = beat_visual_plan

        t_total = round(time.monotonic() - t_start, 1)
        total_assignments = sum(len(a) for a in beat_visual_plan.values())
        logger.info(
            "[VisualInterleave] Phase 3.3 complete for session %s in %.1fs "
            "(%d segments, %d assignments)",
            session_id,
            t_total,
            len(beat_visual_plan),
            total_assignments,
        )

        # ── Emit done status ───────────────────────────────────────────
        if self.emitter:
            await self.emitter.emit(
                "agent_status",
                build_agent_status_event(
                    agent_id="visual_interleave",
                    status="done",
                    elapsed=t_total,
                ),
            )

        return
        yield  # AsyncGenerator protocol

    async def _assign_visual_types(
        self,
        *,
        client: google_genai.Client,
        segment_id: str,
        beats: list[dict[str, Any]],
        title: str,
        mood: str,
        visual_bible: str,
    ) -> list[dict[str, Any]]:
        """Make a single Gemini 2.0 Flash call to assign visual types for one segment."""

        beat_count = len(beats)

        # Build beats summary for the prompt
        beats_summary = []
        for beat in beats:
            beats_summary.append({
                "beat_index": beat.get("beat_index", 0),
                "narration_text": beat.get("narration_text", ""),
                "direction_text": beat.get("direction_text", ""),
                "has_image": beat.get("image_url") is not None,
            })

        prompt = _ASSIGNMENT_PROMPT.format(
            visual_bible=visual_bible[:2000] if visual_bible else "(no visual bible)",
            title=title or "(untitled scene)",
            mood=mood or "cinematic",
            beats_json=_json.dumps(beats_summary, indent=2),
        )

        try:
            response = await asyncio.wait_for(
                client.aio.models.generate_content(
                    model="gemini-2.0-flash",
                    contents=[prompt],
                    config=genai_types.GenerateContentConfig(
                        temperature=0.2,
                    ),
                ),
                timeout=15.0,
            )
            raw = response.text.strip()

            # Strip markdown fences if present
            if raw.startswith("```"):
                raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
                if raw.endswith("```"):
                    raw = raw[:-3]
                raw = raw.strip()

            parsed: list[dict[str, Any]] = _json.loads(raw)

            if not isinstance(parsed, list) or len(parsed) == 0:
                raise ValueError(f"Expected non-empty JSON array, got: {type(parsed)}")

            # Validate and normalise assignments
            assignments = self._validate_assignments(parsed, beat_count)
            return assignments

        except Exception as exc:
            logger.warning(
                "[VisualInterleave] Gemini call failed for segment %s, "
                "using fallback pattern: %s",
                segment_id,
                exc,
            )
            return _fallback_assignments(beat_count)

    @staticmethod
    def _validate_assignments(
        parsed: list[dict[str, Any]],
        beat_count: int,
    ) -> list[dict[str, Any]]:
        """Validate Gemini output and ensure type constraints are met."""

        valid_types = {"illustration", "cinematic", "video"}
        assignments: list[dict[str, Any]] = []

        for item in parsed:
            vtype = item.get("visual_type", "illustration")
            if vtype not in valid_types:
                vtype = "illustration"

            gen_prompt = item.get("generation_prompt")
            if vtype == "illustration":
                gen_prompt = None

            assignments.append({
                "beat_index": item.get("beat_index", len(assignments)),
                "visual_type": vtype,
                "generation_prompt": gen_prompt,
            })

        # Ensure we have assignments for all beats
        existing_indices = {a["beat_index"] for a in assignments}
        for i in range(beat_count):
            if i not in existing_indices:
                fallback_type = _FALLBACK_PATTERN[i % len(_FALLBACK_PATTERN)]
                assignments.append({
                    "beat_index": i,
                    "visual_type": fallback_type,
                    "generation_prompt": None,
                })

        # Sort by beat_index
        assignments.sort(key=lambda a: a["beat_index"])

        # Enforce diversity constraint: at least 1 of each type when 3+ beats
        if beat_count >= 3:
            present_types = {a["visual_type"] for a in assignments[:beat_count]}
            missing = valid_types - present_types
            if missing:
                # Reassign the most duplicated type to cover missing ones
                from collections import Counter

                type_counts = Counter(
                    a["visual_type"] for a in assignments[:beat_count]
                )
                for needed_type in missing:
                    # Find the most common type with count > 1
                    most_common = type_counts.most_common()
                    for common_type, count in most_common:
                        if count > 1:
                            # Find the last beat of this type and reassign
                            for a in reversed(assignments[:beat_count]):
                                if a["visual_type"] == common_type:
                                    a["visual_type"] = needed_type
                                    if needed_type == "illustration":
                                        a["generation_prompt"] = None
                                    type_counts[common_type] -= 1
                                    type_counts[needed_type] += 1
                                    break
                            break

        return assignments[:beat_count]


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------


def build_visual_interleave_agent(
    emitter: SSEEmitter | None = None,
) -> VisualInterleaveAgent:
    """Create a configured VisualInterleaveAgent.

    Reads GCP_PROJECT_ID from environment variables.
    """
    return VisualInterleaveAgent(
        name="visual_interleave_agent",
        description=(
            "Phase 3.3: Assigns each narration beat a visual generation type "
            "(illustration, cinematic, or video) using Gemini 2.0 Flash. "
            "The resulting beat_visual_plan tells Phase V which path to use."
        ),
        emitter=emitter,
        gcp_project=os.environ.get("GCP_PROJECT_ID", ""),
    )
