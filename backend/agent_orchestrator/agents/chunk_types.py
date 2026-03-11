"""Phase I data-type contracts for the Document Analysis pipeline.

This module defines the Pydantic v2 models that flow through the first stage
of the AI Historian pipeline: document chunking, summarisation, scene planning,
and the ``DocumentMap`` that downstream agents (Script Agent, Visual Director)
consume.

Every model is designed for dual use:
  1. **In-memory** — passed between ADK agents via ``session.state``.
  2. **Firestore** — serialised to the ``/sessions/{id}/chunks`` and
     ``/sessions/{id}/scenes`` sub-collections.

All fields carry ``Field(description=...)`` metadata so that auto-generated
OpenAPI schemas (FastAPI) and Firestore documentation stay in sync with the
source of truth here.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

# ---------------------------------------------------------------------------
# Type aliases
# ---------------------------------------------------------------------------

NarrativeRole = Literal["opening", "rising_action", "climax", "resolution", "coda"]
"""Dramatic arc position that the scene occupies in the documentary structure."""


# ---------------------------------------------------------------------------
# ChunkRecord
# ---------------------------------------------------------------------------


class ChunkRecord(BaseModel):
    """A contiguous slice of the source document produced by the chunker.

    Each chunk maps to one or more PDF pages and carries the verbatim OCR
    text plus an optional heading (detected from font-size heuristics or
    structural cues) and a downstream-added summary.

    ``char_count`` is auto-computed from ``raw_text`` when left at its
    default value of ``0``, ensuring the field is always accurate even if
    the caller omits it.
    """

    chunk_id: str = Field(
        ...,
        description='Unique identifier within the session, e.g. "chunk_003".',
    )
    session_id: str = Field(
        ...,
        description="Parent session this chunk belongs to.",
    )
    sequence: int = Field(
        ...,
        description="Zero-indexed position of this chunk in document order.",
    )
    page_start: int = Field(
        ...,
        description="First page (1-indexed) that this chunk spans.",
    )
    page_end: int = Field(
        ...,
        description="Last page (1-indexed, inclusive) that this chunk spans.",
    )
    raw_text: str = Field(
        ...,
        description="Verbatim OCR text for this chunk (whitespace-normalised).",
    )
    char_count: int = Field(
        default=0,
        description=(
            "Character length of raw_text.  Auto-computed from raw_text "
            "when the caller supplies 0 or omits the field."
        ),
    )
    heading: str | None = Field(
        default=None,
        description="Detected section heading from the document, kept verbatim.",
    )
    summary: str | None = Field(
        default=None,
        description=(
            "One-paragraph summary added by the Chunk Summarizer agent.  "
            "None until that agent has processed this chunk."
        ),
    )

    @model_validator(mode="after")
    def _auto_compute_char_count(self) -> ChunkRecord:
        """Ensure ``char_count`` always reflects the actual text length."""
        if self.char_count == 0 and self.raw_text:
            self.char_count = len(self.raw_text)
        return self


# ---------------------------------------------------------------------------
# SceneBrief
# ---------------------------------------------------------------------------


class SceneBrief(BaseModel):
    """A planned documentary scene derived from one or more document chunks.

    The Scene Planner agent produces these after the Chunk Summarizer has
    annotated every ``ChunkRecord``.  Each brief tells the Script Agent
    *what* to write and the Visual Director *what* to depict, without
    prescribing exact dialogue or shot composition.
    """

    scene_id: str = Field(
        ...,
        description='Unique scene identifier, e.g. "scene_002".',
    )
    title: str = Field(
        ...,
        description="Working title for the scene (may be refined by Script Agent).",
    )
    document_excerpt: str = Field(
        ...,
        description="Verbatim key passage from the source document that anchors this scene.",
    )
    source_chunk_ids: list[str] = Field(
        ...,
        description="IDs of the ChunkRecords containing relevant material for this scene.",
    )
    era: str = Field(
        ...,
        description="Time period the scene depicts, as specific as the document allows.",
    )
    location: str = Field(
        ...,
        description="Geographic setting for the scene.",
    )
    key_entities: list[str] = Field(
        ...,
        description="People, objects, or events central to this scene.",
    )
    narrative_role: NarrativeRole = Field(
        ...,
        description="Position of this scene in the documentary's dramatic arc.",
    )
    cinematic_hook: str = Field(
        ...,
        description="One sentence explaining why this scene works visually.",
    )
    mood: str = Field(
        ...,
        description="Emotional register of the scene (e.g. 'solemn', 'triumphant').",
    )
    source_language: str | None = Field(
        default=None,
        description=(
            "ISO 639 language code or descriptive name of the document's original "
            "language/script (e.g. 'ar', 'el', 'Latin', 'Ottoman Turkish'). "
            "None when the document is in English or language is indeterminate."
        ),
    )


# ---------------------------------------------------------------------------
# DocumentMap
# ---------------------------------------------------------------------------


class DocumentMap(BaseModel):
    """Aggregate view of the fully chunked and summarised document.

    Built once all ``ChunkRecord`` summaries are populated and passed to
    the Scene Planner as its primary input.  The ``combined_text`` field
    concatenates chunk summaries in sequence order so that downstream
    agents receive a coherent narrative without needing to reassemble
    chunks themselves.
    """

    session_id: str = Field(
        ...,
        description="Session that owns this document map.",
    )
    total_chunks: int = Field(
        ...,
        description="Number of chunks the document was split into.",
    )
    combined_text: str = Field(
        ...,
        description="All chunk summaries concatenated in sequence order.",
    )
    chunks: list[ChunkRecord] = Field(
        ...,
        description="Ordered list of every chunk in the document.",
    )


# ---------------------------------------------------------------------------
# Deferred annotation resolution
# ---------------------------------------------------------------------------
# ``from __future__ import annotations`` turns all annotations into strings.
# Pydantic needs an explicit rebuild so that type aliases (NarrativeRole) and
# forward references (ChunkRecord inside DocumentMap) are resolved at import
# time rather than failing on first instantiation.
# ---------------------------------------------------------------------------

ChunkRecord.model_rebuild()
SceneBrief.model_rebuild()
DocumentMap.model_rebuild()
