"""Phase 4.0 data-type contracts for the Narrative Visual Planner.

Defines the VisualStoryboard produced by NarrativeVisualPlanner -- the
director's shot list that assigns unique visual territory to each scene
before any research begins.
"""

from __future__ import annotations

from pydantic import BaseModel, Field, field_validator


# ---------------------------------------------------------------------------
# SceneVisualPlan
# ---------------------------------------------------------------------------


class SceneVisualPlan(BaseModel):
    """Visual direction for a single documentary scene.

    Each plan guarantees visual distinctness by declaring a unique
    ``primary_subject`` and an explicit ``avoid_list`` referencing what
    adjacent scenes depict.  The ``targeted_searches`` drive Phase IV
    archival research, and ``frame_concepts`` define the four Imagen 3
    frames generated per scene.
    """

    scene_id: str = Field(
        ...,
        description="Matching SceneBrief scene_id.",
    )
    primary_subject: str = Field(
        ...,
        description=(
            "Unique visual subject for this scene only.  No other scene in "
            "the storyboard may share this subject."
        ),
    )
    perspective: str = Field(
        ...,
        description=(
            "Camera position / angle philosophy for the scene, e.g. "
            "'low-angle looking up at fortress walls' or 'bird's-eye map view'."
        ),
    )
    time_of_day: str = Field(
        ...,
        description=(
            "Lighting context for the scene, e.g. 'dawn mist', "
            "'harsh noon', 'candlelit interior at dusk'."
        ),
    )
    color_palette: list[str] = Field(
        ...,
        min_length=3,
        max_length=4,
        description="3-4 dominant color descriptors for this scene.",
    )
    avoid_list: list[str] = Field(
        ...,
        description=(
            "Subjects, compositions, or elements shown in other scenes that "
            "this scene must NOT repeat.  Must reference adjacent scenes by name."
        ),
    )
    targeted_searches: list[str] = Field(
        ...,
        description=(
            "Exactly 3 archival-quality search queries for visual reference "
            "research (museum databases, academic archaeology, primary sources)."
        ),
    )
    frame_concepts: list[str] = Field(
        ...,
        description=(
            "Exactly 4 distinct subjects/moments for the scene's Imagen 3 "
            "frames.  Each must describe who/what is in the frame, what is "
            "happening, and the lighting condition.  NOT the same subject "
            "from 4 camera angles."
        ),
    )
    narrative_bridge: str = Field(
        ...,
        description=(
            "How this scene visually transitions to the next scene.  "
            "Empty string for the final scene."
        ),
    )

    # -- Validators --------------------------------------------------------

    @field_validator("targeted_searches", mode="after")
    @classmethod
    def _exactly_three_searches(cls, v: list[str]) -> list[str]:
        """Enforce exactly 3 targeted search queries."""
        if len(v) != 3:
            msg = f"targeted_searches must have exactly 3 items, got {len(v)}"
            raise ValueError(msg)
        return v

    @field_validator("frame_concepts", mode="after")
    @classmethod
    def _exactly_four_substantive_frames(cls, v: list[str]) -> list[str]:
        """Enforce exactly 4 frame concepts, each at least 20 characters."""
        if len(v) != 4:
            msg = f"frame_concepts must have exactly 4 items, got {len(v)}"
            raise ValueError(msg)
        for i, concept in enumerate(v):
            if len(concept) < 20:
                msg = (
                    f"frame_concepts[{i}] must be at least 20 characters "
                    f"to avoid empty or trivial descriptions, got {len(concept)}: "
                    f"{concept!r}"
                )
                raise ValueError(msg)
        return v


# ---------------------------------------------------------------------------
# VisualStoryboard
# ---------------------------------------------------------------------------


class VisualStoryboard(BaseModel):
    """The complete visual storyboard for a documentary session.

    Produced by ``NarrativeVisualPlanner`` (Phase 4.0) before any visual
    research begins.  Each scene receives a ``SceneVisualPlan`` that
    guarantees visual distinctness, provides targeted search queries for
    Phase IV, and defines 4 frame concepts for Imagen 3 generation.
    """

    session_id: str = Field(
        ...,
        description="Parent session this storyboard belongs to.",
    )
    scenes: dict[str, SceneVisualPlan] = Field(
        ...,
        description=(
            "Per-scene visual plans, keyed by scene_id.  "
            "Every SceneBrief from Phase I must have an entry."
        ),
    )
    global_palette: str = Field(
        ...,
        description=(
            "Visual bible summary ensuring cross-scene consistency.  "
            "Derived from the document's era, location, and overall mood."
        ),
    )
    color_temperature_arc: str = Field(
        ...,
        description=(
            "Emotional colour temperature progression across all scenes, "
            "e.g. 'warm opening -> cool climax -> melancholic coda'."
        ),
    )


# ---------------------------------------------------------------------------
# Deferred annotation resolution
# ---------------------------------------------------------------------------

SceneVisualPlan.model_rebuild()
VisualStoryboard.model_rebuild()
