"""Session management routes for historian_api.

Endpoints:
  GET  /api/session/create                          → generate signed GCS upload URL + create Firestore session
  GET  /api/session/{session_id}/status             → poll session state from Firestore
  GET  /api/session/{session_id}/agent/{agent_id}/logs → fetch agent log entries from Firestore
  GET  /api/meta?url=<encoded_url>                  → fetch Open Graph metadata for a URL
"""
from __future__ import annotations

import logging
import os
import time
import uuid
from collections import OrderedDict
from datetime import timedelta
from urllib.parse import urljoin, urlparse

import google.auth
import google.auth.transport.requests
import httpx
from bs4 import BeautifulSoup
from fastapi import APIRouter, BackgroundTasks, HTTPException, Query
from google.cloud import firestore, storage

from ..models import (
    AgentLogsResponse,
    BranchRequest,
    BranchResponse,
    ClipRequest,
    ClipStartResponse,
    ClipStatusResponse,
    CreateSessionResponse,
    GroundingSourcesResponse,
    SegmentResponse,
    SegmentsResponse,
    SessionStatusResponse,
    UrlMetaResponse,
)

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
async def create_session(
    filename: str = "document.pdf",
    language: str | None = None,
    persona: str = "professor",
) -> CreateSessionResponse:
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
            "persona": persona,
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


# ---------------------------------------------------------------------------
# Branch pipeline trigger
# ---------------------------------------------------------------------------


@router.post("/session/{session_id}/branch", response_model=BranchResponse)
async def branch_session(
    session_id: str,
    body: BranchRequest,
    background_tasks: BackgroundTasks,
) -> BranchResponse:
    """Trigger a branch pipeline for a user question during documentary playback.

    Finds the most recent segment to use as parent, then kicks off the branch
    pipeline as a background task and returns immediately with a placeholder
    segment ID.
    """
    from agent_orchestrator.agents.branch_pipeline import run_branch_pipeline

    # Find the most recent segment to use as parent_segment_id
    db = get_db()
    parent_segment_id = "root"
    try:
        segments_ref = (
            db.collection("sessions")
            .document(session_id)
            .collection("segments")
            .order_by("createdAt", direction=firestore.Query.DESCENDING)
            .limit(1)
        )
        docs = await segments_ref.get()
        for doc in docs:
            parent_segment_id = doc.id
    except Exception:
        logger.warning(
            "Could not fetch latest segment for session %s, using 'root'",
            session_id,
        )

    # Generate a placeholder segment ID returned to the caller immediately
    placeholder_segment_id = f"branch_{uuid.uuid4().hex[:12]}"

    # Run the branch pipeline in the background
    background_tasks.add_task(
        run_branch_pipeline,
        emitter=None,  # No SSE emitter for background tasks (events go via polling)
        question=body.question,
        session_id=session_id,
        parent_segment_id=parent_segment_id,
    )

    return BranchResponse(segmentId=placeholder_segment_id)


# ---------------------------------------------------------------------------
# URL metadata cache (in-memory, TTL 1 hour, max 500 entries)
# ---------------------------------------------------------------------------

_META_CACHE: OrderedDict[str, tuple[float, dict]] = OrderedDict()
_META_CACHE_TTL = 3600  # seconds
_META_CACHE_MAX = 500


def _cache_get(url: str) -> dict | None:
    """Return cached meta dict if present and not expired, else None."""
    entry = _META_CACHE.get(url)
    if entry is None:
        return None
    ts, data = entry
    if time.monotonic() - ts > _META_CACHE_TTL:
        _META_CACHE.pop(url, None)
        return None
    # Move to end (most recently accessed)
    _META_CACHE.move_to_end(url)
    return data


def _cache_set(url: str, data: dict) -> None:
    """Store meta dict in cache, evicting oldest if over limit."""
    _META_CACHE[url] = (time.monotonic(), data)
    _META_CACHE.move_to_end(url)
    while len(_META_CACHE) > _META_CACHE_MAX:
        _META_CACHE.popitem(last=False)


def _make_absolute(base_url: str, href: str | None) -> str | None:
    """Convert a potentially relative URL to absolute. Return None if input is None/empty."""
    if not href:
        return None
    if href.startswith(("http://", "https://", "//")):
        if href.startswith("//"):
            return "https:" + href
        return href
    return urljoin(base_url, href)


def _extract_meta(url: str, html: str) -> dict:
    """Parse HTML and extract Open Graph / Twitter meta + favicon."""
    soup = BeautifulSoup(html, "html.parser")

    def og(prop: str) -> str | None:
        tag = soup.find("meta", attrs={"property": prop})
        if tag:
            return tag.get("content")  # type: ignore[return-value]
        return None

    def meta_name(name: str) -> str | None:
        tag = soup.find("meta", attrs={"name": name})
        if tag:
            return tag.get("content")  # type: ignore[return-value]
        return None

    title = og("og:title")
    if not title:
        title_tag = soup.find("title")
        if title_tag:
            title = title_tag.get_text(strip=True)

    description = og("og:description") or meta_name("description")

    image = _make_absolute(url, og("og:image") or meta_name("twitter:image"))

    # Favicon: look for <link rel="icon"> or <link rel="shortcut icon">
    favicon: str | None = None
    for rel_val in (["icon"], ["shortcut", "icon"]):
        link_tag = soup.find("link", rel=rel_val)
        if link_tag and link_tag.get("href"):
            favicon = _make_absolute(url, link_tag["href"])  # type: ignore[arg-type]
            break

    parsed = urlparse(url)
    hostname = parsed.hostname or parsed.netloc

    # Google favicon fallback
    if not favicon:
        favicon = f"https://www.google.com/s2/favicons?domain={hostname}&sz=64"

    return {
        "url": url,
        "title": title,
        "description": description,
        "image": image,
        "favicon": favicon,
        "hostname": hostname,
    }


@router.get("/meta", response_model=UrlMetaResponse)
async def get_url_meta(url: str = Query(..., description="URL to fetch metadata for")) -> UrlMetaResponse:
    """Fetch Open Graph metadata for a URL (server-side proxy to avoid CORS)."""
    # Validate URL shape
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        return UrlMetaResponse(
            url=url,
            title=None,
            description=None,
            image=None,
            favicon=f"https://www.google.com/s2/favicons?domain=unknown&sz=64",
            hostname=parsed.hostname or "unknown",
        )

    # Check cache
    cached = _cache_get(url)
    if cached is not None:
        return UrlMetaResponse(**cached)

    # Fetch
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(5.0),
            follow_redirects=True,
            headers={"User-Agent": "AIHistorianBot/1.0 (metadata preview)"},
        ) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            html = resp.text
    except Exception:
        logger.debug("Meta fetch failed for %s", url, exc_info=True)
        hostname = parsed.hostname or "unknown"
        fallback = {
            "url": url,
            "title": None,
            "description": None,
            "image": None,
            "favicon": f"https://www.google.com/s2/favicons?domain={hostname}&sz=64",
            "hostname": hostname,
        }
        _cache_set(url, fallback)
        return UrlMetaResponse(**fallback)

    meta = _extract_meta(url, html)
    _cache_set(url, meta)
    return UrlMetaResponse(**meta)


# ---------------------------------------------------------------------------
# Shareable Clips
# ---------------------------------------------------------------------------

@router.post("/session/{session_id}/clips", response_model=ClipStartResponse)
async def create_clip(
    session_id: str,
    body: ClipRequest,
    background_tasks: BackgroundTasks,
) -> ClipStartResponse:
    """Enqueue a shareable MP4 clip for a segment. Implemented by Team 5."""
    raise HTTPException(status_code=501, detail="Clip generator not yet implemented")


@router.get("/session/{session_id}/clips/{clip_id}", response_model=ClipStatusResponse)
async def get_clip_status(session_id: str, clip_id: str) -> ClipStatusResponse:
    """Poll clip generation status. Implemented by Team 5."""
    raise HTTPException(status_code=501, detail="Clip generator not yet implemented")


# ---------------------------------------------------------------------------
# Grounding Sources
# ---------------------------------------------------------------------------

@router.get("/session/{session_id}/segments/{segment_id}/sources", response_model=GroundingSourcesResponse)
async def get_segment_sources(session_id: str, segment_id: str) -> GroundingSourcesResponse:
    """Return verified grounding sources for a segment from visual manifests. Implemented by Team 3."""
    raise HTTPException(status_code=501, detail="Sources endpoint not yet implemented")
