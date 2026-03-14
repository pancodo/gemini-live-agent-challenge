"""Interleaved Narration Engine endpoint.

POST /api/session/{session_id}/segment/{segment_id}/narrate
    Returns: NarrateResponse { beatsGenerated, segmentId }

Decomposes a segment script into 3-4 dramatic beats, then generates
narration direction + cinematic illustrations for each beat using Gemini's
interleaved TEXT+IMAGE output.  Beat 0 is emitted immediately (fast path);
beats 1-N are generated concurrently.
"""
from __future__ import annotations

import asyncio
import json as _json
import logging
import os
import time
import uuid
from typing import Any

from fastapi import APIRouter, HTTPException
from google import genai
from google.genai import types as genai_types

from ..models import NarrateResponse
from .session import GCS_BUCKET, _gs_to_signed_url, get_db, get_gcs

router = APIRouter()
logger = logging.getLogger(__name__)

GCP_PROJECT_ID = os.environ.get("GCP_PROJECT_ID", "")

# ---------------------------------------------------------------------------
# In-memory rate limiter: max 1 call per 5 seconds per session+segment key
# ---------------------------------------------------------------------------

_rate_limits: dict[str, float] = {}
_RATE_LIMIT_SECONDS = 5.0

# ---------------------------------------------------------------------------
# Composition hints cycle
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

_DECOMPOSE_PROMPT = """You are a documentary script editor.

Split this narration script into {beat_count} dramatic beats.
Each beat is a distinct emotional or narrative moment.

SCRIPT:
{script}

Return ONLY a JSON array (no markdown fences) where each element is:
{{
  "beat_index": <int>,
  "narration_text": "<the narration text for this beat>",
  "visual_moment": "<brief description of what the viewer should see>"
}}
"""

# ---------------------------------------------------------------------------
# Beat illustration prompt
# ---------------------------------------------------------------------------

_BEAT_PROMPT = """You are the creative director of a cinematic historical documentary.

VISUAL BIBLE: {visual_bible}
{style_block}

SCENE: {title} | MOOD: {mood}
BEAT {beat_index} of {total_beats}

NARRATION for this moment:
{narration_text}

VISUAL DIRECTION:
{visual_moment}

First, write a brief creative direction note (1-2 sentences).
Then generate ONE cinematic 16:9 illustration for this moment.
- Match the Visual Bible style
- Historically accurate, NO anachronisms
- {composition_hint}

Generate now."""

# ---------------------------------------------------------------------------
# Lazy Gemini client singleton (location="global" for image generation)
# ---------------------------------------------------------------------------

_genai_client: genai.Client | None = None


def _get_genai_client() -> genai.Client:
    global _genai_client
    if _genai_client is None:
        _genai_client = genai.Client(
            vertexai=True,
            project=GCP_PROJECT_ID,
            location="global",
        )
    return _genai_client


# ---------------------------------------------------------------------------
# Beat decomposition
# ---------------------------------------------------------------------------


async def _decompose_beats(
    client: genai.Client,
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
        logger.warning("Beat decomposition failed, using fallback: %s", exc)

    # Fallback: split sentences evenly
    sentences = [s.strip() for s in script.replace("\n", " ").split(".") if s.strip()]
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
        beats.append({
            "beat_index": i,
            "narration_text": text,
            "visual_moment": f"Illustrate: {text[:120]}",
        })
    return [b for b in beats if b["narration_text"].strip()]


# ---------------------------------------------------------------------------
# Single beat generation
# ---------------------------------------------------------------------------


async def _generate_beat(
    client: genai.Client,
    *,
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
    """Generate interleaved text+image for a single beat."""
    composition_hint = _COMPOSITION_HINTS[beat_index % len(_COMPOSITION_HINTS)]

    prompt = _BEAT_PROMPT.format(
        visual_bible=visual_bible or "(no visual bible available)",
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
            timeout=20.0,
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
            "Beat %d generation timed out for %s/%s",
            beat_index, session_id, segment_id,
        )
    except Exception as exc:
        logger.error(
            "Beat %d generation failed for %s/%s: %s",
            beat_index, session_id, segment_id, exc,
            exc_info=True,
        )

    # Upload image to GCS if generated
    signed_url: str | None = None
    if image_bytes is not None:
        ext = "png" if "png" in mime_type else "jpg"
        gcs_path = f"sessions/{session_id}/beats/{uuid.uuid4().hex}.{ext}"
        try:
            loop = asyncio.get_event_loop()
            bucket = get_gcs().bucket(GCS_BUCKET)
            await loop.run_in_executor(
                None,
                lambda: bucket.blob(gcs_path).upload_from_string(
                    data=image_bytes, content_type=mime_type
                ),
            )
            gcs_uri = f"gs://{GCS_BUCKET}/{gcs_path}"
            signed_url = _gs_to_signed_url(gcs_uri)
        except Exception as exc:
            logger.error("GCS upload failed for beat %d: %s", beat_index, exc, exc_info=True)

    # Emit SSE event
    try:
        from .pipeline import _event_logs
        from agent_orchestrator.agents.sse_helpers import build_narration_beat_event

        log = _event_logs.get(session_id)
        if log:
            event = build_narration_beat_event(
                segment_id=segment_id,
                beat_index=beat_index,
                total_beats=total_beats,
                narration_text=narration_text,
                image_url=signed_url,
                direction_text=direction_text,
            )
            log.append(_json.dumps(event))
    except Exception as exc:
        logger.warning("SSE emission failed for beat %d: %s", beat_index, exc)

    return {
        "beat_index": beat_index,
        "narration_text": narration_text,
        "direction_text": direction_text,
        "image_url": signed_url,
    }


# ---------------------------------------------------------------------------
# Route
# ---------------------------------------------------------------------------


@router.post(
    "/session/{session_id}/segment/{segment_id}/narrate",
    response_model=NarrateResponse,
)
async def narrate_segment(
    session_id: str,
    segment_id: str,
) -> NarrateResponse:
    """Generate beat-by-beat narration with interleaved text+image output."""

    # -- Rate limit --------------------------------------------------------
    rate_key = f"{session_id}:{segment_id}"
    now = time.monotonic()
    last_call = _rate_limits.get(rate_key, 0.0)
    if now - last_call < _RATE_LIMIT_SECONDS:
        remaining = _RATE_LIMIT_SECONDS - (now - last_call)
        raise HTTPException(
            status_code=429,
            detail=f"Rate limited. Try again in {remaining:.1f}s",
            headers={"Retry-After": str(int(remaining) + 1)},
        )
    _rate_limits[rate_key] = now

    # -- Read segment + session from Firestore -----------------------------
    db = get_db()

    try:
        session_doc = await db.collection("sessions").document(session_id).get()
        if not session_doc.exists:
            raise HTTPException(status_code=404, detail="Session not found")
        session_data = session_doc.to_dict() or {}
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("Failed to read session %s: %s", session_id, exc)
        raise HTTPException(status_code=500, detail="Failed to read session")

    visual_bible: str = session_data.get("visualBible", "") or ""

    try:
        seg_doc = (
            await db.collection("sessions")
            .document(session_id)
            .collection("segments")
            .document(segment_id)
            .get()
        )
        if not seg_doc.exists:
            raise HTTPException(status_code=404, detail="Segment not found")
        seg_data: dict[str, Any] = seg_doc.to_dict() or {}
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("Failed to read segment %s/%s: %s", session_id, segment_id, exc)
        raise HTTPException(status_code=500, detail="Failed to read segment")

    script: str = seg_data.get("script", "") or ""
    title: str = seg_data.get("title", "") or ""
    mood: str = seg_data.get("mood", "") or "cinematic"

    if not script:
        raise HTTPException(status_code=400, detail="Segment has no script to narrate")

    # -- Build style block -------------------------------------------------
    style_block = ""
    try:
        from agent_orchestrator.agents.prompt_style_helpers import build_style_block

        style_block = build_style_block(
            visual_bible=visual_bible,
            era=seg_data.get("era", ""),
            mood=mood,
            title=title,
            narrative_role=seg_data.get("narrativeRole", ""),
        ) or ""
    except ImportError:
        pass  # Style helpers not available

    # -- Decompose script into beats ---------------------------------------
    client = _get_genai_client()

    beat_count = 4 if len(script) > 300 else 3
    beats = await _decompose_beats(client, script, beat_count=beat_count)
    total_beats = len(beats)

    # -- Generate beat 0 first (fast path) ---------------------------------
    beat_kwargs = {
        "client": client,
        "session_id": session_id,
        "segment_id": segment_id,
        "total_beats": total_beats,
        "title": title,
        "mood": mood,
        "visual_bible": visual_bible,
        "style_block": style_block,
    }

    first_beat = beats[0]
    await _generate_beat(
        beat_index=first_beat.get("beat_index", 0),
        narration_text=first_beat.get("narration_text", ""),
        visual_moment=first_beat.get("visual_moment", ""),
        **beat_kwargs,
    )

    # -- Generate remaining beats concurrently -----------------------------
    if len(beats) > 1:
        tasks = [
            _generate_beat(
                beat_index=beat.get("beat_index", i),
                narration_text=beat.get("narration_text", ""),
                visual_moment=beat.get("visual_moment", ""),
                **beat_kwargs,
            )
            for i, beat in enumerate(beats[1:], start=1)
        ]
        await asyncio.gather(*tasks, return_exceptions=True)

    return NarrateResponse(
        beatsGenerated=total_beats,
        segmentId=segment_id,
    )
