"""Session management routes for historian_api.

Endpoints:
  GET  /api/session/create                          → generate signed GCS upload URL + create Firestore session
  GET  /api/session/{session_id}/status             → poll session state from Firestore
  GET  /api/session/{session_id}/agent/{agent_id}/logs → fetch agent log entries from Firestore
"""
from __future__ import annotations

import logging
import os
import uuid
from datetime import timedelta

import google.auth
import google.auth.transport.requests
from fastapi import APIRouter, HTTPException
from google.cloud import firestore, storage

from ..models import AgentLogsResponse, CreateSessionResponse, SessionStatusResponse, SegmentsResponse, SegmentResponse

logger = logging.getLogger(__name__)
router = APIRouter()

GCS_BUCKET = os.environ.get("GCS_BUCKET_NAME", "historian-docs")

_db: firestore.AsyncClient | None = None
_gcs: storage.Client | None = None


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


@router.get("/session/create", response_model=CreateSessionResponse)
async def create_session(filename: str = "document.pdf", language: str | None = None) -> CreateSessionResponse:
    """Create a new session: write Firestore doc + generate signed GCS upload URL."""
    session_id = str(uuid.uuid4())
    gcs_path = f"gs://{GCS_BUCKET}/{session_id}/document.pdf"
    blob_path = f"{session_id}/document.pdf"

    # Generate signed URL for direct browser-to-GCS upload (PUT, 10 min expiry)
    # Uses google-auth credentials with request signer to support ADC (no service account key needed)
    try:
        credentials, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
        bucket = get_gcs().bucket(GCS_BUCKET)
        blob = bucket.blob(blob_path)
        upload_url = blob.generate_signed_url(
            credentials=credentials,
            version="v4",
            expiration=timedelta(minutes=10),
            method="PUT",
            content_type="application/pdf",
        )
    except Exception as exc:
        logger.exception("Failed to generate signed URL")
        raise HTTPException(status_code=500, detail="Could not generate upload URL") from exc

    # Write initial session document to Firestore
    try:
        db = get_db()
        await db.collection("sessions").document(session_id).set({
            "status": "uploading",
            "gcsPath": gcs_path,
            "language": language,
            "visualBible": None,
            "createdAt": firestore.SERVER_TIMESTAMP,
        })
    except Exception as exc:
        logger.exception("Failed to create Firestore session")
        raise HTTPException(status_code=500, detail="Could not create session") from exc

    return CreateSessionResponse(
        sessionId=session_id,
        uploadUrl=upload_url,
        gcsPath=gcs_path,
    )


@router.get("/session/{session_id}/status", response_model=SessionStatusResponse)
async def get_session_status(session_id: str) -> SessionStatusResponse:
    """Return current session state from Firestore."""
    try:
        db = get_db()
        doc = await db.collection("sessions").document(session_id).get()
    except Exception as exc:
        logger.exception("Firestore read failed for session %s", session_id)
        raise HTTPException(status_code=500, detail="Could not read session") from exc

    if not doc.exists:
        raise HTTPException(status_code=404, detail="Session not found")

    data = doc.to_dict() or {}
    return SessionStatusResponse(
        sessionId=session_id,
        status=data.get("status", "idle"),
        language=data.get("language"),
        visualBible=data.get("visualBible"),
        documentUrl=data.get("documentUrl"),
    )


@router.get("/session/{session_id}/agent/{agent_id}/logs", response_model=AgentLogsResponse)
async def get_agent_logs(session_id: str, agent_id: str) -> AgentLogsResponse:
    """Return full agent log for the AgentModal."""
    try:
        db = get_db()
        doc = (
            await db.collection("sessions")
            .document(session_id)
            .collection("agents")
            .document(agent_id)
            .get()
        )
    except Exception as exc:
        logger.exception("Firestore read failed for agent %s/%s", session_id, agent_id)
        raise HTTPException(status_code=500, detail="Could not read agent logs") from exc

    if not doc.exists:
        raise HTTPException(status_code=404, detail="Agent not found")

    data = doc.to_dict() or {}
    return AgentLogsResponse(
        agentId=agent_id,
        query=data.get("query", ""),
        status=data.get("status", "queued"),
        logs=data.get("logs", []),
        facts=data.get("facts", []),
    )


def _gs_to_signed_url(gs_uri: str) -> str:
    """Convert a gs://bucket/path URI to a 1-hour signed HTTPS GET URL."""
    try:
        without_scheme = gs_uri[5:]  # strip "gs://"
        bucket_name, _, blob_name = without_scheme.partition("/")
        credentials, _ = google.auth.default(
            scopes=["https://www.googleapis.com/auth/cloud-platform"]
        )
        blob = get_gcs().bucket(bucket_name).blob(blob_name)
        return blob.generate_signed_url(
            credentials=credentials,
            version="v4",
            expiration=timedelta(hours=1),
            method="GET",
        )
    except Exception:
        return gs_uri  # fallback: return original URI


@router.get("/session/{session_id}/segments", response_model=SegmentsResponse)
async def get_session_segments(session_id: str) -> SegmentsResponse:
    """Return all segments for a session with signed image URLs."""
    try:
        db = get_db()
        docs = (
            await db.collection("sessions")
            .document(session_id)
            .collection("segments")
            .get()
        )
    except Exception as exc:
        logger.exception("Firestore segments read failed for %s", session_id)
        raise HTTPException(status_code=500, detail="Could not read segments") from exc

    segments: list[SegmentResponse] = []
    for doc in docs:
        d = doc.to_dict() or {}
        raw_image_urls: list[str] = d.get("imageUrls", [])
        signed_image_urls = [
            _gs_to_signed_url(u) if u.startswith("gs://") else u
            for u in raw_image_urls
        ]
        video_url = d.get("videoUrl")
        if video_url and video_url.startswith("gs://"):
            video_url = _gs_to_signed_url(video_url)
        segments.append(
            SegmentResponse(
                id=doc.id,
                sceneId=d.get("sceneId", ""),
                title=d.get("title", ""),
                script=d.get("script", ""),
                mood=d.get("mood", ""),
                status=d.get("status", "pending"),
                imageUrls=signed_image_urls,
                videoUrl=video_url,
                sources=d.get("sources", []),
            )
        )

    segments.sort(key=lambda s: s.id)
    return SegmentsResponse(segments=segments)
