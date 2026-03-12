# Live Historian RAG Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Give the live Historian persona semantic access to the actual document content by embedding chunk summaries during Phase I and injecting the most relevant passages at query time via Firestore vector search.

**Architecture:** During Phase I (`document_analyzer.py`), after chunks are written to Firestore, their summaries are batch-embedded with `gemini-embedding-2-preview` and stored as `Vector(768)` fields on each chunk document — as a background `asyncio.Task` so Phase II is not delayed. A new FastAPI endpoint (`POST /api/session/{id}/retrieve`) embeds an incoming query and calls `find_nearest()` against the session's chunks subcollection. The live-relay intercepts every `inputTranscript` event from Gemini Live and calls the retrieve endpoint (1.5 s timeout, best-effort), then injects the top-4 returned passages upstream as a `clientContent` turn before the historian's audio response arrives.

**Tech Stack:** `google-genai` (embed_content async), `google-cloud-firestore` v2.19+ (Vector + find_nearest), FastAPI, Node.js 20 built-in `fetch`

---

## Pre-requisite: Firestore Vector Index

Run this **once** before any code changes. Index provisioning takes 5–15 minutes.

```bash
gcloud firestore indexes composite create \
  --collection-group=chunks \
  --query-scope=COLLECTION \
  --field-config field-path=embedding,vector-config='{"dimension":"768","flat":"{}"}' \
  --database="(default)" \
  --project=$GCP_PROJECT_ID
```

Monitor until green: `gcloud firestore indexes composite list --database="(default)"`

---

## Task 1: Extend ChunkRecord with Optional Embedding Field

**Files:**
- Modify: `backend/agent_orchestrator/agents/chunk_types.py:37-97`

**Step 1: Add the field**

After the existing `summary` field in `ChunkRecord`, add:

```python
embedding: list[float] | None = Field(
    default=None,
    description="gemini-embedding-2-preview vector (768 dims). None until embedding step completes.",
    exclude=True,  # Never serialised to Firestore via model_dump() — written separately as VectorValue
)
```

The `exclude=True` is critical: `_write_chunks_to_firestore` calls `chunk.model_dump()` via `batch.set()`. Without this, it would try to write a plain Python list to Firestore instead of a `Vector` type, and the index would not recognise it.

**Step 2: Verify no existing tests break**

```bash
cd backend
python -m pytest agent_orchestrator/ -x -q 2>&1 | head -40
```

Expected: all pass (field is optional with default=None, nothing changes for callers that don't set it).

**Step 3: Commit**

```bash
git add backend/agent_orchestrator/agents/chunk_types.py
git commit -m "feat(rag): add optional embedding field to ChunkRecord"
```

---

## Task 2: Embedding Helper Functions in document_analyzer.py

**Files:**
- Modify: `backend/agent_orchestrator/agents/document_analyzer.py`

Add three functions after the existing `_write_scene_briefs_to_firestore` function (around line 487). They must be module-level async functions, not methods.

**Step 1: Add `_embed_chunk_summaries`**

```python
async def _embed_chunk_summaries(
    chunks: list[ChunkRecord],
    genai_client: genai.Client,
    semaphore: asyncio.Semaphore,
) -> list[ChunkRecord]:
    """Embed each chunk's summary (or raw_text[:2000] fallback) using
    gemini-embedding-2-preview at 768 dimensions.

    Returns a new list of ChunkRecord instances with the ``embedding`` field
    populated. Failures on individual chunks are logged and skipped (embedding
    stays None) so a single bad chunk never aborts the whole batch.
    """
    from google.genai import types as genai_types  # local import — already a dep

    async def _one(chunk: ChunkRecord) -> ChunkRecord:
        async with semaphore:
            text = chunk.summary or chunk.raw_text[:2000]
            try:
                resp = await genai_client.aio.models.embed_content(
                    model="gemini-embedding-2-preview",
                    contents=text,
                    config=genai_types.EmbedContentConfig(
                        task_type="RETRIEVAL_DOCUMENT",
                        output_dimensionality=768,
                    ),
                )
                return chunk.model_copy(update={"embedding": resp.embeddings[0].values})
            except Exception as exc:  # noqa: BLE001
                logger.warning("Embedding failed for chunk %s: %s", chunk.chunk_id, exc)
                return chunk

    return list(await asyncio.gather(*[_one(c) for c in chunks]))
```

**Step 2: Add `_write_embeddings_to_firestore`**

```python
async def _write_embeddings_to_firestore(
    db: firestore.AsyncClient,
    chunks: list[ChunkRecord],
) -> None:
    """Write the ``embedding`` VectorValue field to existing chunk documents.

    Uses ``batch.update()`` (not set) so it merges with the already-written
    chunk fields rather than overwriting them.
    """
    from google.cloud.firestore_v1.vector import Vector  # type: ignore[import]

    to_write = [c for c in chunks if c.embedding is not None]
    if not to_write:
        logger.warning("No embeddings to write — all chunks failed embedding step")
        return

    batch = db.batch()
    for chunk in to_write:
        ref = (
            db.collection("sessions")
            .document(chunk.session_id)
            .collection("chunks")
            .document(chunk.chunk_id)
        )
        batch.update(ref, {"embedding": Vector(chunk.embedding)})
    await batch.commit()
    logger.info("Wrote embeddings for %d/%d chunks", len(to_write), len(chunks))
```

**Step 3: Add `_embed_and_write_background`**

```python
async def _embed_and_write_background(
    db: firestore.AsyncClient,
    chunks: list[ChunkRecord],
    genai_client: genai.Client,
) -> None:
    """Fire-and-forget coroutine: embed chunks then persist vectors.

    Designed to run as an asyncio.Task so it does not block Phase II from
    starting. Errors are caught and logged — never propagated.
    """
    try:
        sem = asyncio.Semaphore(10)
        chunks_with_embeddings = await _embed_chunk_summaries(chunks, genai_client, sem)
        await _write_embeddings_to_firestore(db, chunks_with_embeddings)
        logger.info("Background embedding complete for session %s", chunks[0].session_id if chunks else "unknown")
    except Exception as exc:  # noqa: BLE001
        logger.error("Background embedding task failed: %s", exc, exc_info=True)
```

**Step 4: Wire it into `_run_async_impl`**

In `_run_async_impl`, locate line 772 (`await _write_chunks_to_firestore(db, chunks_with_summaries)`). Immediately after that line add:

```python
# Embed chunk summaries in the background — does not block Phase II.
# Vectors will be ready in Firestore before the user opens the live session.
_embed_task = asyncio.create_task(
    _embed_and_write_background(db, chunks_with_summaries, self.genai_client)
)
# Keep reference so GC doesn't cancel it
ctx.session.state["_embedding_task_ref"] = id(_embed_task)
```

`self.genai_client` is the existing `genai.Client` instance already on the agent. Verify the attribute name in the `DocumentAnalyzerAgent.__init__` — it may be `self._client` or `self.client`. Use whichever exists.

**Step 5: Verify Phase I still runs end-to-end**

```bash
cd backend
python -m pytest agent_orchestrator/ -x -q 2>&1 | head -40
```

Expected: all pass. The background task starts but fires into a no-op since Firestore is not live in tests.

**Step 6: Commit**

```bash
git add backend/agent_orchestrator/agents/document_analyzer.py
git commit -m "feat(rag): embed chunk summaries in background after Phase I writes"
```

---

## Task 3: Add Retrieve Models to models.py

**Files:**
- Modify: `backend/historian_api/models.py:95` (append after `GroundingSourcesResponse`)

**Step 1: Append the three models**

```python
# ── RAG Retrieval ──────────────────────────────────────────────

class RetrieveRequest(BaseModel):
    query: str
    top_k: int = 4


class RetrievedChunk(BaseModel):
    chunk_id: str
    text: str
    summary: str | None = None
    score: float
    page_start: int
    page_end: int
    heading: str | None = None


class RetrieveResponse(BaseModel):
    chunks: list[RetrievedChunk]
    query: str
```

**Step 2: Verify import is clean**

```bash
cd backend/historian_api
python -c "from models import RetrieveRequest, RetrievedChunk, RetrieveResponse; print('ok')"
```

Expected: `ok`

**Step 3: Commit**

```bash
git add backend/historian_api/models.py
git commit -m "feat(rag): add RetrieveRequest/RetrievedChunk/RetrieveResponse models"
```

---

## Task 4: Create the /retrieve FastAPI Endpoint

**Files:**
- Create: `backend/historian_api/routes/retrieve.py`

**Step 1: Create the file**

```python
"""RAG retrieval endpoint for the Live Historian persona.

POST /api/session/{session_id}/retrieve
    Body:    RetrieveRequest  { query: str, top_k: int = 4 }
    Returns: RetrieveResponse { chunks: [...], query: str }

Embeds the query with gemini-embedding-2-preview (768 dims, RETRIEVAL_QUERY
task type) then calls Firestore find_nearest() against the session's chunks
subcollection. Returns top_k chunks ranked by cosine distance.

All errors return an empty chunks list — never a 500 — because this endpoint
is called on the hot path of the live voice session.
"""
from __future__ import annotations

import logging
import os

from fastapi import APIRouter, HTTPException
from google import genai
from google.genai import types as genai_types
from google.cloud import firestore
from google.cloud.firestore_v1.vector import Vector  # type: ignore[import]
from google.cloud.firestore_v1.base_vector_query import DistanceMeasure  # type: ignore[import]

from ..models import RetrieveRequest, RetrieveResponse, RetrievedChunk

router = APIRouter()
logger = logging.getLogger(__name__)

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
            limit=body.top_k,
            distance_result_field="distance",
        )

        # 3. Stream and map results
        chunks: list[RetrievedChunk] = []
        async for doc in vector_query.stream():
            d = doc.to_dict()
            chunks.append(
                RetrievedChunk(
                    chunk_id=doc.id,
                    text=d.get("raw_text", ""),
                    summary=d.get("summary"),
                    score=1.0 - float(d.get("distance", 0.5)),
                    page_start=d.get("page_start", 0),
                    page_end=d.get("page_end", 0),
                    heading=d.get("heading"),
                )
            )

        return RetrieveResponse(chunks=chunks, query=body.query)

    except Exception as exc:  # noqa: BLE001
        # Never 500 on the hot path — return empty list so the historian
        # still answers from its existing session context.
        logger.error("retrieve_chunks failed for session=%s: %s", session_id, exc, exc_info=True)
        return RetrieveResponse(chunks=[], query=body.query)
```

**Step 2: Mount the router in main.py**

In `backend/historian_api/main.py`, add after the existing router imports (line 13):

```python
from .routes import retrieve as retrieve_router
```

And after the existing `app.include_router` calls (line 29):

```python
app.include_router(retrieve_router.router, prefix="/api")
```

**Step 3: Smoke test the endpoint locally**

```bash
cd backend/historian_api
uvicorn main:app --port 8001 --reload &
# In another terminal:
curl -s -X POST http://localhost:8001/api/session/test-session-id/retrieve \
  -H "Content-Type: application/json" \
  -d '{"query": "who wrote this document", "top_k": 3}' | python3 -m json.tool
```

Expected: `{"chunks": [], "query": "who wrote this document"}` (empty because test-session-id has no chunks — but no 500).

**Step 4: Commit**

```bash
git add backend/historian_api/routes/retrieve.py backend/historian_api/main.py
git commit -m "feat(rag): add POST /api/session/{id}/retrieve endpoint"
```

---

## Task 5: Inject Retrieved Context in live-relay

**Files:**
- Modify: `backend/live_relay/server.js`

**Step 1: Add HISTORIAN_API_URL constant**

After the existing constants block (after line 45, after `CONTEXT_TTL_MS`), add:

```javascript
/** Base URL of the historian-api Cloud Run service. */
const HISTORIAN_API_URL = process.env.HISTORIAN_API_URL || 'http://localhost:8000';
```

**Step 2: Add `retrieveContext` function**

Add this module-level async function after the `systemInstructionCache` section (after the `setInterval` prune block, around line 115):

```javascript
/**
 * Call the historian-api /retrieve endpoint to get semantically relevant
 * document chunks for the given user query.
 *
 * Returns a formatted string ready for injection into Gemini Live, or an
 * empty string on any error (best-effort, never throws).
 *
 * @param {string} sessionId
 * @param {string} query  The user's speech transcript.
 * @returns {Promise<string>}
 */
async function retrieveContext(sessionId, query) {
  try {
    const res = await fetch(
      `${HISTORIAN_API_URL}/api/session/${sessionId}/retrieve`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, top_k: 4 }),
        signal: AbortSignal.timeout(1500),  // never block the voice path > 1.5s
      }
    );
    if (!res.ok) return '';
    const { chunks } = await res.json();
    if (!chunks || chunks.length === 0) return '';

    return chunks
      .map(c => {
        const pages = c.page_end > c.page_start
          ? `p.${c.page_start}–${c.page_end}`
          : `p.${c.page_start}`;
        const body = c.summary || c.text.slice(0, 400);
        return `[Document ${pages}] ${body}`;
      })
      .join('\n');
  } catch {
    // Timeout, network error, JSON parse — all silently ignored.
    return '';
  }
}
```

**Step 3: Inject context on inputTranscript**

Find the existing `inputTranscript` handler block in `server.js` (lines 296–302):

```javascript
// Input transcript (user speech -> text) -- used for branch trigger detection
if (msg.serverContent?.inputTranscript?.text) {
  clientWs.send(JSON.stringify({
    type: 'transcript',
    text: msg.serverContent.inputTranscript.text,
  }));
}
```

Replace it with:

```javascript
// Input transcript (user speech -> text)
if (msg.serverContent?.inputTranscript?.text) {
  const transcript = msg.serverContent.inputTranscript.text;

  // Always forward transcript to the frontend (branch detection, captions).
  clientWs.send(JSON.stringify({ type: 'transcript', text: transcript }));

  // RAG injection: for substantive questions (>15 chars), retrieve relevant
  // document passages and inject them upstream before the historian responds.
  if (transcript.length > 15 && geminiWs.readyState === WebSocket.OPEN) {
    retrieveContext(sessionId, transcript).then(contextText => {
      if (!contextText || geminiWs.readyState !== WebSocket.OPEN) return;
      geminiWs.send(JSON.stringify({
        clientContent: {
          turns: [{
            role: 'user',
            parts: [{ text: `[Retrieved source context — use to answer the question]\n${contextText}` }],
          }],
          turnComplete: false,
        },
      }));
    }).catch(() => { /* silently ignore */ });
  }
}
```

**Step 4: Add HISTORIAN_API_URL to environment docs**

At the top of `server.js` in the environment variables comment block (lines 17–22), add:

```javascript
//   HISTORIAN_API_URL - historian-api base URL (default: http://localhost:8000)
```

**Step 5: Test locally with both services running**

```bash
# Terminal 1: historian-api
cd backend/historian_api && uvicorn main:app --port 8000

# Terminal 2: live-relay
cd backend/live_relay && HISTORIAN_API_URL=http://localhost:8000 node server.js
```

Open the browser, speak a question after a documentary has loaded. Check that:
- `type: 'transcript'` message arrives in browser WebSocket
- Terminal 1 shows a POST to `/api/session/.../retrieve`
- No errors in either terminal

**Step 6: Commit**

```bash
git add backend/live_relay/server.js
git commit -m "feat(rag): inject retrieved document context into Gemini Live on user speech"
```

---

## Task 6: Update requirements.txt

**Files:**
- Modify: `backend/historian_api/requirements.txt`

**Step 1: Bump Firestore version**

Find the `google-cloud-firestore` line and ensure it reads:

```
google-cloud-firestore>=2.19.0
```

Version 2.19+ guarantees `VectorValue` and `find_nearest` support. Check the current pinned version first:

```bash
grep firestore backend/historian_api/requirements.txt
grep firestore backend/agent_orchestrator/requirements.txt
```

Bump both files if the agent_orchestrator also has a pinned version below 2.19.

**Step 2: Commit**

```bash
git add backend/historian_api/requirements.txt backend/agent_orchestrator/requirements.txt
git commit -m "chore: bump google-cloud-firestore>=2.19.0 for vector search support"
```

---

## Task 7: Add HISTORIAN_API_URL to Terraform (Bonus +0.2)

**Files:**
- Modify: `terraform/main.tf`

**Step 1: Find the live-relay Cloud Run service resource**

Look for `resource "google_cloud_run_service" "live_relay"` or similar in `terraform/main.tf`.

**Step 2: Add the env var**

In the `env` block of the live-relay container spec, add:

```hcl
env {
  name  = "HISTORIAN_API_URL"
  value = "https://${google_cloud_run_service.historian_api.status[0].url}"
}
```

This wires the live-relay to the historian-api's Cloud Run URL automatically after `terraform apply`.

**Step 3: Commit**

```bash
git add terraform/main.tf
git commit -m "infra: wire HISTORIAN_API_URL from historian-api Cloud Run URL to live-relay"
```

---

## End-to-End Verification

After all tasks are complete, run a full session and verify:

1. **Phase I completes** → check Firestore: `/sessions/{id}/chunks/{id}` documents should have an `embedding` array of length 768
2. **Index is ready** → `gcloud firestore indexes composite list` shows green
3. **Retrieve endpoint works** → `POST /api/session/{real-session-id}/retrieve` with a real question returns non-empty chunks
4. **Live historian grounded** → speak "what does the document say about..." mid-documentary → historian cites actual document pages, not just narration script generalisations

---

## What This Unlocks

| User question | Before | After |
|---|---|---|
| "What exact date is mentioned?" | Historian guesses from narration | Historian cites page and verbatim text |
| "What language is this written in?" | Uses `language` field only | Can quote actual OCR passages |
| "Tell me more about the part on trade" | Limited to scripted scenes | Retrieves the exact trade-route chunks |
| Judge sees | Historian answers from scripts | Historian answers from the actual document |

The injection is **best-effort** at every step: the background embed task cannot crash Phase II, the retrieve endpoint never returns 500, and the relay silently skips injection on timeout. If anything fails, the historian still responds from its existing session context.
