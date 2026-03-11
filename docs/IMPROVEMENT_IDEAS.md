# Improvement Ideas & Implementation Plans
**Last updated:** 2026-03-11 | **Status:** All 17 ideas researched, planned, and agent-assigned

Each idea has a concrete implementation plan from internet research, specific files to change, and an assigned specialized agent.

---

## High Impact — Innovation & UX (40% judging weight)

### 1. Historian Persona Context Injection
**Problem:** The Gemini Live historian has zero knowledge of what the documentary just showed. If Scene 3 covered gladiator rituals, the historian can't reference it when the user asks a question.

**Research findings:**
- The first message to Gemini Live API **must** be `BidiGenerateContentSetup` with `systemInstruction.parts[0].text`
- Total injected context (visual_bible + scene_briefs + segment scripts): ~10K–27K chars = ~3K–7K tokens, under 1% of the 1M-token context window
- Firestore reads add ~50–100ms at connection start — well within the 300ms interruption budget

**Implementation plan:**
1. On new WebSocket connection, extract `sessionId` from URL path `/session/:sessionId`
2. Fetch from Firestore: `sessions/{sessionId}` (visual_bible, language) + `sessions/{sessionId}/segments/*` (title, script, mood, sources)
3. Assemble system prompt: static historian persona (2K chars) + documentary context block (30K char hard cap)
4. Send `BidiGenerateContentSetup` with assembled `systemInstruction` before relaying any audio
5. Cache assembled `systemText` per `sessionId` in a `Map` with 15-minute TTL for reconnects

**Files:** `backend/live_relay/server.js`, `backend/live_relay/firestore-context.js`, `backend/live_relay/prompt-builder.js`

**Effort:** 3h | **Impact:** 40% criterion

**Assigned agent:** `backend-developer`

---

### 2. Narration Quality — Ken Burns Documentary Voice
**Problem:** The script agent produces accurate but generic factual text.

**Research findings:**
- Ken Burns hallmarks: specific date/moment opening, primary source quotes read aloud with attribution, present-tense pivot for immediacy, "resonance close" (not summary), bridge sentence to next scene
- The entire fix is a prompt rewrite — no structural or type changes needed
- A single embedded few-shot example (~200 words) is worth more than 500 words of style description

**Implementation plan:**

Replace `_INNER_SCRIPT_AGENT_INSTRUCTION` in `script_agent_orchestrator.py` with a rewrite that includes:
- **Role anchor:** "Write as Ken Burns and Geoffrey C. Ward would" (activates strong stylistic prior)
- **5 mandatory rules** (each with a BAD/GOOD example pair):
  - Rule 1: Open with specific moment, not topic sentence
  - Rule 2: At least one primary source quote per segment with attribution
  - Rule 3: Present-tense pivot ("It is July 1, 1863. The temperature is already 87 degrees.")
  - Rule 4: End with resonance, not summary ("The field is quiet now. Wildflowers grow where the artillery stood.")
  - Rule 5: Bridge sentence to next scene (except final segment)
- **Anti-patterns list:** "Throughout history...", modern idioms, meta-transitions
- **Pacing guide by `narrative_role`:** opening (slow/atmospheric), climax (short declaratives), coda (quietest)
- **Full few-shot example** (250 words showing all 5 rules in action)

Token cost: ~2,400 tokens (from ~1,100). Adds ~$0.001 per pipeline run.

**File:** `backend/agent_orchestrator/agents/script_agent_orchestrator.py` — `_INNER_SCRIPT_AGENT_INSTRUCTION` only

**Effort:** 2h | **Impact:** 40% criterion

**Assigned agent:** `prompt-engineer`

---

### 3. SSE Reconnection Resilience
**Problem:** SSE stream drops → frontend shows a stuck loading screen forever with no recovery path.

**Research findings:**
- `EventSource` auto-reconnects natively and sends `Last-Event-ID` header automatically — no client reconnect logic needed
- Current `asyncio.Queue` is destructive: events consumed once, gone. Replace with an append-only in-memory log
- A `SessionEventLog` dataclass with a list + `asyncio.Event` notifier handles replay without Firestore (same process, 5-min TTL sufficient)

**Implementation plan:**

**Server (`backend/historian_api/routes/pipeline.py`):**
1. Replace `_sse_queues: dict[str, asyncio.Queue]` with `_event_logs: dict[str, SessionEventLog]`
2. `SessionEventLog` has: `events: list[str]`, `finished: bool`, `_notify: asyncio.Event`
3. SSE endpoint reads `Last-Event-ID` header → `cursor = int(header) + 1` → replays `events[cursor:]`
4. Streams new events by awaiting `log.wait_for_new()` with 25s keepalive timeout
5. On pipeline done: `log.finish()` → `asyncio.create_task(_cleanup_log(session_id, delay=300))`

**Client (`frontend/src/hooks/useSSE.ts`):**
1. Add `lastProcessedIdRef = useRef<number>(-1)`
2. In `onmessage`: read `e.lastEventId`, skip if `eventId <= lastProcessedIdRef.current` (dedup after reconnect)
3. `onerror` handler: no-op (EventSource handles reconnect), add comment for documentation
4. Existing drip buffer (150ms) and store dispatch unchanged

**Files:** `backend/historian_api/routes/pipeline.py`, `frontend/src/hooks/useSSE.ts`

**Effort:** 3h | **Impact:** Polish / 40% criterion

**Assigned agent:** `fullstack-developer`

---

## Medium Impact — Technical Implementation (30% judging weight)

### 4. Hallucination Firewall (Research → Script)
**Problem:** The aggregator feeds raw research into the script agent with no fact-checking. The script agent confidently narrates claims the research never actually found.

**Research findings:**
- Best approach: LLM-as-judge (hybrid) — single Gemini Flash call, no tools
- Overwrite `session.state["script"]` directly → zero changes to any downstream agent
- Safety: if validator returns wrong segment count, keep original (fail-safe)

**Implementation plan:**

**New file `fact_validator_agent.py`:**
- `FactValidatorAgent(BaseAgent)` — no tools, `gemini-2.0-flash`, reads `{script}` + `{aggregated_research}` + `{scene_briefs}` from session.state
- Instruction enforces: SUPPORTED (keep as-is), UNSUPPORTED SPECIFIC (remove + write bridging sentence from research), UNSUPPORTED PLAUSIBLE (soften with "according to tradition"), NON-FACTUAL (keep, don't touch)
- Mandatory output schema: `{ "validated_segments": [...], "report": [{segment_id, claims_checked, claims_removed, claims_softened, changes}] }`
- Writes validated segments back to `session.state["script"]` (overwrite) + `session.state["validation_report"]` (debug only)
- SSE emits: `agent_status(searching)` → `agent_status(done)` with stats (N checked, N removed, N softened)
- Latency: ~3–5s per pipeline run (negligible)

**Pipeline wiring (`pipeline.py`):** Insert `fact_validator` between `script_orch` and `narrative_visual_planner_orch`

**Files:** `backend/agent_orchestrator/agents/fact_validator_agent.py` (new), `backend/agent_orchestrator/agents/pipeline.py`

**Effort:** 3h | **Impact:** 30% criterion

**Assigned agent:** `backend-developer`

---

### 5. Pipeline Crash Recovery / Phase Checkpointing
**Problem:** Pipeline crash at Phase IV → re-run starts from Phase I, discarding all Firestore-persisted Phase I–III results.

**Research findings:**
- Firestore is the right checkpoint store (survives container restarts, already used by all phases)
- `SequentialAgent` doesn't support conditional skipping — replace with `ResumablePipelineAgent(BaseAgent)` that checks the checkpoint before running each phase
- All session.state keys must be restored from snapshot before the first incomplete phase runs

**Implementation plan:**

**New file `checkpoint_helpers.py`:**
- `PHASE_OUTPUT_KEYS: dict[int, list[str]]` — maps phase number → state keys it produces
- `load_checkpoint(db, session_id) → (completed_phases, snapshot)` — async Firestore read
- `save_checkpoint(db, session_id, phase, state)` — async Firestore write with `arrayUnion` (atomic)

**`pipeline.py` changes:**
- Replace `SequentialAgent` return with `ResumablePipelineAgent`:
  - On init: `load_checkpoint` → restore snapshot → skip completed phases
  - After each phase completes: `save_checkpoint`
- `phase_agent_map: list[tuple[int, list[int]]]` maps phase number → sub-agent indices
- Firestore schema: `completed_phases: int[]`, `last_completed_phase: int`, `phase_state_snapshot: map`

**`historian_api/routes/pipeline.py`:** Relax 409 check — allow re-trigger if `status == "error"`

**Files:** `backend/agent_orchestrator/agents/checkpoint_helpers.py` (new), `backend/agent_orchestrator/agents/pipeline.py`, `backend/historian_api/routes/pipeline.py`

**Effort:** 4h | **Impact:** 30% criterion

**Assigned agent:** `backend-developer`

---

### 6. Rate Limit Safety — Unified Token Bucket
**Problem:** Independent semaphores across phases don't coordinate → could hit 429s with Gemini Flash + Gemini Pro + Imagen 3 running in overlapping phases.

**Research findings:**
- Current risk is actually lower than stated (pipeline is sequential across phases via SequentialAgent) — real risk is within-phase concurrent batches
- `asyncio.Semaphore` is the right tool (not a token bucket): bottleneck is concurrent connections, not sustained RPM
- Inject shared limiter via factory function constructors (same pattern as `emitter`)
- Note: `scene_research_agent` and `script_agent_orchestrator` use ADK internal routing — cannot wrap those calls

**Implementation plan:**

**New file `rate_limiter.py`:**
- `GlobalRateLimiter(limit, label)`: wraps `asyncio.Semaphore` with `in_flight` counter + logging
- `async def acquire(caller)` — context manager, logs when queued, warns if call takes >10s
- `rate_limited_generate(client, rate_limiter, ...)` — wraps `generate_content` with 3× exponential-backoff retry on 429/503

**Wiring (`pipeline.py`):**
```python
gemini_limiter = GlobalRateLimiter(limit=12, label="gemini")
imagen_limiter = GlobalRateLimiter(limit=8, label="imagen")
# Pass to factory functions as optional kwargs
```

**Each orchestrator** gains `rate_limiter: Any = Field(default=None)` and creates a local fallback if `None`

**Files:** `backend/agent_orchestrator/agents/rate_limiter.py` (new), `pipeline.py`, `visual_research_orchestrator.py`, `visual_research_stages.py`, `visual_director_orchestrator.py`, `document_analyzer.py`

**Effort:** 3h | **Impact:** 30% criterion (reliability)

**Assigned agent:** `backend-developer`

---

### 7. Historical Period Profiles — Coverage Expansion
**Problem:** Only 6 period profiles. Islamic Golden Age, Ming Dynasty, Mughal Empire, Mesoamerican civilizations, Sub-Saharan Africa fall back to the generic profile.

**Research findings:** Full profile data for 8 new periods researched and ready to implement.

**Implementation plan:**

Add 8 new profiles to `HISTORICAL_PERIOD_PROFILES` dict with full data (architecture, clothing, materials, lighting, color palette, art style references, era markers negative, crowd descriptions):

| Key | Period | Date Range | Detection Keywords |
|-----|--------|------------|--------------------|
| `islamic_golden_age` | Islamic Golden Age 8th–13th c | (750, 1258) | "abbasid", "umayyad", "house of wisdom", "cordoba", "al-andalus" |
| `east_asian_imperial` | Imperial China 7th–19th c | (618, 1912) | "tang dynasty", "ming dynasty", "qing dynasty", "forbidden city", "hanfu" |
| `indian_subcontinent` | Indian Subcontinent 4th–18th c | (320, 1857) | "mughal", "gupta", "taj mahal", "rajput", "akbar", "shah jahan" |
| `mesoamerican` | Mesoamerican Civilizations | (-2000, 1533) | "aztec", "maya", "inca", "tenochtitlan", "machu picchu", "quetzalcoatl" |
| `sub_saharan_african` | Sub-Saharan African Kingdoms | (300, 1900) | "mali empire", "great zimbabwe", "timbuktu", "mansa musa", "axum", "benin" |
| `byzantine` | Byzantine Empire 4th–15th c | (330, 1453) | "byzantine", "byzantium", "eastern roman", "justinian", "theodora" |
| `viking_norse` | Viking and Norse 8th–11th c | (793, 1066) | "viking", "norse", "varangian", "rune", "longship", "norsem" |
| `renaissance_europe` | Renaissance Europe 14th–17th c | (1350, 1650) | "renaissance", "medici", "tudor", "elizabethan", "gutenberg", "florence" |

**Critical detection ordering fix:** Check `byzantine`/`eastern roman` BEFORE `roman`; `renaissance` before `medieval`; `islamic_golden_age` before `ottoman`.

**New site overrides:** Taj Mahal, Machu Picchu, Chichen Itza, Great Wall, Great Zimbabwe, Timbuktu

**Files:** `backend/agent_orchestrator/agents/historical_period_profiles.py`, `backend/agent_orchestrator/agents/visual_director_orchestrator.py`

**Effort:** 2h | **Impact:** Visual quality

**Assigned agent:** `research-analyst`

---

### 8. Veo 2 Operational Timeout + Graceful Fallback
**Problem:** 30 polls × 20s = 10-min max hang if Veo 2 hits quota or fails silently.

**Research findings:**
- `asyncio.wait_for(coro, timeout=180)` is the correct tool — cancels the coroutine at its current `await` point immediately, not after the current poll interval finishes
- `asyncio.TimeoutError` is distinct from quota errors (which produce `operation.error`) and silent failures (empty `generated_videos`)
- No frontend changes needed — player already handles `null videoUrl` with Ken Burns stills

**Implementation plan:**

In `visual_director_orchestrator.py`:
1. Add constant: `_VEO2_HARD_TIMEOUT_SECONDS: float = 180.0`
2. New helper `_mark_segment_video_skipped(db, session_id, segment_id, reason)`: writes `videoUrl: None, videoStatus: "skipped:{reason}"` to Firestore
3. Modify `_poll_and_update` closure: wrap poll call with `asyncio.wait_for(..., timeout=_VEO2_HARD_TIMEOUT_SECONDS)`
4. On `TimeoutError`: call `_mark_segment_video_skipped(reason="timeout")`, emit `segment_update(status="complete")` with no videoUrl, log and continue
5. On any other error: same fallback with `reason="generation_failed"`

**File:** `backend/agent_orchestrator/agents/visual_director_orchestrator.py`

**Effort:** 2h | **Impact:** 30% criterion (reliability)

**Assigned agent:** `backend-developer`

---

## Submission Risk — Demo & Presentation (30% judging weight)

### 9. Architecture Diagram
**Risk:** REQUIRED for submission — disqualification risk if missing.

**Research findings:** GitHub renders Mermaid natively in any Markdown file. `flowchart TD` is correct for this architecture (vertical hierarchy). Full + compact versions created.

**Implementation plan:**
- **COMPLETE:** File created at `docs/architecture-diagram.md` with both full (~35 nodes) and compact (~12 nodes) Mermaid diagrams
- Action: Copy the `flowchart TD` block from that file into `README.md`
- Edge labels: solid arrows for REST/RPC, dotted for async/SSE/WebSocket
- Both versions avoid GitHub Mermaid limitations (no FontAwesome, no HTML in unquoted labels, no hyperlinks, under 40 nodes)

**Files:** `README.md` — paste from `docs/architecture-diagram.md`

**Effort:** 30min (copy-paste) | **Impact:** Disqualification risk

**Assigned agent:** `technical-writer`

---

### 10. Terraform IaC (Bonus +0.2 pts)
**Risk:** `terraform/main.tf` exists — if `terraform apply` doesn't provision everything, the bonus is lost.

**Research findings:** Complete `main.tf` written by the terraform-engineer agent.

**Implementation plan:**
- **COMPLETE:** `terraform/main.tf` now provisions 18 resource types, ~30 instances:
  - 11 GCP APIs enabled via `for_each`
  - 1 service account + 8 IAM role bindings
  - 3 Cloud Run v2 services (historian-api 300s timeout, agent-orchestrator 900s, live-relay 3600s + session affinity)
  - Firestore native mode (nam5 multi-region) + composite index
  - 2 GCS buckets with lifecycle TTLs (docs 30-day, assets 7-day)
  - 4 Pub/Sub topics + 4 push subscriptions
  - Artifact Registry with 5-version cleanup policy
  - 2 Secret Manager secrets
- `deploy_real_images` variable (default `false`) uses placeholder images on first apply
- GCS backend block included (commented, ready for state bucket)

**Deploy:**
```bash
cd terraform/
cp terraform.tfvars.example terraform.tfvars  # fill in project + region
terraform init && terraform plan && terraform apply
```

**Files:** `terraform/main.tf` (complete), `terraform/terraform.tfvars.example` (create)

**Effort:** 30min (verify apply works) | **Impact:** +0.2 bonus pts

**Assigned agent:** `terraform-engineer`

---

### 11. Demo Video Shot List
**Risk:** The 4-minute video is 30% of judging. First 30 seconds determine judge impression.

**Research findings:** Complete demo script created by the demo agent.

**Implementation plan:**
- **COMPLETE:** Full `docs/DEMO_SCRIPT.md` created with 7-shot sequence, exact timing, narration script, voiceover text
- **Document choice:** Ottoman-era firman (non-Latin script proves multilingual OCR; rich historical surface for impressive Expedition Log)
- **Key production rules:**
  1. Record voiceover separately, sync in post
  2. Leave intentional silence during Expedition Log and historian voice
  3. Never speed up video — cut words instead
  4. **Shot 4 (voice interruption) gets 50 seconds** — historian must be interrupted mid-word, not mid-pause

**Shot sequence:**
| Shot | Timing | Content |
|------|--------|---------|
| 1 | 0:00–0:20 | Product hook — show the final documentary first |
| 2 | 0:20–0:35 | Document upload — drag Ottoman firman |
| 3 | 0:35–1:30 | Expedition Log — agents working in real time |
| 4 | 1:30–2:20 | Voice interruption — historian stops mid-word |
| 5 | 2:20–2:55 | Agent Modal — research depth |
| 6 | 2:55–3:25 | Technical proof — architecture diagram + GCP console |
| 7 | 3:25–3:58 | Closing — product identity statement |

**Files:** `docs/DEMO_SCRIPT.md` (complete)

**Effort:** Filming + editing | **Impact:** 30% criterion

**Assigned agent:** `technical-writer`

---

### 12. Blog Posts (Bonus +0.6 pts — LARGEST SINGLE LEVER)
**Risk:** +0.6 bonus = equivalent to 12% score boost. Both team members must publish with `#GeminiLiveAgentChallenge` tag.

**Research findings:** Full blog strategy created. Dev.to (primary) + Medium (cross-post with canonical).

**Implementation plan:**
- **COMPLETE:** Blog strategy at `docs/plans/blog-post-strategy.md`
- **Required disclosure in every post:** "This post was written as part of my submission to the Gemini Live Agent Challenge hackathon, organized by Google LLC and administered by Devpost."
- **Required tag:** `#GeminiLiveAgentChallenge` (Dev.to tag + social share)

**Berkay's post:** "Building a Real-Time Voice Historian with Gemini Live API: Interruption, Resumption, and Sub-300ms Latency"
- Sections: WebSocket relay on Cloud Run, browser audio pipeline (AudioWorklet→PCM), interruption handling (budget breakdown), session resumption via Firestore tokens, gotchas (PCM rate mismatch, dead model ID `gemini-2.0-flash-live-001`, CPU always-allocated)

**Efe's post:** "From Ottoman Manuscript to AI Documentary: Building a 7-Agent Research Pipeline with Google ADK"
- Sections: Phase I–V pipeline overview, Document AI OCR for 200+ languages, dynamic ParallelAgent construction (f-string/ADK template trick), `google_search` isolation constraint, progressive delivery (Scene 0 first for <45s), Veo 2 async polling with `run_in_executor` workaround, SSE as user-facing content (Expedition Log)

**Timeline:** Publish by **March 14** (not March 16 — need buffer for edits and indexing). Add URLs to Devpost form by March 15.

**Effort:** Ongoing | **Impact:** +0.6 bonus pts

**Assigned agent:** `content-marketer`

---

### 13. GDG Membership (Bonus +0.2 pts)
**Fix:** Both Berkay and Efe join GDG at [gdg.community.dev](https://gdg.community.dev) and include public profile links in the Devpost submission form.

**Effort:** 15min | **Impact:** +0.2 bonus pts

**Assigned agent:** *(manual task — no code)*

---

## Quick Wins (Low effort, high polish)

### 14. Non-English Document Search Queries
**Problem:** For Arabic, Latin, Chinese, or Sanskrit documents, search queries are English-only. Native-language archives find better sources.

**Research findings:**
- Gemini 2.0 Flash handles multilingual query generation natively — just instruct it
- Google Search Grounding fully supports non-Latin script queries
- Tier 1 languages with rich archival databases: Arabic, Chinese, Japanese, Korean, Persian, Turkish, Hindi, Russian, French, German
- Dead languages (Latin, Classical Arabic, Ancient Greek): use modern scholarly language of the region instead

**Implementation plan:**

Add this block to the Stage 0 prompt in `visual_research_stages.py` (after the "Rules:" section, before output format):

```
Native-language queries:
- Examine the document excerpt and identify its source language/script.
- If the document is NOT in English, include at least 1 query in the document's source language/script.
  Use native script (e.g., Arabic: "مخطوطة عثمانية القرن الثامن عشر", Chinese: "清代瓷器故宫博物院藏品").
- For dead languages (Latin, Classical Arabic, Ancient Greek, Sanskrit):
  Do NOT write queries in the dead language. Use the modern scholarly language of the region instead
  (Modern Greek for Ancient Greek, Modern Arabic for Classical Arabic, Italian for Latin, Hindi for Sanskrit).
- Also include 1 romanized/transliterated query to catch Western museum holdings.
- English queries remain the majority (at least 3 of 5-7 queries must be in English).
```

Optionally add `source_language: str | None = Field(default=None)` to `SceneBrief` in `chunk_types.py` and thread it from the Narrative Curator for traceability.

**File:** `backend/agent_orchestrator/agents/visual_research_stages.py` — Stage 0 prompt; optionally `chunk_types.py`

**Effort:** 30min | **Impact:** Source quality for non-English documents

**Assigned agent:** `prompt-engineer`

---

### 15. Segment Count Adaptation
**Problem:** A 50-page document and a 2-page document both get 4 scenes. The right count depends on document richness.

**Research findings:** `len(chunks)` is already computed after `semantic_chunk()`. Formula produces sensible values: 1-2 chunks → 2 scenes (floor), 20+ chunks → 6 scenes (cap). All downstream agents already iterate dynamically over `scene_briefs`.

**Implementation plan:** Two surgical edits in one file:

**1. In `document_analyzer.py`**, after `chunks = semantic_chunk(ocr_text, session_id)`:
```python
total_chunks = len(chunks)
recommended_scene_count = min(max(2, total_chunks // 3), 6)
ctx.session.state["recommended_scene_count"] = recommended_scene_count
```

**2. In `_NARRATIVE_CURATOR_INSTRUCTION`**, replace:
```
Select exactly 4 cinematically compelling moments from the document (was 4-8 — restore range before submission).
```
with:
```
Select approximately {recommended_scene_count} cinematically compelling moments from the document.
This is guidance based on document length — you may produce one more or one fewer if the source
material demands it, but stay within the range of 2 to 6 scenes total.
```

**File:** `backend/agent_orchestrator/agents/document_analyzer.py` only (2 edits)

**Effort:** 30min | **Impact:** Proportional scenes for short vs. long documents

**Assigned agent:** `backend-developer`

---

### 16. Imagen 3 GCS Cache
**Problem:** Re-running the pipeline for the same document regenerates all images, wasting time and money.

**Research findings:**
- GCS paths are already deterministic: `sessions/{session_id}/images/{segment_id}/frame_{frame_idx}.jpg`
- `blob.exists()` (HEAD request, ~30–50ms) is the correct tool — cheaper than `list_blobs`, simpler than raw HEAD
- Run all existence checks concurrently via `asyncio.gather` + `run_in_executor` → ~50ms wall time for all 16 frames
- On full cache hit: 0 Imagen 3 calls, saves ~45s of generation time

**Implementation plan:**

In `visual_director_orchestrator.py`, add:
1. Module-level `storage.Client()` singleton (`_get_storage_client()`) for thread safety
2. `_check_blob_exists_sync(bucket_name, blob_name) → bool`
3. `_check_blob_exists_async(bucket_name, blob_name) → bool` — `run_in_executor` wrapper
4. `_batch_check_existing_frames(bucket_name, session_id, segments, ...) → dict[blob_name, gcs_uri]` — runs all checks concurrently, logs "N/M frames cached"
5. Modify `_generate_one_frame`: add `existing_cache: dict | None = None` parameter; return `existing_cache[blob_name]` immediately on hit
6. In `_run_async_impl`: call `_batch_check_existing_frames` once before any generation; thread result into all `_generate_segment_images` calls

**File:** `backend/agent_orchestrator/agents/visual_director_orchestrator.py` only

**Effort:** 2h | **Impact:** Cost and time savings on re-runs

**Assigned agent:** `backend-developer`

---

### 17. Frontend Error UX
**Problem:** When an agent fails, the frontend shows a stuck card with no explanation.

**Research findings:**
- `AgentStatus` already has `'error'` in the type union; `statusDotClass` already handles it with `bg-red-500`; toasts already fire on error transitions
- Missing: `errorMessage` field on `AgentState`, error message not forwarded from SSE events to store, no distinct error border/animation on cards

**Implementation plan:**

4 files, ~30 lines total:

**`frontend/src/types/index.ts`:** Add `errorMessage?: string` to `AgentState` and `AgentStatusEvent`

**`frontend/src/hooks/useSSE.ts`:**
- In `agent_status` case: forward `event.errorMessage` into `setAgent(...)` call
- In `error` case: add `errorMessage: event.message` (was being lost)

**`frontend/src/components/workspace/ResearchPanel.tsx`:**
- Error border: `.agent-card.error` CSS class — `border-color: rgba(239,68,68,0.4)`, `background: rgba(239,68,68,0.04)`
- Dot shake animation: `{ x: [0, -2, 2, -1, 1, 0] }` — one-shot shake (not repeating pulse)
- Inline error message: `<motion.p>` with `height: 'auto'` transition, `text-red-400 text-[11px] line-clamp-2`
- Improved toast: `toast.error('Research agent failed', { description: agent.errorMessage ?? agent.query })`

**`backend/agent_orchestrator/agents/sse_helpers.py`:** Add `error_message: str | None = None` to `build_agent_status_event` signature and payload (backward-compatible)

**Files:** `frontend/src/types/index.ts`, `frontend/src/hooks/useSSE.ts`, `frontend/src/components/workspace/ResearchPanel.tsx`, `backend/agent_orchestrator/agents/sse_helpers.py`

**Effort:** 2h | **Impact:** Polish / agent failure UX

**Assigned agent:** `frontend-developer`

---

## Priority Order (by deadline impact)

| Priority | Item | Effort | Impact | Assigned Agent |
|----------|------|--------|--------|----------------|
| 🔴 NOW | #9 Architecture diagram | 30min | Disqualification risk | `technical-writer` |
| 🔴 NOW | #12 Blog posts | Ongoing | +0.6 bonus pts | `content-marketer` |
| 🔴 NOW | #13 GDG membership | 15min | +0.2 bonus pts | *(manual)* |
| 🟡 SOON | #1 Historian context injection | 3h | 40% criterion | `backend-developer` |
| 🟡 SOON | #2 Ken Burns narration voice | 2h | 40% criterion | `prompt-engineer` |
| 🟡 SOON | #10 Terraform IaC | 30min (verify) | +0.2 bonus pts | `terraform-engineer` |
| 🟡 SOON | #8 Veo 2 timeout fallback | 2h | Pipeline reliability | `backend-developer` |
| 🟢 IF TIME | #4 Hallucination firewall | 3h | 30% criterion | `backend-developer` |
| 🟢 IF TIME | #5 Pipeline checkpointing | 4h | 30% criterion | `backend-developer` |
| 🟢 IF TIME | #7 Period profiles expansion | 2h | Visual quality | `research-analyst` |
| 🟢 IF TIME | #3 SSE reconnection | 3h | Polish | `fullstack-developer` |
| 🟢 IF TIME | #6 Rate limit safety | 3h | Reliability | `backend-developer` |
| 🟢 IF TIME | #15 Segment count adaptation | 30min | Document proportionality | `backend-developer` |
| 🟢 IF TIME | #16 GCS cache | 2h | Cost/time savings | `backend-developer` |
| 🟢 IF TIME | #14 Non-English queries | 30min | Source quality | `prompt-engineer` |
| 🟢 IF TIME | #17 Frontend error UX | 2h | Polish | `frontend-developer` |
| 🟢 IF TIME | #11 Demo video shot list | Filming | 30% criterion | `technical-writer` |

---

## Files Created by Research Agents

| File | Contents | Status |
|------|----------|--------|
| `docs/architecture-diagram.md` | Full + compact Mermaid diagrams ready to paste into README | ✅ Created |
| `docs/DEMO_SCRIPT.md` | 7-shot script with timing, narration, voiceover | ✅ Created |
| `docs/plans/blog-post-strategy.md` | Platform choice, required disclosures, both blog outlines | ✅ Created |
| `terraform/main.tf` | Complete IaC for all 7 services, 18 resource types | ✅ Updated |
