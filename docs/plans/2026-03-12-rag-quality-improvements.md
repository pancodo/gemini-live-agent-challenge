# RAG Quality Improvements Plan

> **For Claude:** Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Harden and improve the Live Historian RAG implementation across 6 concrete areas. No architecture changes — targeted fixes to make it production-grade.

---

## Pre-requisite: Branch

```bash
git checkout feat/live-historian-rag
# or create new branch from main:
git checkout main && git checkout -b feat/rag-quality
```

---

## Task 1: Batch Embedding in document_analyzer.py

**File:** `backend/agent_orchestrator/agents/document_analyzer.py`

**Problem:** `_embed_chunk_summaries` makes one API call per chunk. 10 chunks = 10 round trips. The batch API supports 250 texts per call.

**Step 1: Add `_chunked` utility and `T` TypeVar near imports (top of file)**

Find the imports block and add (if not already present):
```python
from typing import Iterator, TypeVar
T = TypeVar("T")
```

Add the helper function before `_write_chunks_to_firestore` (around line 440):
```python
def _chunked(lst: list, size: int) -> Iterator[list]:
    """Yield successive sublists of length ``size``."""
    for i in range(0, len(lst), size):
        yield lst[i : i + size]
```

**Step 2: Replace `_embed_chunk_summaries` entirely**

Replace the full function body with the batch implementation:

```python
async def _embed_chunk_summaries(
    chunks: list[ChunkRecord],
    genai_client: google_genai.Client,
    semaphore: asyncio.Semaphore,  # kept for call-site compatibility; unused
) -> list[ChunkRecord]:
    """Embed chunk summaries in batches of 250 using gemini-embedding-2-preview.

    Runs all batches concurrently. Returns chunks with ``embedding`` populated.
    Failed batches leave affected chunks with ``embedding=None`` (skipped silently).
    """
    from google.genai import types as genai_types

    _MAX_BATCH = 250

    # Tag each chunk with its index so results can be aligned after batching
    indexed: list[tuple[int, str]] = [
        (i, c.summary or c.raw_text[:2000]) for i, c in enumerate(chunks)
    ]

    if not indexed:
        return chunks

    batches = list(_chunked(indexed, _MAX_BATCH))
    logger.info("Embedding %d chunks in %d batch(es)", len(chunks), len(batches))

    async def _embed_batch(batch: list[tuple[int, str]]) -> list[tuple[int, list[float]]]:
        indices, texts = zip(*batch)
        try:
            resp = await genai_client.aio.models.embed_content(
                model="gemini-embedding-2-preview",
                contents=list(texts),
                config=genai_types.EmbedContentConfig(
                    task_type="RETRIEVAL_DOCUMENT",
                    output_dimensionality=768,
                ),
            )
            return [(idx, emb.values) for idx, emb in zip(indices, resp.embeddings)]
        except Exception as exc:  # noqa: BLE001
            logger.warning("Batch embedding failed (%d chunks): %s", len(batch), exc)
            return []

    all_results = await asyncio.gather(*[_embed_batch(b) for b in batches])
    embedding_map: dict[int, list[float]] = {idx: vec for batch in all_results for idx, vec in batch}

    updated = [
        c.model_copy(update={"embedding": embedding_map.get(i)})
        for i, c in enumerate(chunks)
    ]
    successful = sum(1 for c in updated if c.embedding is not None)
    logger.info("Embedded %d/%d chunks successfully", successful, len(chunks))
    return updated
```

**Step 3: Verify**
```bash
cd /Users/efecelik/gemini-live-hackathon-idea/backend
python -c "from agent_orchestrator.agents.document_analyzer import _embed_chunk_summaries; print('ok')"
```

**Step 4: Commit**
```bash
git add backend/agent_orchestrator/agents/document_analyzer.py
git commit -m "perf(rag): batch chunk embedding — N API calls → ⌈N/250⌉ concurrent calls"
```

---

## Task 2: Firestore Batch Size Guarding

**File:** `backend/agent_orchestrator/agents/document_analyzer.py`

**Problem:** Both `_write_chunks_to_firestore` and `_write_embeddings_to_firestore` put all ops in one batch. Firestore hard limit is 500. A 600-page document produces ~468 chunks — dangerously close.

**Step 1: Update `_write_chunks_to_firestore`**

Replace the body with:
```python
async def _write_chunks_to_firestore(
    db: firestore.AsyncClient,
    chunks: list[ChunkRecord],
) -> None:
    """Persist chunks to Firestore in batches of 500 (Firestore limit)."""
    batches = list(_chunked(chunks, 500))
    if not batches:
        return
    if len(batches) == 1:
        batch = db.batch()
        for chunk in batches[0]:
            ref = (
                db.collection("sessions")
                .document(chunk.session_id)
                .collection("chunks")
                .document(chunk.chunk_id)
            )
            batch.set(ref, chunk.model_dump())
        await batch.commit()
        logger.info("Wrote %d chunks to Firestore (1 batch)", len(chunks))
    else:
        t0 = time.monotonic()
        for i, batch_chunks in enumerate(batches, 1):
            batch = db.batch()
            for chunk in batch_chunks:
                ref = (
                    db.collection("sessions")
                    .document(chunk.session_id)
                    .collection("chunks")
                    .document(chunk.chunk_id)
                )
                batch.set(ref, chunk.model_dump())
            await batch.commit()
            logger.info("Chunk batch %d/%d committed (%d ops)", i, len(batches), len(batch_chunks))
        logger.info("Wrote %d chunks in %d batches (%.2fs)", len(chunks), len(batches), time.monotonic() - t0)
```

**Step 2: Update `_write_embeddings_to_firestore`**

Replace the body (after the `to_write` filter) with the same pattern, using `batch.update` instead of `batch.set`:
```python
async def _write_embeddings_to_firestore(
    db: firestore.AsyncClient,
    chunks: list[ChunkRecord],
) -> None:
    """Write Vector embeddings to Firestore in batches of 500."""
    from google.cloud.firestore_v1.vector import Vector  # type: ignore[import]

    to_write = [c for c in chunks if c.embedding is not None]
    if not to_write:
        logger.warning("No embeddings to write — all chunks failed embedding step")
        return

    batches = list(_chunked(to_write, 500))
    if len(batches) == 1:
        batch = db.batch()
        for chunk in batches[0]:
            ref = (
                db.collection("sessions")
                .document(chunk.session_id)
                .collection("chunks")
                .document(chunk.chunk_id)
            )
            batch.update(ref, {"embedding": Vector(chunk.embedding)})
        await batch.commit()
        logger.info("Wrote embeddings for %d/%d chunks (1 batch)", len(to_write), len(chunks))
    else:
        t0 = time.monotonic()
        for i, batch_chunks in enumerate(batches, 1):
            batch = db.batch()
            for chunk in batch_chunks:
                ref = (
                    db.collection("sessions")
                    .document(chunk.session_id)
                    .collection("chunks")
                    .document(chunk.chunk_id)
                )
                batch.update(ref, {"embedding": Vector(chunk.embedding)})
            await batch.commit()
            logger.info("Embedding batch %d/%d committed (%d ops)", i, len(batches), len(batch_chunks))
        logger.info("Wrote embeddings for %d/%d chunks in %d batches (%.2fs)",
                    len(to_write), len(chunks), len(batches), time.monotonic() - t0)
```

**Step 3: Verify**
```bash
cd /Users/efecelik/gemini-live-hackathon-idea/backend
python -c "from agent_orchestrator.agents.document_analyzer import _write_embeddings_to_firestore; print('ok')"
```

**Step 4: Commit**
```bash
git add backend/agent_orchestrator/agents/document_analyzer.py
git commit -m "fix(rag): guard Firestore batch writes at 500-op limit for long documents"
```

---

## Task 3: Score Threshold + top_k Validation in retrieve endpoint

**Files:**
- `backend/historian_api/models.py`
- `backend/historian_api/routes/retrieve.py`

**Step 1: Add `Field` to RetrieveRequest in models.py**

Change:
```python
from pydantic import BaseModel
```
To:
```python
from pydantic import BaseModel, Field
```

Change `RetrieveRequest`:
```python
class RetrieveRequest(BaseModel):
    query: str
    top_k: int = Field(default=4, ge=1, le=10)
```

**Step 2: Add score threshold constant to retrieve.py**

After `logger = logging.getLogger(__name__)` add:
```python
_MIN_RELEVANCE_SCORE = 0.5
"""Minimum cosine similarity score to include a chunk. Filters noise."""
```

**Step 3: Add server-side clamp and score filter in `retrieve_chunks`**

In the `find_nearest` call, change `limit=body.top_k` to:
```python
limit=min(body.top_k, 10),  # defense-in-depth clamp
```

In the streaming loop, replace the `chunks.append(...)` block with:
```python
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
```

**Step 4: Verify**
```bash
cd /Users/efecelik/gemini-live-hackathon-idea/backend/historian_api
python -c "from models import RetrieveRequest; r = RetrieveRequest(query='test'); print(r.top_k); print('ok')"
```

**Step 5: Commit**
```bash
git add backend/historian_api/models.py backend/historian_api/routes/retrieve.py
git commit -m "fix(rag): filter low-relevance chunks (score<0.5) and clamp top_k≤10"
```

---

## Task 4: Startup Warmup in main.py

**File:** `backend/historian_api/main.py`

**Problem:** Lazy singletons in `retrieve.py` add ~200ms to the first voice request after Cloud Run cold start.

**Step 1: Add lifespan to main.py**

Replace the entire file with:
```python
"""FastAPI application entry point for historian_api."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routes import session as session_router
from .routes import pipeline as pipeline_router
from .routes import retrieve as retrieve_router

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Warm up lazy singletons before first request."""
    try:
        retrieve_router._get_db()
        retrieve_router._get_client()
        logger.info("Startup: retrieve singletons warmed up")
    except Exception as exc:
        logger.warning("Startup warmup failed (non-fatal): %s", exc)
    yield


app = FastAPI(title="AI Historian API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(session_router.router, prefix="/api")
app.include_router(pipeline_router.router, prefix="/api")
app.include_router(retrieve_router.router, prefix="/api")


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}
```

**Step 2: Verify**
```bash
cd /Users/efecelik/gemini-live-hackathon-idea/backend/historian_api
python -c "from main import app; print('ok')"
```

**Step 3: Commit**
```bash
git add backend/historian_api/main.py
git commit -m "perf(rag): warm up Firestore+Genai singletons at startup to reduce cold-start latency"
```

---

## Task 5: Transcript Debounce + Query Cache in server.js

**File:** `backend/live_relay/server.js`

**Problem 1:** `retrieveContext` fires on every partial `inputTranscript` — Gemini Live streams mid-utterance, so "who wrote this" fires 3 calls.
**Problem 2:** Identical questions within a session re-embed and re-query unnecessarily.

**Step 1: Add debounce Map and query cache after `systemInstructionCache` declaration (after line ~62)**

```javascript
/** @type {Map<string, ReturnType<typeof setTimeout>>} */
const transcriptDebounceTimers = new Map();

/**
 * @typedef {Object} QueryCacheEntry
 * @property {string} result
 * @property {number} expiresAt
 */
/** @type {Map<string, Map<string, QueryCacheEntry>>} */
const queryResultCache = new Map();

function _normalizeQuery(query) {
  return query.toLowerCase().trim().replace(/\s+/g, ' ');
}

function _getSessionQueryCache(sessionId) {
  if (!queryResultCache.has(sessionId)) {
    queryResultCache.set(sessionId, new Map());
  }
  return queryResultCache.get(sessionId);
}
```

**Step 2: Replace the `retrieveContext` function with a cached version**

Replace the entire `retrieveContext` function with:
```javascript
async function retrieveContext(sessionId, query) {
  const now = Date.now();
  const key = _normalizeQuery(query);
  const cache = _getSessionQueryCache(sessionId);

  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.result;

  try {
    const res = await fetch(
      `${HISTORIAN_API_URL}/api/session/${sessionId}/retrieve`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, top_k: 4 }),
        signal: AbortSignal.timeout(1500),
      }
    );
    if (!res.ok) return '';
    const { chunks } = await res.json();
    if (!chunks || chunks.length === 0) return '';

    const contextText = chunks
      .map(c => {
        const pages = c.page_end > c.page_start
          ? `p.${c.page_start}–${c.page_end}`
          : `p.${c.page_start}`;
        const heading = c.heading ? `${c.heading}: ` : '';
        let body = c.summary || '';
        if (!body) {
          const raw = c.text.slice(0, 400);
          const match = raw.match(/(.+[.!?])\s*$/);
          body = match ? match[1] : raw;
        }
        return `[Document ${pages}] ${heading}${body}`;
      })
      .join('\n');

    // Cache for 60 seconds; evict oldest if over 20 entries
    cache.set(key, { result: contextText, expiresAt: now + 60_000 });
    if (cache.size > 20) cache.delete(cache.keys().next().value);

    return contextText;
  } catch {
    return '';
  }
}
```

**Step 3: Replace the inputTranscript RAG injection block with debounced version**

Find the current block:
```javascript
        if (transcript.length > 15 && geminiWs.readyState === WebSocket.OPEN) {
          retrieveContext(sessionId, transcript).then(contextText => {
```

Replace with:
```javascript
        if (transcript.length > 15 && geminiWs.readyState === WebSocket.OPEN) {
          // Debounce: Gemini Live streams partial transcripts; only fire on the final one
          const existing = transcriptDebounceTimers.get(sessionId);
          if (existing) clearTimeout(existing);
          const timer = setTimeout(() => {
            transcriptDebounceTimers.delete(sessionId);
            retrieveContext(sessionId, transcript).then(contextText => {
```

And close the new `setTimeout` block properly — wrap the existing `.catch(() => {})` closure:
```javascript
            }).catch(() => {});
          }, 300);
          transcriptDebounceTimers.set(sessionId, timer);
        }
```

**Step 4: Add query cache pruning to the existing setInterval block**

In the setInterval prune block (every 5 minutes), add after the `systemInstructionCache` loop:
```javascript
  for (const [sid, sessionCache] of queryResultCache) {
    for (const [k, entry] of sessionCache) {
      if (entry.expiresAt <= now) sessionCache.delete(k);
    }
    if (sessionCache.size === 0) queryResultCache.delete(sid);
  }
```

**Step 5: Clean up debounce timer on client disconnect**

In the `clientWs.addEventListener('close', ...)` handler, after the `geminiWs.close(...)` line:
```javascript
    const pendingTimer = transcriptDebounceTimers.get(sessionId);
    if (pendingTimer) { clearTimeout(pendingTimer); transcriptDebounceTimers.delete(sessionId); }
```

**Step 6: Update injection message prefix**

Find: `` `[Retrieved source context — use to answer the question]\n${contextText}` ``
Replace with: `` `[System: Retrieved document context]\n${contextText}` ``

**Step 7: Verify**
```bash
node --check /Users/efecelik/gemini-live-hackathon-idea/backend/live_relay/server.js && echo "syntax ok"
```

**Step 8: Commit**
```bash
git add backend/live_relay/server.js
git commit -m "perf(rag): debounce transcript retrieval (300ms) + 60s query result cache"
```

---

## End-to-End Verification

After all tasks:

1. **Batch embedding:** Phase I logs should show `"Embedding X chunks in 1 batch(es)"` not N individual calls
2. **Debounce:** Speak a question — check historian-api logs show exactly 1 POST to `/retrieve`, not 3+
3. **Score filter:** Check retrieve logs for sessions — no low-relevance chunks in response
4. **Cold start:** First request after deployment should not add 200ms delay
5. **Batch guard:** No `BadRequest` errors for long documents

---

## What These Changes Unlock

| Before | After |
|---|---|
| 10 embedding API calls for 10 chunks | 1 batch call |
| 3 retrieve calls per user utterance | 1 call after 300ms silence |
| Same question re-embedded every time | Served from 60s cache |
| Score 0.1 garbage injected into Gemini | Filtered at threshold 0.5 |
| `top_k=999` possible | Clamped at 10 with Pydantic + server guard |
| 200ms cold start penalty | Warmed at startup |
| Batch fails silently for 600-page docs | Chunked into 500-op batches |
