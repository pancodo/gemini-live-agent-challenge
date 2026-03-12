"""Phase III data-type contracts for the Script Generation pipeline.

Defines the Pydantic v2 models produced by the Script Agent and consumed by
the Visual Research Orchestrator (Phase IV) and Visual Director (Phase V).

Every ``SegmentScript`` maps one-to-one to a ``SceneBrief`` from Phase I.
The Script Agent fills narration + visual descriptions; downstream phases
enrich and generate the actual media.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# Type aliases
# ---------------------------------------------------------------------------

SegmentMood = Literal["cinematic", "reflective", "dramatic", "scholarly"]
"""Emotional register of the segment, used by the Visual Director and player."""


# ---------------------------------------------------------------------------
# SegmentScript
# ---------------------------------------------------------------------------


class SegmentScript(BaseModel):
    """A fully scripted documentary segment produced by the Script Agent.

    Each instance corresponds to one ``SceneBrief`` from Phase I and carries
    everything needed to generate narration audio and visual frames.

    ``veo2_scene`` is optional — not every segment warrants a Veo 2 video clip.
    The Visual Director will skip Veo 2 generation when the field is absent.
    """

    id: str = Field(
        ...,
        description='Unique segment identifier, e.g. "segment_0".',
    )
    scene_id: str = Field(
        ...,
        description="scene_id of the SceneBrief this segment corresponds to.",
    )
    title: str = Field(
        ...,
        description="Display title for the documentary segment.",
    )
    narration_script: str = Field(
        ...,
        description=(
            "Full narration text read aloud by the Historian persona. "
            "Targets 60–120 seconds of spoken audio."
        ),
    )
    visual_descriptions: list[str] = Field(
        ...,
        min_length=1,
        description=(
            "Ordered list of Imagen 3 prompt strings — one per visual frame. "
            "The Script Agent produces 4 frames; Phase IV may enrich them."
        ),
    )
    veo2_scene: str | None = Field(
        default=None,
        description=(
            "Optional Veo 2 scene description for a dramatic video clip. "
            "None means no video generation for this segment."
        ),
    )
    mood: str = Field(
        ...,
        description=(
            'Emotional register: "cinematic", "reflective", "dramatic", '
            'or "scholarly".'
        ),
    )
    narrative_role: str = Field(
        default="",
        description=(
            "Dramatic arc position copied from the matching SceneBrief: "
            "opening | rising_action | climax | resolution | coda. "
            "Guides frame count selection in Phase V (Visual Director)."
        ),
    )
    sources: list[str] = Field(
        default_factory=list,
        description="Source citations used to ground the narration.",
    )
    storyboard_image_urls: list[str] = Field(
        default_factory=list,
        description=(
            "GCS URIs for Gemini-generated storyboard frames (Phase 3.1). "
            "Produced by the NarrativeDirectorAgent via response_modalities=['TEXT','IMAGE']. "
            "Phase V (VisualDirectorOrchestrator) uses these as reference images "
            "when building Imagen 3 prompts. Empty until Phase 3.1 completes."
        ),
    )


# ---------------------------------------------------------------------------
# Deferred annotation resolution
# ---------------------------------------------------------------------------

SegmentScript.model_rebuild()
