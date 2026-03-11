"""Checkpoint persistence helpers for the resumable pipeline.

Provides ``load_checkpoint`` and ``save_checkpoint`` functions that read and
write pipeline phase completion state to Firestore, enabling the pipeline to
resume from the last successful phase after a failure or restart.

Firestore schema::

    /sessions/{sessionId}/checkpoints/pipeline
    {
        "completed_phases": [1, 2, 3],        // arrayUnion on each save
        "state_snapshot": { ... },             // session.state keys for completed phases
        "updated_at": SERVER_TIMESTAMP
    }

Phase-to-output-key mapping defines which ``session.state`` keys are
checkpointed after each phase completes.
"""

from __future__ import annotations

import logging
from typing import Any

from google.cloud import firestore

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Phase output key mapping
# ---------------------------------------------------------------------------
# Maps each pipeline phase number to the session.state keys it produces.
# Dynamic keys (research_{n}, scene_{n}_brief, etc.) are handled separately
# in save_checkpoint by scanning for matching prefixes.
# ---------------------------------------------------------------------------

PHASE_OUTPUT_KEYS: dict[int | float, list[str]] = {
    1: [
        "gcs_ocr_path",
        "total_pages",
        "document_map",
        "scene_briefs",
        "visual_bible",
        "visual_bible_seed",
    ],
    2: [
        "aggregated_research",
        # Plus dynamic research_{n}, scene_{n}_brief, scene_{n}_chunks keys
        # handled by prefix scan in save_checkpoint.
    ],
    3: ["script"],
    3.5: ["validation_report"],
    4: ["visual_storyboard"],
    5: ["visual_research_manifest"],
    6: ["image_urls", "video_urls"],
}

# Prefixes for dynamic keys produced by Phase II
_PHASE_2_DYNAMIC_PREFIXES: tuple[str, ...] = (
    "research_",
    "scene_",  # scene_{n}_brief, scene_{n}_chunks
)


# ---------------------------------------------------------------------------
# Load checkpoint
# ---------------------------------------------------------------------------


async def load_checkpoint(
    db: firestore.AsyncClient,
    session_id: str,
) -> tuple[list[int | float], dict[str, Any]]:
    """Load the pipeline checkpoint from Firestore.

    Reads the checkpoint document for the given session and returns the list
    of completed phases and the saved state snapshot. If no checkpoint exists,
    returns empty results so the pipeline starts from phase 1.

    Args:
        db: Async Firestore client.
        session_id: Session identifier.

    Returns:
        A tuple of (completed_phases, state_snapshot):
        - completed_phases: sorted list of phase numbers already done.
        - state_snapshot: dict of session.state keys to restore.
    """
    ref = (
        db.collection("sessions")
        .document(session_id)
        .collection("checkpoints")
        .document("pipeline")
    )

    try:
        snap = await ref.get()
    except Exception as exc:
        logger.warning(
            "Failed to read checkpoint for session %s: %s. "
            "Starting pipeline from scratch.",
            session_id,
            exc,
        )
        return [], {}

    if not snap.exists:
        logger.info(
            "No checkpoint found for session %s. Starting from phase 1.",
            session_id,
        )
        return [], {}

    data = snap.to_dict() or {}
    completed_phases: list[int | float] = sorted(data.get("completed_phases", []))
    state_snapshot: dict[str, Any] = data.get("state_snapshot", {})

    logger.info(
        "Loaded checkpoint for session %s: completed phases %s, "
        "%d state keys restored.",
        session_id,
        completed_phases,
        len(state_snapshot),
    )

    return completed_phases, state_snapshot


# ---------------------------------------------------------------------------
# Save checkpoint
# ---------------------------------------------------------------------------


async def save_checkpoint(
    db: firestore.AsyncClient,
    session_id: str,
    phase: int | float,
    state: dict[str, Any],
) -> None:
    """Save a pipeline phase checkpoint to Firestore.

    Uses ``arrayUnion`` to append the phase number to ``completed_phases``
    and ``merge=True`` to preserve existing checkpoint data. The state
    snapshot is updated with keys relevant to the completed phase.

    Args:
        db: Async Firestore client.
        session_id: Session identifier.
        phase: Phase number that just completed (e.g. 1, 2, 3, 3.5, 4, 5, 6).
        state: Current ``session.state`` dict to extract checkpointed keys from.
    """
    ref = (
        db.collection("sessions")
        .document(session_id)
        .collection("checkpoints")
        .document("pipeline")
    )

    # Collect the output keys for this phase
    output_keys = PHASE_OUTPUT_KEYS.get(phase, [])

    # Build the state snapshot delta for this phase
    snapshot_delta: dict[str, Any] = {}
    for key in output_keys:
        if key in state:
            snapshot_delta[key] = state[key]

    # For Phase 2, also save dynamic research_{n} and scene_{n}_* keys
    if phase == 2:
        for key, value in state.items():
            if any(key.startswith(prefix) for prefix in _PHASE_2_DYNAMIC_PREFIXES):
                snapshot_delta[key] = value

    try:
        await ref.set(
            {
                "completed_phases": firestore.ArrayUnion([phase]),
                "state_snapshot": snapshot_delta,
                "updated_at": firestore.SERVER_TIMESTAMP,
            },
            merge=True,
        )
        logger.info(
            "Saved checkpoint for session %s: phase %s complete, "
            "%d state keys persisted.",
            session_id,
            phase,
            len(snapshot_delta),
        )
    except Exception as exc:
        logger.error(
            "Failed to save checkpoint for session %s phase %s: %s",
            session_id,
            phase,
            exc,
        )
        # Do not raise -- checkpoint failure should not kill the pipeline.
