"""Callbacks for the Visual Research Agent that emit SSE events.

Parses the agent's streaming output to detect source evaluations in real time
and emits `agent_source_evaluation` SSE events as each source is evaluated.
This powers the source-evaluation shimmer animation in the frontend's
AgentModal component.
"""

from __future__ import annotations

import json
import logging
import re
import time
from typing import Any

from .sse_helpers import (
    SSEEmitter,
    build_agent_source_evaluation_event,
    build_agent_status_event,
)

logger = logging.getLogger(__name__)

AGENT_ID = "visual_research_agent"


async def on_visual_research_start(
    emitter: SSEEmitter,
) -> None:
    """Emit status event when the visual research agent begins execution."""
    await emitter.emit(
        "agent_status",
        build_agent_status_event(
            agent_id=AGENT_ID,
            status="searching",
            query="Searching for period-accurate visual references",
        ),
    )


async def on_visual_research_complete(
    emitter: SSEEmitter,
    elapsed: float,
) -> None:
    """Emit status event when the visual research agent finishes."""
    await emitter.emit(
        "agent_status",
        build_agent_status_event(
            agent_id=AGENT_ID,
            status="done",
            query="Searching for period-accurate visual references",
            elapsed=elapsed,
        ),
    )


async def on_visual_research_error(
    emitter: SSEEmitter,
    error_message: str,
) -> None:
    """Emit error status when the visual research agent fails."""
    await emitter.emit(
        "agent_status",
        build_agent_status_event(
            agent_id=AGENT_ID,
            status="error",
            query="Searching for period-accurate visual references",
        ),
    )
    await emitter.emit(
        "error",
        {
            "type": "error",
            "message": error_message,
            "agentId": AGENT_ID,
        },
    )


def parse_source_evaluations(output_text: str) -> list[dict[str, Any]]:
    """Extract source evaluation objects from the agent's JSON output.

    The agent outputs a JSON structure with `reference_sources` arrays per
    segment. This parser extracts all source evaluations across all segments
    for SSE emission.

    Args:
        output_text: The raw text output from the visual research agent.
            May contain markdown fences around JSON.

    Returns:
        List of source evaluation dicts with keys: url, title, accepted, reason.
    """
    # Strip markdown code fences if present
    cleaned = output_text.strip()
    if cleaned.startswith("```"):
        # Remove opening fence (possibly ```json)
        cleaned = re.sub(r"^```(?:json)?\s*\n?", "", cleaned)
        # Remove closing fence
        cleaned = re.sub(r"\n?```\s*$", "", cleaned)

    sources: list[dict[str, Any]] = []

    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError:
        logger.warning(
            "Failed to parse visual research output as JSON; "
            "attempting to extract reference_sources via regex"
        )
        # Fallback: try to find JSON objects that look like source evaluations
        pattern = re.compile(
            r'\{\s*"url"\s*:\s*"[^"]+"\s*,\s*"title"\s*:\s*"[^"]*"\s*,'
            r'\s*"accepted"\s*:\s*(?:true|false)\s*,\s*"reason"\s*:\s*"[^"]*"\s*\}',
            re.DOTALL,
        )
        for match in pattern.finditer(output_text):
            try:
                sources.append(json.loads(match.group()))
            except json.JSONDecodeError:
                continue
        return sources

    segments = data.get("segments", [])
    for segment in segments:
        for ref in segment.get("reference_sources", []):
            if all(k in ref for k in ("url", "title", "accepted", "reason")):
                sources.append(
                    {
                        "url": ref["url"],
                        "title": ref["title"],
                        "accepted": ref["accepted"],
                        "reason": ref["reason"],
                    }
                )

    return sources


async def emit_source_evaluations(
    emitter: SSEEmitter,
    output_text: str,
) -> int:
    """Parse agent output and emit SSE events for each evaluated source.

    Args:
        emitter: The SSE emitter to send events through.
        output_text: The raw text output from the visual research agent.

    Returns:
        Number of source evaluation events emitted.
    """
    sources = parse_source_evaluations(output_text)

    for source in sources:
        event = build_agent_source_evaluation_event(
            agent_id=AGENT_ID,
            url=source["url"],
            title=source["title"],
            accepted=source["accepted"],
            reason=source["reason"],
        )
        await emitter.emit("agent_source_evaluation", event)

    logger.info(
        "Emitted %d source evaluation events for %s",
        len(sources),
        AGENT_ID,
    )
    return len(sources)
