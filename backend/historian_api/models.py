"""Pydantic v2 request/response models for historian_api."""
from __future__ import annotations

from pydantic import BaseModel


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


class SegmentsResponse(BaseModel):
    segments: list[SegmentResponse]


class UrlMetaResponse(BaseModel):
    url: str
    title: str | None = None
    description: str | None = None
    image: str | None = None
    favicon: str | None = None
    hostname: str


class GroundingSourceItem(BaseModel):
    url: str
    title: str
    relevanceScore: float
    acceptedBy: list[str] = []


class GroundingSourcesResponse(BaseModel):
    sources: list[GroundingSourceItem]
