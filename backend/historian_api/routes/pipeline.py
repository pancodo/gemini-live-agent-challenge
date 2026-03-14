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
from dataclasses import dataclass, field
from datetime import timedelta
from pathlib import Path
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from google.cloud import firestore, storage
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types as genai_types
import google.auth

_backend_root = str(Path(__file__).parent.parent.parent)
if _backend_root not in sys.path:
    sys.path.insert(0, _backend_root)

from agent_orchestrator.agents.pipeline import build_new_pipeline, build_streaming_pipeline
from agent_orchestrator.agents.sse_helpers import LogSSEEmitter
from ..models import ProcessRequest

logger = logging.getLogger(__name__)
router = APIRouter()

# ---------------------------------------------------------------------------
# SessionEventLog — append-only event log with async notification for SSE
# ---------------------------------------------------------------------------

@dataclass
class SessionEventLog:
    """Append-only event log that supports replay for SSE reconnection.

    Each appended message gets a monotonically increasing event ID (its index).
    Reconnecting clients send ``Last-Event-ID`` and replay from that cursor.
    """

    events: list[str] = field(default_factory=list)
    finished: bool = False
    _notify: asyncio.Event = field(default_factory=asyncio.Event)

    def append(self, message: str) -> int:
        """Append a serialised JSON payload and return its event ID."""
        event_id = len(self.events)
        self.events.append(message)
        # Wake all waiters, then replace the Event so future waiters block
        self._notify.set()
        self._notify = asyncio.Event()
        return event_id

    def finish(self) -> None:
        """Mark the log as complete — no more events will be appended."""
        self.finished = True
        self._notify.set()

    async def wait_for_new(self) -> None:
        """Block until a new event is appended or the log is finished."""
        await self._notify.wait()


_event_logs: dict[str, SessionEventLog] = {}

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
    # Allow re-trigger if the previous run ended in error (supports retry).
    # Only block if a pipeline is actively running.  When session status is
    # "error" from a previous failed run, the old log is stale -- remove it
    # so we can start fresh.
    if session_id in _event_logs:
        try:
            db_check = get_db()
            snap = await db_check.collection("sessions").document(session_id).get()
            session_data = snap.to_dict() or {} if snap.exists else {}
            if session_data.get("status") == "error":
                _event_logs.pop(session_id, None)
            else:
                raise HTTPException(
                    status_code=409,
                    detail="Pipeline already running for this session",
                )
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(
                status_code=409,
                detail="Pipeline already running for this session",
            )
    log = SessionEventLog()
    _event_logs[session_id] = log

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
        del _event_logs[session_id]
        raise HTTPException(status_code=500, detail="Could not update session") from exc
    asyncio.create_task(_run_pipeline(session_id, body.gcsPath, body.mode, log))
    return {"sessionId": session_id, "status": "processing"}

async def _run_pipeline(session_id: str, gcs_path: str, mode: str, log: SessionEventLog) -> None:
    emitter = LogSSEEmitter(log=log)
    db = get_db()
    try:
        session_service = InMemorySessionService()
        pipeline_mode = os.environ.get("PIPELINE_MODE", "streaming")
        if pipeline_mode == "streaming":
            pipeline = build_streaming_pipeline(emitter=emitter)
        else:
            pipeline = build_new_pipeline(emitter=emitter)
        runner = Runner(agent=pipeline, app_name="historian", session_service=session_service)
        await session_service.create_session(
            app_name="historian",
            user_id="user",
            session_id=session_id,
            state={"gcs_path": gcs_path, "session_id": session_id, "research_mode": mode},
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
        log.append('{"type":"error","message":"Pipeline failed"}')
        try:
            await db.collection("sessions").document(session_id).update({"status": "error"})
        except Exception:
            pass
    finally:
        log.finish()
        asyncio.create_task(_cleanup_log(session_id, delay=300))


async def _cleanup_log(session_id: str, delay: int = 300) -> None:
    """Remove a finished session event log after a grace period.

    The 5-minute (300s) delay allows reconnecting clients to replay events
    even after the pipeline has completed.
    """
    await asyncio.sleep(delay)
    _event_logs.pop(session_id, None)


@router.get("/session/{session_id}/stream")
async def stream_session(session_id: str, request: Request) -> StreamingResponse:
    # Read Last-Event-ID header for reconnection replay
    last_event_id_header = request.headers.get("Last-Event-ID")
    cursor = int(last_event_id_header) + 1 if last_event_id_header else 0

    async def event_generator():
        nonlocal cursor
        # Initial keepalive so the connection is established immediately
        yield ": keep-alive\n\n"

        log = _event_logs.get(session_id)
        if log is None:
            return

        while True:
            # Replay any events from the cursor onward
            events_snapshot = log.events[cursor:]
            for payload in events_snapshot:
                yield f"id: {cursor}\ndata: {payload}\n\n"
                cursor += 1

            # If the log is finished and we've caught up, close the stream
            if log.finished and cursor >= len(log.events):
                break

            # Wait for new events or send keepalive on timeout
            try:
                await asyncio.wait_for(log.wait_for_new(), timeout=25.0)
            except asyncio.TimeoutError:
                yield ": keep-alive\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
