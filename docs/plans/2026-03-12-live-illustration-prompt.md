# Implementation Prompt — Live Illustration Engine

Copy this entire prompt into a new Claude Code session to implement the feature.

---

## PROMPT START

Read the implementation plan at `docs/plans/2026-03-12-live-illustration-engine.md`. This is the full design for the Live Illustration Engine — a feature that generates Gemini interleaved TEXT+IMAGE illustrations in real-time when the user asks the historian a question during documentary playback.

Implement all 5 teams using parallel subagents. Here's what each team does:

### Team 1: Backend Illustration Endpoint
Create `backend/historian_api/routes/illustrate.py` with:
- `POST /api/session/{session_id}/illustrate` endpoint
- Accepts `{ query, current_segment_id, mood }` body
- Reads session context from Firestore (visual_bible, current segment)
- Calls RAG retrieval (`retrieve_chunks` from `backend/historian_api/routes/retrieve.py`) for grounding
- Makes Gemini interleaved call: `response_modalities=["TEXT", "IMAGE"]` using model `gemini-2.5-flash-image` on Vertex AI (location="global")
- Parses response: extracts text parts (creative direction) and inline_data parts (image bytes)
- Uploads image to GCS: `sessions/{session_id}/illustrations/{uuid}.jpg`
- Generates 1-hour signed URL
- Per-session rate limit: max 1 call per 10 seconds (use in-memory dict with timestamps)
- Returns `{ imageUrl, caption, generatedAt }`
- Register router in `backend/historian_api/main.py`

Reference existing patterns:
- `backend/agent_orchestrator/agents/narrative_director_agent.py` lines 238-286 for the interleaved Gemini call pattern
- `backend/historian_api/routes/retrieve.py` for RAG retrieval
- `backend/historian_api/routes/session.py` function `_gs_to_signed_url` for signed URL generation

### Team 2: Live-Relay Trigger
Modify `backend/live_relay/server.js`:
- After the existing RAG injection logic (around line 427 where `inputTranscript` is handled)
- Add `maybeGenerateIllustration(sessionId, transcript, clientWs)` function
- 12-second cooldown per session (Map of sessionId → timestamp)
- Minimum transcript length: 20 chars
- Fire-and-forget POST to `{HISTORIAN_API_URL}/api/session/{sessionId}/illustrate`
- On success, send to client WebSocket: `{ type: 'live_illustration', imageUrl, caption }`
- Non-fatal: catch all errors silently (historian voice must never be interrupted)
- Use AbortSignal.timeout(15000) on the fetch

### Team 3: Frontend Display
Modify these files:

1. `frontend/src/types/index.ts` — Add:
   ```typescript
   export interface LiveIllustration {
     imageUrl: string;
     caption: string;
     receivedAt: number;
   }
   ```
   Also add `'live_illustration'` to `SSEEventType` union and add `LiveIllustrationEvent` interface.

2. `frontend/src/store/playerStore.ts` — Add:
   - `liveIllustration: LiveIllustration | null` to state
   - `setLiveIllustration: (ill: LiveIllustration | null) => void` action
   - Auto-clear timeout: when setting a non-null illustration, setTimeout to clear it after 25 seconds

3. `frontend/src/hooks/useGeminiLive.ts` — Add handler for `type: 'live_illustration'` messages:
   - Import playerStore
   - Call `setLiveIllustration({ imageUrl, caption, receivedAt: Date.now() })`

4. `frontend/src/components/player/KenBurnsStage.tsx` — Add illustration overlay:
   - Read `liveIllustration` from playerStore
   - When non-null: render a `<motion.img>` absolutely positioned over the Ken Burns cycle
   - Use `<AnimatePresence>` with: `initial={{ opacity: 0, scale: 1.0 }}`, `animate={{ opacity: 1, scale: 1.08 }}`, `exit={{ opacity: 0 }}`, transition durations: opacity 1.2s ease-in-out, scale 20s linear
   - z-index above cycle images (z-index: 2) but below captions
   - object-cover, full dimensions
   - While illustration is null but was recently requested (loading state), show a subtle golden box-shadow pulse animation

5. `frontend/src/components/player/DocumentaryPlayer.tsx` — Add:
   - "✦ Illustrating..." badge in top-right corner when `liveIllustration` is loading or active
   - Use Motion fade-in/out
   - Below CaptionTrack: show `liveIllustration.caption` in gold italic Cormorant Garamond 16px
   - Fade out when liveIllustration clears

### Team 4: SSE + Firestore Persistence
1. `backend/agent_orchestrator/agents/sse_helpers.py` — Add `build_live_illustration_event()` helper
2. In `illustrate.py` (Team 1's file) — After generating:
   - Write to Firestore: `/sessions/{sessionId}/illustrations/{id}` with query, caption, imageUrl, gcsUri, segmentId, createdAt
   - Append imageUrl to segment's imageUrls array via Firestore `arrayUnion`
   - Emit SSE event to session log (import `get_session_event_log` pattern from pipeline.py)
3. `frontend/src/hooks/useSSE.ts` — Add handler for `live_illustration` SSE event type:
   - Update segment imageUrls in researchStore
   - Set liveIllustration in playerStore if it's the active segment

### Team 5: Polish
1. `backend/live_relay/prompt-builder.js` — Add to system instruction:
   ```
   When a viewer asks about something visual (places, events, people, objects),
   naturally mention you're creating an illustration. Say "Let me paint that
   picture for you..." or "Imagine this scene..." to prime the viewer.
   ```
2. CSS: illustration caption styling — gold italic Cormorant Garamond, text-shadow for readability on dark backgrounds
3. Loading shimmer: golden box-shadow pulse keyframe on KenBurnsStage while waiting for illustration

### Critical constraints
- NEVER block the historian's audio stream. Illustration generation is fire-and-forget.
- Use `pnpm` not npm. No `any` types. `strict: true` TypeScript.
- Follow existing patterns: Pydantic v2 for request/response models, Motion v12 for animations, Zustand for state
- Reference CLAUDE.md for all coding standards
- The Gemini interleaved call MUST use `response_modalities=["TEXT", "IMAGE"]` — this is the mandatory tech requirement for the Creative Storyteller category

### Execution strategy
Run Teams 1, 2, and 3 in parallel using subagents (they're independent). Team 3 can use a mock `{ type: 'live_illustration', imageUrl: 'https://picsum.photos/1920/1080', caption: 'Test illustration' }` for development. Team 4 runs after Team 1 is complete. Team 5 runs last.

## PROMPT END
