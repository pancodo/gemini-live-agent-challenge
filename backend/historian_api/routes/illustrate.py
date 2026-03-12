"""Live Illustration Engine endpoint.

POST /api/session/{session_id}/illustrate
    Body:    IllustrateRequest  { query, current_segment_id, mood }
    Returns: IllustrateResponse { imageUrl, caption, generatedAt }

Generates a cinematic illustration on-demand using Gemini 2.5 Flash Image
with interleaved text+image output.  The prompt is grounded via RAG retrieval
against the session's document chunks and styled according to the Visual Bible.
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from google import genai
from google.cloud import firestore
from google.genai import types as genai_types

from ..models import IllustrateRequest, IllustrateResponse, RetrieveRequest
from .retrieve import retrieve_chunks
from .session import GCS_BUCKET, _gs_to_signed_url, get_db, get_gcs

router = APIRouter()
logger = logging.getLogger(__name__)

GCP_PROJECT_ID = os.environ.get("GCP_PROJECT_ID", "")

# ---------------------------------------------------------------------------
# In-memory rate limiter: max 1 call per 10 seconds per session
# ---------------------------------------------------------------------------

_rate_limits: dict[str, float] = {}
_RATE_LIMIT_SECONDS = 10.0

# ---------------------------------------------------------------------------
# Illustration prompt template
# ---------------------------------------------------------------------------

ILLUSTRATION_PROMPT = """You are the creative director of a cinematic historical documentary.
The viewer just asked: "{query}"

VISUAL BIBLE (style reference):
{visual_bible}

CURRENT SCENE:
Title: {segment_title}
Mood: {mood}
Narration: {narration_excerpt}

DOCUMENT CONTEXT:
{rag_context}

First, write a brief creative direction note (1-2 sentences) describing
what the viewer should see — composition, lighting, historical accuracy.

Then generate ONE cinematic illustration that directly answers the viewer's
question. The illustration must:
- Match the Visual Bible style exactly
- Be historically accurate to the era and region
- Use cinematic 16:9 composition
- Convey the mood: {mood}
- Contain NO modern elements or anachronisms

Generate the illustration now."""

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
# Route
# ---------------------------------------------------------------------------


@router.post(
    "/session/{session_id}/illustrate",
    response_model=IllustrateResponse,
)
async def illustrate(
    session_id: str,
    body: IllustrateRequest,
) -> IllustrateResponse:
    """Generate a cinematic illustration grounded in the session document."""

    # ── Rate limit ────────────────────────────────────────────────
    now = time.monotonic()
    last_call = _rate_limits.get(session_id, 0.0)
    if now - last_call < _RATE_LIMIT_SECONDS:
        remaining = _RATE_LIMIT_SECONDS - (now - last_call)
        raise HTTPException(
            status_code=429,
            detail=f"Rate limited. Try again in {remaining:.1f}s",
            headers={"Retry-After": str(int(remaining) + 1)},
        )
    _rate_limits[session_id] = now

    # ── Read session context from Firestore ───────────────────────
    db = get_db()
    visual_bible = ""
    segment_title = ""
    narration_excerpt = ""
    mood = body.mood

    try:
        session_doc = await db.collection("sessions").document(session_id).get()
        if not session_doc.exists:
            raise HTTPException(status_code=404, detail="Session not found")
        session_data = session_doc.to_dict() or {}
        visual_bible = session_data.get("visualBible", "") or ""
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("Failed to read session %s: %s", session_id, exc)

    if body.current_segment_id:
        try:
            seg_doc = (
                await db.collection("sessions")
                .document(session_id)
                .collection("segments")
                .document(body.current_segment_id)
                .get()
            )
            if seg_doc.exists:
                seg_data = seg_doc.to_dict() or {}
                segment_title = seg_data.get("title", "")
                mood = seg_data.get("mood", mood) or mood
                script = seg_data.get("script", "")
                narration_excerpt = script[:500] if script else ""
        except Exception as exc:
            logger.warning(
                "Failed to read segment %s/%s: %s",
                session_id,
                body.current_segment_id,
                exc,
            )

    # ── RAG retrieval ─────────────────────────────────────────────
    rag_context = ""
    try:
        rag_response = await retrieve_chunks(
            session_id, RetrieveRequest(query=body.query, top_k=3)
        )
        rag_context = "\n".join(c.text[:400] for c in rag_response.chunks)
    except Exception as exc:
        logger.warning("RAG retrieval failed for session %s: %s", session_id, exc)

    # ── Build prompt ──────────────────────────────────────────────
    prompt = ILLUSTRATION_PROMPT.format(
        query=body.query,
        visual_bible=visual_bible or "(no visual bible available)",
        segment_title=segment_title or "(no current segment)",
        mood=mood,
        narration_excerpt=narration_excerpt or "(no narration)",
        rag_context=rag_context or "(no document context retrieved)",
    )

    # ── Call Gemini with interleaved text+image output ────────────
    client = _get_genai_client()
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
            timeout=15.0,
        )

        if response.candidates:
            for part in response.candidates[0].content.parts:
                if hasattr(part, "text") and part.text:
                    direction_text += part.text
                elif hasattr(part, "inline_data") and part.inline_data:
                    image_bytes = part.inline_data.data
                    mime_type = part.inline_data.mime_type or "image/jpeg"

    except asyncio.TimeoutError:
        logger.error("Gemini illustration call timed out for session %s", session_id)
        raise HTTPException(
            status_code=503,
            detail="Illustration generation timed out",
            headers={"Retry-After": "10"},
        )
    except Exception as exc:
        logger.error(
            "Gemini illustration call failed for session %s: %s",
            session_id,
            exc,
            exc_info=True,
        )
        raise HTTPException(
            status_code=503,
            detail="Illustration generation failed",
            headers={"Retry-After": "10"},
        )

    generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"

    # ── If no image (safety filter), return text-only ─────────────
    if image_bytes is None:
        return IllustrateResponse(
            imageUrl=None,
            caption=direction_text or "Image generation was filtered.",
            generatedAt=generated_at,
        )

    # ── Upload to GCS ─────────────────────────────────────────────
    ext = "png" if "png" in mime_type else "jpg"
    gcs_path = f"sessions/{session_id}/illustrations/{uuid.uuid4().hex}.{ext}"

    try:
        loop = asyncio.get_event_loop()
        bucket = get_gcs().bucket(GCS_BUCKET)
        await loop.run_in_executor(
            None,
            lambda: bucket.blob(gcs_path).upload_from_string(
                data=image_bytes, content_type=mime_type
            ),
        )
    except Exception as exc:
        logger.error("GCS upload failed for illustration: %s", exc, exc_info=True)
        raise HTTPException(
            status_code=503,
            detail="Failed to upload illustration",
            headers={"Retry-After": "5"},
        )

    # ── Generate signed URL ───────────────────────────────────────
    gcs_uri = f"gs://{GCS_BUCKET}/{gcs_path}"
    signed_url = _gs_to_signed_url(gcs_uri)

    # ── Persist illustration to Firestore ──────────────────────
    if signed_url:
        try:
            illustration_id = str(uuid.uuid4())
            await db.collection("sessions").document(session_id).collection("illustrations").document(illustration_id).set({
                "query": body.query,
                "caption": direction_text,
                "imageUrl": signed_url,
                "gcsUri": gcs_uri,
                "segmentId": body.current_segment_id,
                "createdAt": firestore.SERVER_TIMESTAMP,
            })

            # Append imageUrl to the segment's imageUrls array
            if body.current_segment_id:
                await db.collection("sessions").document(session_id).collection("segments").document(body.current_segment_id).update({
                    "imageUrls": firestore.ArrayUnion([signed_url]),
                })
        except Exception as exc:
            logger.warning("Firestore write failed for illustration: %s", exc)

        # ── Emit SSE event for live illustration ───────────────
        try:
            from .pipeline import _event_logs
            from agent_orchestrator.agents.sse_helpers import build_live_illustration_event
            import json as _json

            log = _event_logs.get(session_id)
            if log:
                event = build_live_illustration_event(
                    segment_id=body.current_segment_id,
                    image_url=signed_url,
                    caption=direction_text,
                    query=body.query,
                )
                log.append(_json.dumps(event))
        except Exception as exc:
            logger.warning("SSE emission failed for illustration: %s", exc)

    return IllustrateResponse(
        imageUrl=signed_url,
        caption=direction_text,
        generatedAt=generated_at,
    )
