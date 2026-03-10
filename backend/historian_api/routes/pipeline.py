"""
Pipeline trigger and SSE stream routes for historian_api.
POST /api/session/{session_id}/process  -> kick off the ADK pipeline in background
GET  /api/session/{session_id}/stream   -> SSE stream of pipeline events
"""
from __future__ import annotations
import asyncio
import logging
import os
import sys
from datetime import timedelta
from pathlib import Path
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from google.cloud import firestore, storage
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types as genai_types
import google.auth

_backend_root = str(Path(__file__).parent.parent.parent)
if _backend_root not in sys.path:
    sys.path.insert(0, _backend_root)

from agent_orchestrator.agents.pipeline import build_new_pipeline
from agent_orchestrator.agents.sse_helpers import QueueSSEEmitter
from ..models import ProcessRequest

logger = logging.getLogger(__name__)
router = APIRouter()

_sse_queues: dict[str, asyncio.Queue] = {}

_db: firestore.AsyncClient | None = None
_gcs: storage.Client | None = None
GCS_BUCKET = os.environ.get("GCS_BUCKET_NAME", "historian-docs")

def get_db() -> firestore.AsyncClient:
    global _db
    if _db is None:
        _db = firestore.AsyncClient()
    return _db

def get_gcs() -> storage.Client:
    global _gcs
    if _gcs is None:
        credentials, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
        _gcs = storage.Client(credentials=credentials)
    return _gcs

def _make_document_url(session_id: str) -> str:
    """Generate a 24-hour signed GET URL for the uploaded PDF."""
    credentials, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
    blob = get_gcs().bucket(GCS_BUCKET).blob(f"{session_id}/document.pdf")
    return blob.generate_signed_url(
        credentials=credentials,
        version="v4",
        expiration=timedelta(hours=24),
        method="GET",
    )

@router.post("/session/{session_id}/process", status_code=202)
async def process_session(session_id: str, body: ProcessRequest) -> dict:
    if session_id in _sse_queues:
        raise HTTPException(status_code=409, detail="Pipeline already running for this session")
    queue: asyncio.Queue[str | None] = asyncio.Queue()
    _sse_queues[session_id] = queue

    # Generate a signed GET URL so the PDF viewer can load the document
    try:
        document_url = _make_document_url(session_id)
    except Exception as exc:
        logger.exception("Failed to generate document URL for %s", session_id)
        document_url = None

    try:
        db = get_db()
        update: dict = {"status": "processing"}
        if document_url:
            update["documentUrl"] = document_url
        await db.collection("sessions").document(session_id).update(update)
    except Exception as exc:
        logger.exception("Failed to update session status for %s", session_id)
        del _sse_queues[session_id]
        raise HTTPException(status_code=500, detail="Could not update session") from exc
    asyncio.create_task(_run_pipeline(session_id, body.gcsPath, queue))
    return {"sessionId": session_id, "status": "processing"}

async def _run_pipeline(session_id: str, gcs_path: str, queue: asyncio.Queue) -> None:
    emitter = QueueSSEEmitter(queue=queue)
    db = get_db()
    try:
        session_service = InMemorySessionService()
        pipeline = build_new_pipeline(emitter=emitter)
        runner = Runner(agent=pipeline, app_name="historian", session_service=session_service)
        await session_service.create_session(
            app_name="historian",
            user_id="user",
            session_id=session_id,
            state={"gcs_path": gcs_path, "session_id": session_id},
        )
        user_message = genai_types.Content(
            role="user",
            parts=[genai_types.Part(text=f"Process historical document at {gcs_path}")],
        )
        async for _event in runner.run_async(user_id="user", session_id=session_id, new_message=user_message):
            pass
        await db.collection("sessions").document(session_id).update({"status": "ready"})
    except Exception:
        logger.exception("Pipeline failed for session %s", session_id)
        await queue.put('data: {"type":"error","message":"Pipeline failed"}\n\n')
        try:
            await db.collection("sessions").document(session_id).update({"status": "error"})
        except Exception:
            pass
    finally:
        # Signal end-of-stream. Do NOT pop the queue here — the queue must
        # remain alive so that clients which connect after the pipeline
        # finishes can still drain all buffered events. The SSE endpoint
        # removes the queue once the client reads the None sentinel.
        await queue.put(None)

@router.get("/session/{session_id}/stream")
async def stream_session(session_id: str) -> StreamingResponse:
    if session_id not in _sse_queues:
        queue: asyncio.Queue[str | None] = asyncio.Queue()
        _sse_queues[session_id] = queue
    else:
        queue = _sse_queues[session_id]
    async def event_generator():
        yield ": keep-alive\n\n"
        while True:
            try:
                message = await asyncio.wait_for(queue.get(), timeout=25.0)
            except asyncio.TimeoutError:
                yield ": keep-alive\n\n"
                continue
            if message is None:
                # Pipeline finished — clean up queue and close stream
                _sse_queues.pop(session_id, None)
                break
            yield message
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
