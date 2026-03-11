"""SSE event emission helpers for the ADK agent pipeline.

Provides typed helper functions for emitting Server-Sent Events to the
frontend via the SSE stream. All event payloads conform to the TypeScript
SSEEvent union type defined in frontend/src/types/index.ts.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Protocol

logger = logging.getLogger(__name__)


class SSEEmitter(Protocol):
    """Protocol for SSE event emission backends.

    Implementations may write to an asyncio.Queue, a FastAPI StreamingResponse,
    a Pub/Sub topic, or any other transport.
    """

    async def emit(self, event_type: str, data: dict[str, Any]) -> None:
        """Emit a single SSE event."""
        ...


@dataclass
class QueueSSEEmitter:
    """Emits SSE events to an asyncio.Queue for consumption by FastAPI SSE endpoints."""

    queue: Any  # asyncio.Queue[str] — using Any to avoid import-time asyncio dependency

    async def emit(self, event_type: str, data: dict[str, Any]) -> None:
        """Serialize and enqueue an SSE event.

        Uses unnamed events (no ``event:`` line) so that EventSource.onmessage
        fires on the frontend. The ``type`` field inside the JSON payload is
        used for client-side dispatch instead.
        """
        payload = json.dumps(data, default=str)
        message = f"data: {payload}\n\n"
        await self.queue.put(message)


@dataclass
class LogSSEEmitter:
    """Emits SSE events to a SessionEventLog for replay-capable SSE streaming.

    Unlike QueueSSEEmitter, events are appended to a persistent log so that
    reconnecting clients can replay missed events via the Last-Event-ID header.
    """

    log: Any  # SessionEventLog — using Any to avoid circular import

    async def emit(self, event_type: str, data: dict[str, Any]) -> None:
        """Serialize and append an SSE event to the session log."""
        payload = json.dumps(data, default=str)
        self.log.append(payload)


def build_agent_source_evaluation_event(
    *,
    agent_id: str,
    url: str,
    title: str,
    accepted: bool,
    reason: str,
) -> dict[str, Any]:
    """Build an agent_source_evaluation SSE event payload.

    Matches the AgentSourceEvaluationEvent TypeScript interface:
        {
            type: 'agent_source_evaluation',
            agentId: string,
            source: { url, title, accepted, reason }
        }
    """
    return {
        "type": "agent_source_evaluation",
        "agentId": agent_id,
        "source": {
            "url": url,
            "title": title,
            "accepted": accepted,
            "reason": reason,
        },
    }


def build_agent_status_event(
    *,
    agent_id: str,
    status: str,
    query: str | None = None,
    facts: list[str] | None = None,
    elapsed: float | None = None,
    error_message: str | None = None,
) -> dict[str, Any]:
    """Build an agent_status SSE event payload.

    Matches the AgentStatusEvent TypeScript interface.
    """
    event: dict[str, Any] = {
        "type": "agent_status",
        "agentId": agent_id,
        "status": status,
    }
    if query is not None:
        event["query"] = query
    if facts is not None:
        event["facts"] = facts
    if elapsed is not None:
        event["elapsed"] = elapsed
    if error_message is not None:
        event["errorMessage"] = error_message
    return event


def build_pipeline_phase_event(
    *,
    phase: int,
    label: str,
    message: str,
) -> dict[str, Any]:
    """Build a pipeline_phase SSE event payload.

    Matches the PipelinePhaseEvent TypeScript interface.
    """
    return {
        "type": "pipeline_phase",
        "phase": phase,
        "label": label,
        "message": message,
    }


def build_branch_triggered_event(
    *,
    question: str,
    session_id: str,
) -> dict[str, Any]:
    """Build a branch_triggered SSE event payload.

    Emitted by the live-relay when it detects that the user's question
    should spawn a new branch mini-pipeline.
    """
    return {
        "type": "branch_triggered",
        "question": question,
        "sessionId": session_id,
    }


def build_branch_segment_ready_event(
    *,
    segment_id: str,
    parent_segment_id: str,
    trigger_question: str,
) -> dict[str, Any]:
    """Build a branch_segment_ready SSE event payload.

    Emitted by the branch pipeline once the new branched segment has been
    written to Firestore and is ready to play.
    """
    return {
        "type": "branch_segment_ready",
        "segmentId": segment_id,
        "parentSegmentId": parent_segment_id,
        "triggerQuestion": trigger_question,
    }


def build_segment_update_event(
    *,
    segment_id: str,
    scene_id: str,
    status: str,
    title: str | None = None,
    mood: str | None = None,
    narration_script: str | None = None,
    image_urls: list[str] | None = None,
    video_url: str | None = None,
) -> dict[str, Any]:
    """Build a segment_update SSE event payload.

    Emitted across Phases III, IV, and V as a segment progresses through the
    pipeline from skeleton to fully generated media.

    Status progression:
      "generating"       — Phase III: skeleton card gets a real title/mood
      "ready"            — Phase IV: visual research manifest complete
      "complete"         — Phase V: Imagen 3 images (and optional Veo 2 video) ready

    Args:
        segment_id: e.g. "segment_0"
        scene_id: Matching SceneBrief scene_id.
        status: "generating" | "ready" | "complete" | "error"
        title: Segment display title (included once known).
        mood: Emotional register string.
        narration_script: Narration text (included when status is "ready").
        image_urls: List of GCS URIs for generated Imagen 3 frames (Phase V).
        video_url: GCS URI for generated Veo 2 video (Phase V, optional).
    """
    event: dict[str, Any] = {
        "type": "segment_update",
        "segmentId": segment_id,
        "sceneId": scene_id,
        "status": status,
    }
    if title is not None:
        event["title"] = title
    if mood is not None:
        event["mood"] = mood
    if narration_script is not None:
        event["narrationScript"] = narration_script
    if image_urls is not None:
        event["imageUrls"] = image_urls
    if video_url is not None:
        event["videoUrl"] = video_url
    return event
