"""Branch pipeline -- single-question mini-documentary.

Triggered by POST /session/:id/branch. Runs:
  SceneResearchOrchestrator (1 researcher) -> ScriptAgentOrchestrator (capped to 1 segment)

The new segment is written to Firestore with parentSegmentId + triggerQuestion fields.
"""

from __future__ import annotations

import json
import logging
import os
import uuid

from google.adk.sessions import InMemorySessionService
from google.cloud import firestore

from .scene_research_agent import build_scene_research_orchestrator
from .script_agent_orchestrator import build_script_agent_orchestrator
from .sse_helpers import (
    SSEEmitter,
    build_branch_segment_ready_event,
    build_branch_triggered_event,
)

logger = logging.getLogger(__name__)


async def run_branch_pipeline(
    emitter: SSEEmitter | None,
    question: str,
    session_id: str,
    parent_segment_id: str,
) -> None:
    """Run a lightweight branch pipeline for a single user question.

    Creates a minimal ADK session with the question as a single scene brief,
    runs scene research (1 researcher) then script generation (capped to 1
    segment), and writes the resulting segment to Firestore with branch
    metadata (parentSegmentId, triggerQuestion).

    Args:
        emitter: Optional SSE emitter for frontend progress events.
        question: The user's question that triggered the branch.
        session_id: Parent session ID (Firestore document path).
        parent_segment_id: Segment the user was watching when they asked.
    """
    gcp_project = os.environ.get("GCP_PROJECT_ID", "")
    db = firestore.AsyncClient(project=gcp_project)

    # ------------------------------------------------------------------
    # Emit branch_triggered so frontend knows a branch is in progress
    # ------------------------------------------------------------------
    if emitter is not None:
        await emitter.emit(
            "branch_triggered",
            build_branch_triggered_event(
                session_id=session_id,
                parent_segment_id=parent_segment_id,
                question=question,
            ),
        )

    # ------------------------------------------------------------------
    # Load existing session state from the parent session's Firestore doc
    # to provide visual_bible and document_map context for the branch.
    # ------------------------------------------------------------------
    parent_doc = await db.collection("sessions").document(session_id).get()
    parent_data = parent_doc.to_dict() or {} if parent_doc.exists else {}

    # ------------------------------------------------------------------
    # Build a synthetic single-scene brief from the question
    # ------------------------------------------------------------------
    branch_scene_id = f"branch_{uuid.uuid4().hex[:8]}"
    synthetic_brief = {
        "scene_id": branch_scene_id,
        "title": question,
        "cinematic_hook": question,
        "era_and_location": parent_data.get("eraContext", "historical context"),
        "narrative_role": "rising_action",
        "source_chunk_ids": [],
        "key_claims": [question],
    }

    # ------------------------------------------------------------------
    # Create a fresh ADK in-memory session with required state keys
    # ------------------------------------------------------------------
    session_service = InMemorySessionService()

    branch_session_id = f"{session_id}_branch_{uuid.uuid4().hex[:8]}"

    session = await session_service.create_session(
        app_name="historian_branch",
        user_id="branch_user",
        session_id=branch_session_id,
        state={
            "scene_briefs": [synthetic_brief],
            "visual_bible": parent_data.get("visualBible", ""),
            "document_map": parent_data.get("documentMap", ""),
            # Pre-populate research slots so aggregator template vars resolve
            "research_0": "",
            **{f"research_{i}": "" for i in range(1, 10)},
            # Pre-populate scene context for the single researcher
            "scene_0_brief": json.dumps(synthetic_brief, ensure_ascii=False),
            "scene_0_chunks": question,
        },
    )

    # ------------------------------------------------------------------
    # Build and run the research phase (1 researcher)
    # ------------------------------------------------------------------
    scene_research = build_scene_research_orchestrator(emitter=emitter)

    try:
        from google.adk.runners import Runner

        runner = Runner(
            agent=scene_research,
            app_name="historian_branch",
            session_service=session_service,
        )

        async for event in runner.run_async(
            user_id="branch_user",
            session_id=branch_session_id,
            new_message=None,
        ):
            pass  # Events yielded for ADK tracking; SSE emitter handles frontend
    except Exception:
        logger.exception(
            "Branch research failed for session %s, question: %s",
            session_id,
            question,
        )

    # Refresh session state after research
    session = await session_service.get_session(
        app_name="historian_branch",
        user_id="branch_user",
        session_id=branch_session_id,
    )

    # Provide aggregated research (simple passthrough of research_0)
    if session is not None:
        research_result = session.state.get("research_0", "")
        session.state["aggregated_research"] = research_result

    # ------------------------------------------------------------------
    # Build and run the script phase (produces 1 segment)
    # ------------------------------------------------------------------
    script_orch = build_script_agent_orchestrator(emitter=emitter)

    try:
        runner = Runner(
            agent=script_orch,
            app_name="historian_branch",
            session_service=session_service,
        )

        async for event in runner.run_async(
            user_id="branch_user",
            session_id=branch_session_id,
            new_message=None,
        ):
            pass
    except Exception:
        logger.exception(
            "Branch script generation failed for session %s, question: %s",
            session_id,
            question,
        )
        return

    # ------------------------------------------------------------------
    # Find the newest segment written by ScriptAgentOrchestrator and
    # update it with branch metadata.
    # ------------------------------------------------------------------
    session = await session_service.get_session(
        app_name="historian_branch",
        user_id="branch_user",
        session_id=branch_session_id,
    )

    if session is None:
        logger.error("Branch session lost for %s", session_id)
        return

    script_output = session.state.get("script", [])
    if not script_output:
        logger.error(
            "Branch pipeline produced no segments for session %s, question: %s",
            session_id,
            question,
        )
        return

    # The script orchestrator writes segments to Firestore under the
    # branch session ID. We need to copy the segment to the real session.
    first_segment = script_output[0] if isinstance(script_output, list) else {}
    segment_id = first_segment.get("id", f"branch_segment_{uuid.uuid4().hex[:8]}")
    segment_title = first_segment.get("title", question[:60])

    # Write the branch segment to the REAL session's segments collection
    segment_ref = (
        db.collection("sessions")
        .document(session_id)
        .collection("segments")
        .document(segment_id)
    )

    segment_doc = {
        "sceneId": first_segment.get("scene_id", branch_scene_id),
        "title": segment_title,
        "script": first_segment.get("narration_script", ""),
        "visualDescriptions": first_segment.get("visual_descriptions", []),
        "veo2Scene": first_segment.get("veo2_scene"),
        "mood": first_segment.get("mood", "scholarly"),
        "narrativeRole": first_segment.get("narrative_role", "rising_action"),
        "sources": first_segment.get("sources", []),
        "imageUrls": [],
        "videoUrl": None,
        "graphEdges": [parent_segment_id],
        "status": "generating",
        "parentSegmentId": parent_segment_id,
        "triggerQuestion": question,
        "createdAt": firestore.SERVER_TIMESTAMP,
    }

    await segment_ref.set(segment_doc)

    logger.info(
        "Branch segment %s written to session %s (parent: %s, question: %s)",
        segment_id,
        session_id,
        parent_segment_id,
        question[:80],
    )

    # ------------------------------------------------------------------
    # Emit branch_segment_ready so frontend can add it to the graph
    # ------------------------------------------------------------------
    if emitter is not None:
        await emitter.emit(
            "branch_segment_ready",
            build_branch_segment_ready_event(
                segment_id=segment_id,
                parent_segment_id=parent_segment_id,
                question=question,
                title=segment_title,
            ),
        )
