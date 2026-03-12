"""Pydantic v2 request/response models for historian_api."""
from __future__ import annotations

from pydantic import BaseModel, Field


class CreateSessionResponse(BaseModel):
    sessionId: str
    uploadUrl: str
    gcsPath: str


class SessionStatusResponse(BaseModel):
    sessionId: str
    status: str
    language: str | None = None
    visualBible: str | None = None
    documentUrl: str | None = None


class AgentLogsResponse(BaseModel):
    agentId: str
    query: str
    status: str
    logs: list[dict] = []
    facts: list[str] = []


class ProcessRequest(BaseModel):
    gcsPath: str


class SegmentResponse(BaseModel):
    id: str
    sceneId: str
    title: str
    script: str
    mood: str
    status: str
    imageUrls: list[str] = []
    videoUrl: str | None = None
    sources: list[str] = []
    graphEdges: list[str] = []


class SegmentsResponse(BaseModel):
    segments: list[SegmentResponse]


class UrlMetaResponse(BaseModel):
    url: str
    title: str | None = None
    description: str | None = None
    image: str | None = None
    favicon: str | None = None
    hostname: str


# ── Branch ────────────────────────────────────────────────────

class BranchRequest(BaseModel):
    question: str


class BranchResponse(BaseModel):
    segmentId: str


# ── Clips ─────────────────────────────────────────────────────

class ClipRequest(BaseModel):
    segmentId: str


class ClipStartResponse(BaseModel):
    clipId: str


class ClipStatusResponse(BaseModel):
    clipId: str
    status: str  # "queued" | "generating" | "ready" | "error"
    segmentId: str
    downloadUrl: str | None = None


# ── Grounding Sources ─────────────────────────────────────────

class GroundingSourceItem(BaseModel):
    url: str
    title: str
    relevanceScore: float
    acceptedBy: list[str] = []


class GroundingSourcesResponse(BaseModel):
    sources: list[GroundingSourceItem]


# ── RAG Retrieval ──────────────────────────────────────────────

class IllustrateRequest(BaseModel):
    query: str
    current_segment_id: str = ""
    mood: str = "cinematic"


class IllustrateResponse(BaseModel):
    imageUrl: str | None = None
    caption: str
    generatedAt: str


class RetrieveRequest(BaseModel):
    query: str
    top_k: int = Field(default=4, ge=1, le=10)


class RetrievedChunk(BaseModel):
    chunk_id: str
    text: str
    summary: str | None = None
    score: float
    page_start: int
    page_end: int
    heading: str | None = None


class RetrieveResponse(BaseModel):
    chunks: list[RetrievedChunk]
    query: str
