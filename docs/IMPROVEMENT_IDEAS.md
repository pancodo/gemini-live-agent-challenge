# Improvement Ideas & Backlog
**Last updated:** 2026-03-11

---

## High Impact — Innovation & UX (40% judging weight)

### 1. Historian Persona Context Injection
**Problem:** The Gemini Live historian has zero knowledge of what the documentary just showed. If Scene 3 covered gladiator rituals, the historian can't reference it when the user asks a question. The live session is completely disconnected from the pipeline output.
**Fix:** At session start, inject `visual_bible` + all segment scripts + scene briefs into the historian's system prompt. The historian should greet the user knowing exactly what documentary was just generated.
**Files:** `backend/live_relay/` — historian system prompt assembly

### 2. Narration Quality — Ken Burns Documentary Voice
**Problem:** The script agent produces accurate but generic factual text. Real Ken Burns narration has specific hallmarks: exact dates, primary source quotes read aloud, measured pacing, poetic scene transitions, second-person address to the viewer.
**Fix:** Rewrite the script agent system prompt with few-shot examples of actual documentary narration. Add constraints: must include at least one primary source quote per segment, must open with a specific date or moment, must end with a bridge sentence leading into the next scene.
**Files:** `backend/agent_orchestrator/agents/script_agent_orchestrator.py`

### 3. SSE Reconnection Resilience
**Problem:** If the SSE stream drops mid-pipeline (network hiccup, Cloud Run restart), the frontend has no recovery path. User sees a stuck loading screen forever.
**Fix:** SSE reconnection with state replay. On reconnect, the server replays all events since last received event ID. Frontend stores `lastEventId` and sends it on reconnect via `EventSource` `Last-Event-ID` header.
**Files:** `frontend/src/hooks/useSSE.ts`, `backend/historian_api/routes/pipeline.py`

---

## Medium Impact — Technical Implementation (30% judging weight)

### 4. Hallucination Firewall (Research → Script)
**Problem:** The aggregator feeds raw research into the script agent with no fact-checking. The script agent confidently narrates claims the research never actually found or grounded.
**Fix:** A thin validation agent between aggregation and scripting. Takes each factual claim from the draft script, checks it against the grounded research sources, flags or removes unverifiable claims. Only 1 extra ADK Agent step.
**Files:** New `backend/agent_orchestrator/agents/fact_validator_agent.py`

### 5. Pipeline Crash Recovery / Phase Checkpointing
**Problem:** If the pipeline crashes at Phase IV (visual research), re-running starts from Phase I again. All Phase I–III results are already in Firestore but are never reused.
**Fix:** At pipeline start, check Firestore for existing phase completion markers. If Phase I–III are marked done, skip directly to Phase IV. Each phase writes a `completed_phases` array to the session document on success.
**Files:** `backend/agent_orchestrator/agents/pipeline.py`

### 6. Rate Limit Safety — Unified Token Bucket
**Problem:** The semaphore limits concurrent Gemini calls per phase but doesn't account for simultaneous calls across all phases (Gemini Flash in research + Gemini Pro in synthesis + Imagen 3). Could hit 429 errors under load.
**Fix:** A shared `asyncio.Semaphore` or token bucket passed through the entire pipeline, capping total concurrent model calls at a safe global limit (e.g., 12).
**Files:** `backend/agent_orchestrator/agents/pipeline.py`, all orchestrators

### 7. Historical Period Profiles — Coverage Expansion
**Problem:** Only 6 period profiles in `historical_period_profiles.py`. Documents about Islamic Golden Age, Ming Dynasty, Mughal Empire, Mesoamerican civilizations, or Sub-Saharan Africa fall back to the `unknown` generic profile, producing low-quality prompts.
**Fix:** Add 8+ profiles: Ottoman/Islamic, East Asian (Tang/Ming/Qing), Indian Subcontinent (Mughal/Gupta), Mesoamerican (Aztec/Maya/Inca), Islamic Golden Age (Abbasid/Umayyad), Sub-Saharan African kingdoms, Byzantine, Viking/Norse.
**Files:** `backend/agent_orchestrator/agents/historical_period_profiles.py`

### 8. Veo 2 Operational Timeout + Graceful Fallback
**Problem:** Current Veo 2 polling: 30 polls × 20s = 10 minutes max wait. If Veo 2 hits quota or fails silently, the pipeline hangs for 10 minutes before giving up.
**Fix:** Hard 3-minute timeout. On timeout, mark the segment as `video_skipped`, emit a `segment_update` with `videoUrl: null`, and continue. The documentary player already handles null `videoUrl` by using Imagen 3 stills with Ken Burns.
**Files:** `backend/agent_orchestrator/agents/visual_director_orchestrator.py`

---

## Submission Risk — Demo & Presentation (30% judging weight)

### 9. Architecture Diagram
**Risk:** REQUIRED for submission — disqualification risk if missing.
**Fix:** Mermaid diagram in README showing the full flow: User/Browser → React Frontend → Cloud Run (historian-api) → Cloud Run (agent-orchestrator / ADK) → Vertex AI (Gemini / Imagen / Veo 2) → GCS → Firestore → live-relay → Gemini Live API.
**Files:** `README.md`

### 10. Terraform IaC (Bonus +0.2 pts)
**Risk:** The `terraform/` directory exists — if `terraform apply` doesn't actually provision everything, the bonus is lost.
**Fix:** Complete `terraform/main.tf` with: Cloud Run services (3), Firestore database, GCS bucket with lifecycle policy, Pub/Sub topics, Secret Manager secrets, IAM bindings, Artifact Registry.
**Files:** `terraform/main.tf`

### 11. Demo Video Shot List
**Risk:** The 4-minute video is 30% of judging. First 30 seconds determine impression.
**Fix:** Write a tight shot list. Recommended order:
1. (0:00–0:15) Upload a striking historical document — show drag and drop
2. (0:15–1:00) Expedition Log loading — show agents working in real time
3. (1:00–1:45) First segment reveals — show image + narration + caption
4. (1:45–2:30) User speaks mid-documentary — historian stops, responds, resumes
5. (2:30–3:15) Agent Modal — show research depth (sources, evaluation, facts)
6. (3:15–4:00) Architecture diagram + GCP console proof of deployment
**Files:** `docs/DEMO_SCRIPT.md` (create)

### 12. Blog Posts (Bonus +0.6 pts — LARGEST SINGLE LEVER)
**Risk:** +0.6 bonus = equivalent to 12% score boost. Both team members must publish with `#GeminiLiveAgentChallenge` tag and hackathon disclosure.
**Fix:** Write while building. Topics: "How we built a real-time multimodal documentary engine" / "Lessons from the Gemini Live API". Publish on Medium, Dev.to, or personal blog.

### 13. GDG Membership (Bonus +0.2 pts)
**Fix:** Both Berkay and Efe join GDG at gdg.community.dev and include public profile links in the Devpost submission.

---

## Quick Wins (Low effort, high polish)

### 14. Non-English Document Search Queries
**Problem:** For Arabic, Latin, Chinese, or Sanskrit documents, `targeted_searches` in the storyboard are generated in English only. Museum databases in the document's native language would find better archival sources.
**Fix:** In `NarrativeVisualPlanner` prompt, instruct: "For non-Latin-script documents, include at least 1 search query in the document's source language."

### 15. Segment Count Adaptation
**Problem:** Scene count is capped at 4 (dev cost control). A 50-page document and a 2-page document both get 4 scenes. The right count depends on document richness.
**Fix:** DocumentAnalyzer computes `recommended_scene_count = min(max(2, total_chunks // 3), 6)`. Pass to NarrativeVisualPlanner as guidance.
**Files:** `backend/agent_orchestrator/agents/document_analyzer.py`

### 16. Imagen 3 GCS Cache
**Problem:** Re-running the pipeline for the same document regenerates all 16 images, wasting time and money.
**Fix:** Before calling Imagen 3, check if GCS path already exists. If yes, skip generation and reuse the existing URL. GCS paths are deterministic from `session_id + scene_id + frame_idx`.
**Files:** `backend/agent_orchestrator/agents/visual_director_orchestrator.py`

### 17. Frontend Error UX
**Problem:** When an agent fails, the frontend has no graceful degradation. The user sees a stuck card with no explanation.
**Fix:** Handle `agent_status(error)` SSE events in `ResearchPanel` — show an error state on the card with the failure reason. Pipeline continues; only that scene falls back to script descriptions.
**Files:** `frontend/src/components/workspace/ResearchPanel.tsx`

---

## Priority Order (by deadline impact)

| Priority | Item | Effort | Impact |
|----------|------|--------|--------|
| 🔴 NOW | #9 Architecture diagram | 1h | Disqualification risk |
| 🔴 NOW | #12 Blog posts | Ongoing | +0.6 bonus pts |
| 🔴 NOW | #13 GDG membership | 15min | +0.2 bonus pts |
| 🟡 SOON | #1 Historian context injection | 3h | 40% criterion |
| 🟡 SOON | #2 Ken Burns narration voice | 2h | 40% criterion |
| 🟡 SOON | #10 Terraform IaC | 4h | +0.2 bonus pts |
| 🟢 IF TIME | #4 Hallucination firewall | 3h | 30% criterion |
| 🟢 IF TIME | #5 Pipeline checkpointing | 4h | 30% criterion |
| 🟢 IF TIME | #7 Period profiles expansion | 2h | Visual quality |
| 🟢 IF TIME | #3 SSE reconnection | 3h | Polish |
