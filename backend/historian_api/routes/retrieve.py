"""RAG retrieval endpoint for the Live Historian persona.

POST /api/session/{session_id}/retrieve
    Body:    RetrieveRequest  { query: str, top_k: int = 4 }
    Returns: RetrieveResponse { chunks: [...], query: str }

Embeds the query with gemini-embedding-2-preview (768 dims, RETRIEVAL_QUERY
task type) then calls Firestore find_nearest() against the session's chunks
subcollection. Returns top_k chunks ranked by cosine distance.

All errors return an empty chunks list -- never a 500 -- because this endpoint
is called on the hot path of the live voice session.
"""
from __future__ import annotations

import logging
import os

from fastapi import APIRouter
from google import genai
from google.genai import types as genai_types
from google.cloud import firestore
from google.cloud.firestore_v1.vector import Vector  # type: ignore[import]
from google.cloud.firestore_v1.base_vector_query import DistanceMeasure  # type: ignore[import]

from ..models import RetrieveRequest, RetrieveResponse, RetrievedChunk

router = APIRouter()
logger = logging.getLogger(__name__)

_MIN_RELEVANCE_SCORE = 0.5
"""Minimum cosine similarity score to include a chunk. Filters noise."""

# ---------------------------------------------------------------------------
# Lazy singletons (same pattern as session.py and pipeline.py)
# ---------------------------------------------------------------------------

_db: firestore.AsyncClient | None = None
_genai_client: genai.Client | None = None


def _get_db() -> firestore.AsyncClient:
    global _db
    if _db is None:
        project = os.environ["GCP_PROJECT_ID"]
        _db = firestore.AsyncClient(project=project)
    return _db


def _get_client() -> genai.Client:
    global _genai_client
    if _genai_client is None:
        project = os.environ["GCP_PROJECT_ID"]
        _genai_client = genai.Client(vertexai=True, project=project, location="us-central1")
    return _genai_client


# ---------------------------------------------------------------------------
# Route
# ---------------------------------------------------------------------------


@router.post("/session/{session_id}/retrieve", response_model=RetrieveResponse)
async def retrieve_chunks(
    session_id: str,
    body: RetrieveRequest,
) -> RetrieveResponse:
    """Return the top-K document chunks most semantically relevant to the query.

    Used by the live-relay to ground the Historian persona's answers in the
    actual source document rather than only the generated narration scripts.
    """
    try:
        # 1. Embed the query
        resp = await _get_client().aio.models.embed_content(
            model="gemini-embedding-2-preview",
            contents=body.query,
            config=genai_types.EmbedContentConfig(
                task_type="RETRIEVAL_QUERY",
                output_dimensionality=768,
            ),
        )
        query_vec = resp.embeddings[0].values

        # 2. Vector search in this session's chunks subcollection
        chunks_ref = (
            _get_db()
            .collection("sessions")
            .document(session_id)
            .collection("chunks")
        )
        vector_query = chunks_ref.find_nearest(
            vector_field="embedding",
            query_vector=Vector(query_vec),
            distance_measure=DistanceMeasure.COSINE,
            limit=min(body.top_k, 10),  # defense-in-depth clamp
            distance_result_field="distance",
        )

        # 3. Stream and map results
        chunks: list[RetrievedChunk] = []
        async for doc in vector_query.stream():
            d = doc.to_dict()
            score = 1.0 - float(d.get("distance", 0.5))
            if score < _MIN_RELEVANCE_SCORE:
                continue
            chunks.append(
                RetrievedChunk(
                    chunk_id=doc.id,
                    text=d.get("raw_text", ""),
                    summary=d.get("summary"),
                    score=score,
                    page_start=d.get("page_start", 0),
                    page_end=d.get("page_end", 0),
                    heading=d.get("heading"),
                )
            )

        return RetrieveResponse(chunks=chunks, query=body.query)

    except Exception as exc:  # noqa: BLE001
        # Never 500 on the hot path -- return empty list so the historian
        # still answers from its existing session context.
        logger.error("retrieve_chunks failed for session=%s: %s", session_id, exc, exc_info=True)
        return RetrieveResponse(chunks=[], query=body.query)
