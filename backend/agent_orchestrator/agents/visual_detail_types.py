"""Phase IV data-type contracts for the Visual Research pipeline.

Two categories of types live here:

1. **Intermediate dataclasses** (in-memory, never persisted) — passed between the
   stage functions inside a single scene micro-pipeline run:
   ``DiscoveredSource``, ``TypedSource``, ``FetchedContent``.

2. **Pydantic v2 models** (serialised to Firestore and session.state) — the
   final artefacts written once a scene's pipeline completes:
   ``EvaluatedSource``, ``VisualDetailFragment``, ``MergedVisualDetail``,
   ``VisualDetailManifest``.

Design note: intermediate types are plain dataclasses to keep the stage
functions lightweight and avoid Pydantic validation overhead on data that is
never stored or transmitted.  Pydantic models are used only at the boundary
where data crosses into Firestore or session.state.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# Type aliases
# ---------------------------------------------------------------------------

SourceType = Literal["webpage", "pdf", "image", "wikipedia", "dataset", "unknown"]
"""Classification of a discovered web source, used to route Stage 3 fetching."""


# ---------------------------------------------------------------------------
# Intermediate dataclasses (in-memory only)
# ---------------------------------------------------------------------------


@dataclass
class DiscoveredSource:
    """A raw URL found by the google_search grounding call in Stage 1.

    ``snippet`` is empty for grounding-derived sources; it may be populated
    later from the model's grounding_supports metadata if available.
    """

    url: str
    title: str
    snippet: str = ""


@dataclass
class TypedSource:
    """A ``DiscoveredSource`` annotated with a ``SourceType`` classification.

    The type drives the routing logic in Stage 3 (Content Fetch): images go
    to Gemini multimodal, PDFs go to Document AI, Wikipedia URLs go to the
    REST summary API, and everything else goes to httpx + BeautifulSoup.
    """

    url: str
    title: str
    source_type: SourceType
    snippet: str = ""


@dataclass
class FetchedContent:
    """The raw text or image description extracted by Stage 3 for one source.

    ``content`` is capped at 8 000 characters (~2 000 tokens) before it enters
    the evaluation stage.  For images, ``content`` is a structured prose
    description produced by Gemini 2.0 Flash multimodal.
    """

    url: str
    title: str
    source_type: SourceType
    content: str  # Extracted text or structured image description


# ---------------------------------------------------------------------------
# Pydantic models (Firestore + session.state)
# ---------------------------------------------------------------------------


class EvaluatedSource(BaseModel):
    """One source after Stage 4 dual evaluation.

    Persisted in ``VisualDetailManifest.reference_sources`` so the frontend
    AgentModal can show the full audit trail of accepted and rejected sources.
    """

    url: str = Field(..., description="Source URL.")
    title: str = Field(..., description="Page title or archive entry title.")
    source_type: str = Field(
        ..., description="One of: webpage, pdf, image, wikipedia, dataset, unknown."
    )
    accepted: bool = Field(
        ...,
        description="True if the source passed both quality and relevance evaluation.",
    )
    authority_score: int = Field(
        default=0,
        ge=0,
        le=10,
        description="Quality Call A — institutional/primary-source authority (1–10).",
    )
    detail_density_score: int = Field(
        default=0,
        ge=0,
        le=10,
        description="Quality Call A — specific visual language vs generic overview (1–10).",
    )
    era_accuracy_score: int = Field(
        default=0,
        ge=0,
        le=10,
        description="Quality Call A — contemporary to the depicted period (1–10).",
    )
    relevance_score: int = Field(
        default=0,
        ge=0,
        le=10,
        description=(
            "Relevance Call B — how closely the source matches the scene brief (1–10). "
            "Zero if the source failed quality evaluation before relevance was assessed."
        ),
    )
    reason: str = Field(
        default="",
        description="One-sentence accept/reject rationale from the evaluation model.",
    )
    relevant_passages: list[str] = Field(
        default_factory=list,
        description=(
            "Verbatim quotes extracted during relevance evaluation. "
            "Only populated for accepted sources; passed directly to Stage 5."
        ),
    )


class VisualDetailFragment(BaseModel):
    """Structured visual details extracted from a single accepted source in Stage 5.

    Each field is a list of short, specific descriptive phrases — never summaries.
    The fragments from all accepted sources are merged in Stage 6 into a
    ``MergedVisualDetail``.
    """

    source_url: str = Field(..., description="URL of the source this fragment came from.")
    lighting: list[str] = Field(
        default_factory=list,
        description='e.g. ["side-lit by oil lamp", "golden afternoon haze"]',
    )
    materials: list[str] = Field(
        default_factory=list,
        description='e.g. ["worn oak floorboards", "brass filigree detail"]',
    )
    color_palette: list[str] = Field(
        default_factory=list,
        description='e.g. ["burnt sienna", "verdigris patina", "deep ochre"]',
    )
    architecture: list[str] = Field(
        default_factory=list,
        description='e.g. ["low vaulted ceiling", "pointed archway"]',
    )
    clothing: list[str] = Field(
        default_factory=list,
        description='e.g. ["embroidered kaftan collar", "rough-spun linen"]',
    )
    atmosphere: list[str] = Field(
        default_factory=list,
        description='e.g. ["dusty, market noise implied by visual density"]',
    )
    era_markers: list[str] = Field(
        default_factory=list,
        description='e.g. ["oil lanterns only", "no mechanical clocks visible"]',
    )
    subjects: list[str] = Field(
        default_factory=list,
        description="People in scene: count, posture, social role, occupation — described by activity and clothing, not physical appearance.",
    )
    compositional_notes: list[str] = Field(
        default_factory=list,
        description="Foreground/background spatial arrangement, depth cues, compositional plane separation.",
    )


class MergedVisualDetail(BaseModel):
    """Deduplicated, merged visual detail fields from all accepted source fragments.

    This is the ``detail_fields`` entry inside ``VisualDetailManifest``.
    Unlike ``VisualDetailFragment``, there is no ``source_url`` — it represents
    the consensus of all accepted sources.
    """

    lighting: list[str] = Field(default_factory=list)
    materials: list[str] = Field(default_factory=list)
    color_palette: list[str] = Field(default_factory=list)
    architecture: list[str] = Field(default_factory=list)
    clothing: list[str] = Field(default_factory=list)
    atmosphere: list[str] = Field(default_factory=list)
    era_markers: list[str] = Field(default_factory=list)
    subjects: list[str] = Field(
        default_factory=list,
        description="Merged subject descriptions across all accepted sources.",
    )
    compositional_notes: list[str] = Field(
        default_factory=list,
        description="Merged compositional arrangement notes.",
    )


class VisualDetailManifest(BaseModel):
    """The final output of the Phase IV micro-pipeline for one documentary scene.

    Written to Firestore at ``/sessions/{sessionId}/visualManifests/{sceneId}``
    and stored in ``session.state["visual_research_manifest"][scene_id]`` for
    the Visual Director (Phase V) to consume.
    """

    scene_id: str = Field(..., description="Matching SceneBrief scene_id.")
    segment_id: str = Field(..., description="Matching SegmentScript id.")
    enriched_prompt: str = Field(
        ...,
        description=(
            "200–400 word Imagen 3 prompt synthesised from all accepted sources. "
            "The Visual Director uses this as the primary generation prompt."
        ),
    )
    detail_fields: MergedVisualDetail = Field(
        ...,
        description="Merged and deduplicated visual detail fields from all fragments.",
    )
    sources_accepted: int = Field(..., description="Number of sources that passed evaluation.")
    sources_rejected: int = Field(..., description="Number of sources that were rejected.")
    reference_sources: list[EvaluatedSource] = Field(
        default_factory=list,
        description="Full audit trail of every evaluated source (accepted and rejected).",
    )
    negative_prompt: str = Field(
        default="",
        description="Pre-built negative prompt string for Imagen 3, derived from era_markers and period-specific exclusions.",
    )


# ---------------------------------------------------------------------------
# Deferred annotation resolution
# ---------------------------------------------------------------------------

EvaluatedSource.model_rebuild()
VisualDetailFragment.model_rebuild()
MergedVisualDetail.model_rebuild()
VisualDetailManifest.model_rebuild()
