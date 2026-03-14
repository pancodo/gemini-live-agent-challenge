"""Standalone demo endpoint for Gemini interleaved TEXT+IMAGE output.

GET /api/demo/interleaved?prompt=...
    Returns SSE stream with parts as they arrive from a single Gemini call.
    Each SSE event is one of:
        {"type": "text",  "content": "..."}
        {"type": "image", "dataUrl": "data:image/png;base64,..."}
        {"type": "config", "model": "...", "responseModalities": [...]}
        {"type": "done",  "totalParts": N, "elapsedMs": N}

No session, no Firestore — pure Gemini interleaved output demonstration.
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import time

from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse
from google import genai
from google.genai import types as genai_types

router = APIRouter()
logger = logging.getLogger(__name__)

GCP_PROJECT_ID = os.environ.get("GCP_PROJECT_ID", "")
_MODEL = "gemini-2.5-flash-image"

_DEFAULT_PROMPT = (
    "You are the creative director of a cinematic historical documentary. "
    "Describe the signing of the Treaty of Westphalia in 1648, "
    "then generate a cinematic illustration of the moment — "
    "candlelit hall, exhausted diplomats, quill touching parchment. "
    "Write your creative direction note first, then produce the image."
)

# Lazy singleton
_client: genai.Client | None = None


def _get_client() -> genai.Client:
    global _client
    if _client is None:
        _client = genai.Client(
            vertexai=True,
            project=GCP_PROJECT_ID,
            location="global",
        )
    return _client


def _sse_event(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


@router.get("/demo/interleaved")
async def demo_interleaved(
    prompt: str = Query(default=_DEFAULT_PROMPT, max_length=2000),
):
    """Stream interleaved TEXT+IMAGE parts from a single Gemini call via SSE."""

    async def generate():
        t_start = time.monotonic()

        # Emit the config event first — shows judges the exact API setup
        yield _sse_event({
            "type": "config",
            "model": _MODEL,
            "responseModalities": ["TEXT", "IMAGE"],
            "prompt": prompt[:500],
        })

        client = _get_client()
        total_parts = 0

        try:
            response = await asyncio.wait_for(
                client.aio.models.generate_content(
                    model=_MODEL,
                    contents=[prompt],
                    config=genai_types.GenerateContentConfig(
                        response_modalities=["TEXT", "IMAGE"],
                        temperature=0.7,
                    ),
                ),
                timeout=30.0,
            )

            if response.candidates:
                for part in response.candidates[0].content.parts:
                    total_parts += 1

                    if hasattr(part, "text") and part.text:
                        yield _sse_event({
                            "type": "text",
                            "content": part.text,
                            "partIndex": total_parts - 1,
                        })

                    elif hasattr(part, "inline_data") and part.inline_data:
                        mime = part.inline_data.mime_type or "image/png"
                        b64 = base64.b64encode(part.inline_data.data).decode()
                        yield _sse_event({
                            "type": "image",
                            "dataUrl": f"data:{mime};base64,{b64}",
                            "mimeType": mime,
                            "partIndex": total_parts - 1,
                        })

        except asyncio.TimeoutError:
            yield _sse_event({
                "type": "error",
                "message": "Gemini call timed out after 30s",
            })
        except Exception as exc:
            logger.error("Demo interleaved call failed: %s", exc, exc_info=True)
            yield _sse_event({
                "type": "error",
                "message": str(exc)[:200],
            })

        elapsed_ms = round((time.monotonic() - t_start) * 1000)
        yield _sse_event({
            "type": "done",
            "totalParts": total_parts,
            "elapsedMs": elapsed_ms,
        })

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
