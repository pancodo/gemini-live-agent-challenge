"""Phase 3.2 — Beat Illustration Agent: Interleaved TEXT+IMAGE for Player Beats.

Pre-generates narration beats with Gemini's native interleaved output
(response_modalities=["TEXT", "IMAGE"]) during the pipeline, so that
the documentary player has beat images ready BEFORE it opens.

This makes Gemini's native interleaved output the PRIMARY visual path
for the documentary player, satisfying the Creative Storyteller
mandatory requirement.

Session state contract
----------------------
Inputs (must be present before Phase 3.2 runs):
    session.state["script"]        -- list[dict] SegmentScript dicts (Phase III)
    session.state["visual_bible"]  -- Imagen 3 style guide string (Phase I)

Outputs (written by this agent):
    session.state["beats"]         -- dict[segment_id, list[dict]] per-segment beats
"""

from __future__ import annotations

import asyncio
import json as _json
import logging
import os
import time
import uuid
from collections.abc import AsyncGenerator
from datetime import timedelta
from typing import Any

from google import genai as google_genai
from google.adk.agents.base_agent import BaseAgent
from google.adk.agents.invocation_context import InvocationContext
from google.cloud import storage
from google.genai import types as genai_types
from pydantic import ConfigDict, Field

from .sse_helpers import (
    SSEEmitter,
    build_narration_beat_event,
    build_pipeline_phase_event,
    build_segment_update_event,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Composition hints cycle (matches narrate.py)
# ---------------------------------------------------------------------------

_COMPOSITION_HINTS = [
    "Wide establishing shot",
    "Medium shot, eye level",
    "Close-up detail",
    "Dramatic low angle",
]

# ---------------------------------------------------------------------------
# Beat decomposition prompt
# ---------------------------------------------------------------------------

_DECOMPOSE_PROMPT = """You are a documentary visual director.

Split this narration into {beat_count} dramatic beats. Each beat is a distinct visual moment in the story's timeline.

For each beat, write a SPECIFIC visual_moment that describes exactly what the camera should show — not a summary of the text, but what we physically SEE on screen. Focus on the most vivid, cinematic image from that narration.

EXAMPLES of good visual_moments:
- "Vesuvius crater trembling, thin column of white smoke rising against blue sky"
- "Roman priest's hands shaking as he pours wine over a cracked stone altar"
- "Aerial view of Pompeii streets, tiny figures running between columns as ash falls"
- "Close-up of a mosaic floor cracking under seismic pressure, dust rising between tiles"

BAD visual_moments (too generic — never write these):
- "Illustrate: In 80 AD, the emperor..."
- "A scene from ancient Rome"
- "Historical event taking place"

SCRIPT:
{script}

Return ONLY a JSON array (no markdown fences):
[
  {{
    "beat_index": 0,
    "narration_text": "<exact narration text for this beat>",
    "visual_moment": "<SPECIFIC visual description — what does the camera show?>"
  }}
]
"""

# ---------------------------------------------------------------------------
# Beat illustration prompt
# ---------------------------------------------------------------------------

_BEAT_PROMPT = """You are the creative director of a cinematic historical documentary.

VISUAL BIBLE: {visual_bible}
{style_block}

SCENE: {title} | MOOD: {mood}
BEAT {beat_index} of {total_beats}

NARRATION the viewer hears during this image:
"{narration_text}"

WHAT THE CAMERA SHOWS:
{visual_moment}

Generate ONE cinematic 16:9 illustration that DIRECTLY depicts what the narration describes.
The viewer must look at this image and immediately understand what the narrator is talking about.
The image IS the narration made visible.

Rules:
- Depict the specific action, object, or scene described in the narration
- Match the Visual Bible style exactly
- Historically accurate, NO anachronisms
- {composition_hint}

First write a 1-sentence direction note, then generate the illustration."""


# ---------------------------------------------------------------------------
# BeatIllustrationAgent
# ---------------------------------------------------------------------------


class BeatIllustrationAgent(BaseAgent):
    """Phase 3.2: pre-generates beat-by-beat interleaved TEXT+IMAGE for the player.

    For each segment, decomposes the narration script into 3-4 dramatic beats,
    then generates a Gemini TEXT+IMAGE illustration per beat. Beat 0 of Scene 0
    is generated first (fast path). Remaining beats run concurrently.

    Emits ``narration_beat`` SSE events so the frontend receives beats during
    pipeline execution, before the player opens.
    """

    model_config = ConfigDict(arbitrary_types_allowed=True)

    emitter: Any = Field(default=None)
    gcs_bucket: str = Field(default="")
    gcp_project: str = Field(default="")

    async def _run_async_impl(
        self,
        ctx: InvocationContext,
    ) -> AsyncGenerator[Any, None]:
        """Execute Phase 3.2: beat illustration for all segments."""

        session_id: str = ctx.session.id
        t_start = time.monotonic()

        # ── Emit pipeline phase marker ─────────────────────────────────
        if self.emitter:
            await self.emitter.emit(
                "pipeline_phase",
                build_pipeline_phase_event(
                    phase=3.2,
                    label="INTERLEAVED COMPOSITION",
                    message=(
                        "Gemini composes narration beats with cinematic "
                        "illustrations — text and imagery in a single call."
                    ),
                ),
            )

        # ── Read session state ─────────────────────────────────────────
        script_raw: list[dict[str, Any]] = ctx.session.state.get("script", [])
        visual_bible: str = ctx.session.state.get("visual_bible", "")

        if not script_raw:
            logger.warning(
                "[BeatIllustration] No script found for session %s — skipping.",
                session_id,
            )
            return
            yield  # AsyncGenerator protocol

        # ── Initialise clients ─────────────────────────────────────────
        client = google_genai.Client(
            vertexai=True,
            project=self.gcp_project,
            location="global",  # gemini-2.5-flash-image requires global
        )
        gcs_client = storage.Client(project=self.gcp_project)
        bucket = gcs_client.bucket(self.gcs_bucket)

        # ── Process all segments ───────────────────────────────────────
        all_beats: dict[str, list[dict[str, Any]]] = {}

        # Scene 0 first (fast path)
        if script_raw:
            seg_beats = await self._process_segment(
                client=client,
                bucket=bucket,
                session_id=session_id,
                seg_dict=script_raw[0],
                seg_index=0,
                visual_bible=visual_bible,
            )
            seg_id = script_raw[0].get("id", "segment_0")
            all_beats[seg_id] = seg_beats

        # Remaining scenes concurrently
        if len(script_raw) > 1:
            sem = asyncio.Semaphore(2)

            async def bounded(seg_dict: dict, idx: int) -> tuple[str, list]:
                async with sem:
                    beats = await self._process_segment(
                        client=client,
                        bucket=bucket,
                        session_id=session_id,
                        seg_dict=seg_dict,
                        seg_index=idx,
                        visual_bible=visual_bible,
                    )
                    return seg_dict.get("id", f"segment_{idx}"), beats

            results = await asyncio.gather(
                *[
                    bounded(seg_dict, i)
                    for i, seg_dict in enumerate(script_raw[1:], start=1)
                ],
                return_exceptions=True,
            )

            for result in results:
                if isinstance(result, Exception):
                    logger.error("Beat generation failed: %s", result)
                else:
                    seg_id, beats = result
                    all_beats[seg_id] = beats

        # ── Store in session state ─────────────────────────────────────
        ctx.session.state["beats"] = all_beats

        t_total = round(time.monotonic() - t_start, 1)
        logger.info(
            "[BeatIllustration] Phase 3.2 complete for session %s in %.1fs "
            "(%d segments, %d total beats)",
            session_id,
            t_total,
            len(all_beats),
            sum(len(b) for b in all_beats.values()),
        )

        return
        yield  # AsyncGenerator protocol

    async def _process_segment(
        self,
        *,
        client: google_genai.Client,
        bucket: Any,
        session_id: str,
        seg_dict: dict[str, Any],
        seg_index: int,
        visual_bible: str,
    ) -> list[dict[str, Any]]:
        """Decompose one segment into beats and generate illustrations."""

        segment_id = seg_dict.get("id", f"segment_{seg_index}")
        title = seg_dict.get("title", "Untitled")
        mood = seg_dict.get("mood", "cinematic")
        script = seg_dict.get("narration_script", "")

        if not script or len(script) < 30:
            logger.warning(
                "[BeatIllustration] Segment %s has insufficient script, skipping.",
                segment_id,
            )
            return []

        # ── Decompose into beats ───────────────────────────────────────
        beat_count = 4 if len(script) > 300 else 3
        raw_beats = await self._decompose_beats(client, script, beat_count)
        total_beats = len(raw_beats)

        if total_beats == 0:
            return []

        # ── Build style block ──────────────────────────────────────────
        style_block = ""
        try:
            from .prompt_style_helpers import build_style_block

            style_block = build_style_block(
                visual_bible=visual_bible,
                era=seg_dict.get("era", ""),
                mood=mood,
                title=title,
                narrative_role=seg_dict.get("narrative_role", ""),
            ) or ""
        except ImportError:
            pass

        # ── Generate beat 0 first (fast path) ─────────────────────────
        beat_results: list[dict[str, Any]] = []

        first_beat = raw_beats[0]
        result = await self._generate_beat(
            client=client,
            bucket=bucket,
            session_id=session_id,
            segment_id=segment_id,
            beat_index=first_beat.get("beat_index", 0),
            total_beats=total_beats,
            narration_text=first_beat.get("narration_text", ""),
            visual_moment=first_beat.get("visual_moment", ""),
            title=title,
            mood=mood,
            visual_bible=visual_bible,
            style_block=style_block,
        )
        beat_results.append(result)

        # ── Generate remaining beats concurrently ─────────────────────
        if len(raw_beats) > 1:
            tasks = [
                self._generate_beat(
                    client=client,
                    bucket=bucket,
                    session_id=session_id,
                    segment_id=segment_id,
                    beat_index=beat.get("beat_index", i),
                    total_beats=total_beats,
                    narration_text=beat.get("narration_text", ""),
                    visual_moment=beat.get("visual_moment", ""),
                    title=title,
                    mood=mood,
                    visual_bible=visual_bible,
                    style_block=style_block,
                )
                for i, beat in enumerate(raw_beats[1:], start=1)
            ]
            remaining = await asyncio.gather(*tasks, return_exceptions=True)
            for r in remaining:
                if isinstance(r, Exception):
                    logger.error("Beat generation error: %s", r)
                else:
                    beat_results.append(r)

        # Sort by beat_index to ensure order
        beat_results.sort(key=lambda b: b.get("beat_index", 0))

        # ── Emit segment_update with beats_ready status ────────────────
        if self.emitter:
            await self.emitter.emit(
                "segment_update",
                build_segment_update_event(
                    segment_id=segment_id,
                    scene_id=seg_dict.get("scene_id", f"scene_{seg_index}"),
                    status="beats_ready",
                    title=title,
                    mood=mood,
                ),
            )

        return beat_results

    async def _decompose_beats(
        self,
        client: google_genai.Client,
        script: str,
        beat_count: int = 4,
    ) -> list[dict[str, Any]]:
        """Use Gemini 2.0 Flash to split a script into dramatic beats."""
        prompt = _DECOMPOSE_PROMPT.format(beat_count=beat_count, script=script)

        try:
            response = await asyncio.wait_for(
                client.aio.models.generate_content(
                    model="gemini-2.0-flash",
                    contents=[prompt],
                    config=genai_types.GenerateContentConfig(
                        temperature=0.3,
                    ),
                ),
                timeout=10.0,
            )
            raw = response.text.strip()
            # Strip markdown fences if present
            if raw.startswith("```"):
                raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
                if raw.endswith("```"):
                    raw = raw[:-3]
                raw = raw.strip()
            beats: list[dict[str, Any]] = _json.loads(raw)
            if isinstance(beats, list) and len(beats) >= 2:
                return beats
        except Exception as exc:
            logger.warning(
                "[BeatIllustration] Beat decomposition failed, using fallback: %s",
                exc,
            )

        # Fallback: split sentences evenly
        sentences = [
            s.strip() for s in script.replace("\n", " ").split(".") if s.strip()
        ]
        if not sentences:
            sentences = [script]
        chunk_size = max(1, len(sentences) // beat_count)
        beats = []
        for i in range(beat_count):
            start = i * chunk_size
            end = start + chunk_size if i < beat_count - 1 else len(sentences)
            text = ". ".join(sentences[start:end])
            if text and not text.endswith("."):
                text += "."
            # Pick the longest sentence as the visual moment (most descriptive)
            beat_sentences = [s.strip() for s in text.split(".") if s.strip()]
            visual_sentence = max(beat_sentences, key=len) if beat_sentences else text[:120]
            beats.append({
                "beat_index": i,
                "narration_text": text,
                "visual_moment": visual_sentence,
            })
        return [b for b in beats if b["narration_text"].strip()]

    async def _generate_beat(
        self,
        *,
        client: google_genai.Client,
        bucket: Any,
        session_id: str,
        segment_id: str,
        beat_index: int,
        total_beats: int,
        narration_text: str,
        visual_moment: str,
        title: str,
        mood: str,
        visual_bible: str,
        style_block: str,
    ) -> dict[str, Any]:
        """Generate interleaved TEXT+IMAGE for a single beat."""
        composition_hint = _COMPOSITION_HINTS[beat_index % len(_COMPOSITION_HINTS)]

        prompt = _BEAT_PROMPT.format(
            visual_bible=visual_bible[:2000] if visual_bible else "(no visual bible)",
            style_block=style_block,
            title=title or "(untitled scene)",
            mood=mood or "cinematic",
            beat_index=beat_index,
            total_beats=total_beats,
            narration_text=narration_text,
            visual_moment=visual_moment,
            composition_hint=composition_hint,
        )

        direction_text = ""
        image_bytes: bytes | None = None
        mime_type = "image/jpeg"

        try:
            response = await asyncio.wait_for(
                client.aio.models.generate_content(
                    model="gemini-2.5-flash-image",
                    contents=[prompt],
                    config=genai_types.GenerateContentConfig(
                        response_modalities=["TEXT", "IMAGE"],
                        temperature=0.7,
                    ),
                ),
                timeout=25.0,
            )

            if response.candidates:
                for part in response.candidates[0].content.parts:
                    if hasattr(part, "text") and part.text:
                        direction_text += part.text
                    elif hasattr(part, "inline_data") and part.inline_data:
                        image_bytes = part.inline_data.data
                        mime_type = part.inline_data.mime_type or "image/jpeg"

        except asyncio.TimeoutError:
            logger.error(
                "[BeatIllustration] Beat %d timed out for %s/%s",
                beat_index, session_id, segment_id,
            )
        except Exception as exc:
            logger.error(
                "[BeatIllustration] Beat %d failed for %s/%s: %s",
                beat_index, session_id, segment_id, exc,
                exc_info=True,
            )

        # Upload image to GCS if generated
        signed_url: str | None = None
        if image_bytes is not None:
            ext = "png" if "png" in mime_type else "jpg"
            gcs_path = f"sessions/{session_id}/beats/{segment_id}_{beat_index}_{uuid.uuid4().hex[:8]}.{ext}"
            try:
                loop = asyncio.get_running_loop()
                await loop.run_in_executor(
                    None,
                    lambda: bucket.blob(gcs_path).upload_from_string(
                        data=image_bytes, content_type=mime_type
                    ),
                )
                # Generate signed URL
                from .signing_helpers import get_signing_credentials
                blob = bucket.blob(gcs_path)
                url = await loop.run_in_executor(
                    None,
                    lambda: blob.generate_signed_url(
                        credentials=get_signing_credentials(),
                        expiration=timedelta(hours=4),
                        method="GET",
                        version="v4",
                    ),
                )
                signed_url = url
            except Exception as exc:
                logger.error(
                    "[BeatIllustration] GCS upload failed for beat %d: %s",
                    beat_index, exc, exc_info=True,
                )

        # ── Imagen 3 fallback: if interleaved generation produced no image ──
        if signed_url is None and visual_moment:
            try:
                imagen_prompt = (
                    f"{visual_moment}. "
                    f"Cinematic 16:9 historical illustration. {visual_bible or ''}"
                )[:1000]
                imagen_response = await client.aio.models.generate_images(
                    model="imagen-3.0-fast-generate-001",
                    prompt=imagen_prompt,
                    config=google_genai.types.GenerateImagesConfig(
                        number_of_images=1,
                        aspect_ratio="16:9",
                        safety_filter_level="BLOCK_ONLY_HIGH",
                    ),
                )
                if imagen_response.generated_images:
                    fb_bytes = imagen_response.generated_images[0].image.image_bytes
                    if fb_bytes:
                        fb_path = (
                            f"sessions/{session_id}/beats/"
                            f"{segment_id}_{beat_index}_fb_{uuid.uuid4().hex[:6]}.jpg"
                        )
                        loop = asyncio.get_running_loop()
                        await loop.run_in_executor(
                            None,
                            lambda: bucket.blob(fb_path).upload_from_string(
                                data=fb_bytes, content_type="image/jpeg"
                            ),
                        )
                        from .signing_helpers import get_signing_credentials

                        blob = bucket.blob(fb_path)
                        signed_url = await loop.run_in_executor(
                            None,
                            lambda: blob.generate_signed_url(
                                credentials=get_signing_credentials(),
                                expiration=timedelta(hours=4),
                                method="GET",
                                version="v4",
                            ),
                        )
                        logger.info(
                            "[BeatIllustration] Imagen 3 fallback succeeded for beat %d",
                            beat_index,
                        )
            except Exception as exc:
                logger.warning(
                    "[BeatIllustration] Imagen 3 fallback failed for beat %d: %s",
                    beat_index,
                    exc,
                )

        # Emit SSE event
        if self.emitter:
            event = build_narration_beat_event(
                segment_id=segment_id,
                beat_index=beat_index,
                total_beats=total_beats,
                narration_text=narration_text,
                image_url=signed_url,
                direction_text=direction_text,
            )
            await self.emitter.emit("narration_beat", event)

        return {
            "beat_index": beat_index,
            "narration_text": narration_text,
            "direction_text": direction_text,
            "image_url": signed_url,
        }


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------


def build_beat_illustration_agent(
    emitter: SSEEmitter | None = None,
) -> BeatIllustrationAgent:
    """Create a configured BeatIllustrationAgent.

    Reads GCP_PROJECT_ID and GCS_BUCKET_NAME from environment variables.
    """
    return BeatIllustrationAgent(
        name="beat_illustration_agent",
        description=(
            "Phase 3.2: Generates beat-by-beat narration illustrations using "
            "Gemini's native interleaved TEXT+IMAGE output. Each beat becomes "
            "one visual moment in the documentary player."
        ),
        emitter=emitter,
        gcp_project=os.environ.get("GCP_PROJECT_ID", ""),
        gcs_bucket=os.environ.get("GCS_BUCKET_NAME", ""),
    )
