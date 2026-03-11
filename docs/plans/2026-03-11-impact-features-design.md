# Impact Features Design — AI Historian
**Date:** 2026-03-11
**Status:** Approved
**Author:** Efe
**Scope:** 5 new high-impact features targeting Innovation & Multimodal UX (40% judging weight)

---

## Features

1. **Documentary Branching Graph** — user questions during playback spawn new research mini-runs and branch the documentary tree
2. **Narration-Synchronized PDF Highlighting** — entities in narration light up in the PDF viewer in real-time as the historian speaks
3. **Grounding Evidence Panel** — collapsible player sidebar panel surfacing verified sources per segment with confidence badges
4. **Historian Persona Selector** — 3 selectable historian personalities (Professor / Storyteller / Field Researcher) on upload screen
5. **Shareable Clip Generator** — per-segment MP4 clip with TTS audio + images + captions, downloadable from the player

---

## Team Structure: Wave-Based Parallel Execution

### Wave 1 — Team 0: Shared Infrastructure (runs first, ~30 min)

Defines all contracts before any feature team starts to prevent merge conflicts.

**New TypeScript types (`types/index.ts`):**
```ts
type PersonaType = 'professor' | 'storyteller' | 'explorer'

interface BranchNode {
  segmentId: string
  parentSegmentId: string | null
  triggerQuestion: string
  depth: number
  createdAt: string
}

interface EntityHighlight {
  text: string
  segmentId: string
  pageNumber: number
  charOffset: number
}

interface GroundingSource {
  url: string
  title: string
  relevanceScore: number  // 0–1
  acceptedBy: string[]    // agentIds that accepted this source
}

interface ClipStatus {
  clipId: string
  status: 'queued' | 'generating' | 'ready' | 'error'
  downloadUrl?: string
  segmentId: string
}
```

**New SSE event types (`sse_helpers.py`):**
- `branch_triggered` — `{ question, sessionId }`
- `branch_segment_ready` — `{ segmentId, parentSegmentId, triggerQuestion }`

**Firestore schema additions:**
- `/sessions/{id}`: add `persona: PersonaType`
- `/sessions/{id}/segments/{id}`: add `parentSegmentId?`, `triggerQuestion?`, `entityHighlights?`
- `/sessions/{id}/clips/{clipId}`: new subcollection — `{ status, segmentId, downloadUrl?, createdAt }`

**API stubs (empty handlers, fill in Wave 2):**
- `POST /api/session/:id/branch`
- `POST /api/session/:id/clips`
- `GET /api/session/:id/clips/:clipId`
- `GET /api/session/:id/segments/:segId/sources`

---

### Wave 2 — 6 Teams in Parallel (unblocked after Team 0)

#### Team 1 — Documentary Branching Graph

**Backend (`agent_orchestrator/`):**
- `branch_pipeline.py`: lightweight pipeline — `build_branch_pipeline(emitter, question, session_id)` reusing `SceneResearchAgent` (1 researcher) + `ScriptAgentOrchestrator` capped to 1 segment; writes new segment to Firestore with `parentSegmentId` + `triggerQuestion`
- `historian-api/routes/session.py`: implement `POST /api/session/:id/branch` — accepts `{ question: string }`, triggers `build_branch_pipeline` as background task, returns `{ segmentId }`

**`live-relay` (Node.js):**
- Detect `generationComplete: true` after `serverContent.interrupted === true` sequence → HTTP POST to `historian-api/branch` with question text extracted from prior user audio transcript

**Frontend:**
- `components/player/BranchTree.tsx` — tree visualization: main thread segments + branched segments indented with connector line; Motion `AnimatePresence` for new branch arrival
- `playerStore.ts`: add `branchGraph: BranchNode[]`, `activeBranchId: string | null`
- `PlayerSidebar.tsx`: integrate BranchTree below segment list
- `useGeminiLive.ts`: expose `lastUserTranscript` for branch trigger

---

#### Team 2 — Narration-Synchronized PDF Highlighting

**Backend (`agent_orchestrator/`):**
- `entity_extractor.py`: async function `extract_entities(narration_script, page_texts) → list[EntityHighlight]` — Gemini 2.0 Flash call with structured output; called at end of `ScriptAgentOrchestrator._run_async_impl` for each segment
- `script_agent_orchestrator.py`: after writing segment to Firestore, call `extract_entities` and write `entityHighlights` array to segment doc

**Frontend:**
- `hooks/usePDFHighlights.ts` — subscribes to `playerStore.currentSegmentId`; fetches highlights from Firestore via `researchStore`; applies via pdfjs-dist text layer
- `components/workspace/PDFViewer.tsx` — add annotation layer: gold highlight (`rgba(139, 94, 26, 0.25)`) on matching text spans; animate on/off with CSS transition
- `store/researchStore.ts` — add `entityHighlights: Record<string, EntityHighlight[]>`

---

#### Team 3 — Grounding Evidence Panel

**Backend (`historian-api/`):**
- `routes/session.py`: implement `GET /api/session/:id/segments/:segId/sources` — reads `/sessions/{id}/visualManifests/{sceneId}` from Firestore (already written by Phase IV `VisualResearchOrchestrator`), returns `GroundingSource[]` sorted by `relevanceScore` desc

**Frontend:**
- `components/player/SourcePanel.tsx` — collapsible panel; each source: favicon + title + URL + relevance badge (≥0.8 → "High" green, 0.5–0.8 → "Medium" gold, <0.5 → "Low" muted); Radix `Collapsible`
- `PlayerSidebar.tsx`: add SourcePanel below segment metadata
- `hooks/useGroundingSources.ts` — fetches sources on `currentSegmentId` change via TanStack Query
- `components/workspace/SegmentCard.tsx`: add source count badge (`{n} sources`)

---

#### Team 4 — Historian Persona Selector

**Backend (`live-relay/`):**
- `personas.js`: 3 system prompt templates keyed by `PersonaType`; exported as `PERSONA_PROMPTS`
- `index.js` (live-relay main): on WebSocket session setup, read `persona` from Firestore session doc → inject corresponding `PERSONA_PROMPTS[persona]` into `BidiGenerateContentSetup.systemInstruction`

**Backend (`historian-api/`):**
- `routes/session.py`: accept `persona: PersonaType` in `POST /api/session/create`; write to Firestore session doc

**Frontend:**
- `components/upload/PersonaSelector.tsx` — 3 visual cards with icon, name, 1-line description, hover spring scale; gold border on selected
- `UploadPage.tsx` — render `PersonaSelector` above the drop zone
- `store/sessionStore.ts` — add `persona: PersonaType`, default `'professor'`
- `services/upload.ts` — pass `persona` in session creation payload

**Persona prompts (3 variants):**
- **Professor** — formal BBC narrator, cites sources, structured delivery
- **Storyteller** — dramatic, narrative-forward, Ken Burns intimacy
- **Field Researcher** — first-person exploratory, conversational, improvised feel

---

#### Team 5 — Shareable Clip Generator

**Backend (`historian-api/`):**
- `clip_generator.py`:
  1. Download 4 segment images from GCS
  2. Generate TTS narration audio via `google.genai` (Gemini 2.5 Flash, `responseModalities=["AUDIO"]`, non-live)
  3. `ffmpeg` pipeline: images slideshow (Ken Burns filter) + audio → 720p MP4
  4. Upload to GCS `/sessions/{id}/clips/{clipId}.mp4`
  5. Write `ClipStatus(status='ready', downloadUrl=signed_url)` to Firestore
- `routes/session.py`: implement `POST /api/session/:id/clips` (async background task → returns `clipId`), `GET /api/session/:id/clips/:clipId` (returns `ClipStatus`)

**Frontend:**
- `components/player/ShareButton.tsx` — "Share Clip" button in player controls bar; icon: share arrow
- `hooks/useClipGeneration.ts` — POST `/clips` → poll `GET /clips/:clipId` every 3s → `toast.promise()` for progress; on ready: trigger download via `<a download>`
- `components/player/DocumentaryPlayer.tsx` — add ShareButton to controls row

---

#### Team 6 — Quick Wins + Demo Seed

**Demo Seed:**
- Select a visually rich public-domain historical document (Ottoman palace manuscript or Egyptian papyrus)
- Pre-run pipeline, store final session in Firestore under a fixed `DEMO_SESSION_ID`
- `UploadPage.tsx` — "Try with demo document →" link below the drop zone

**Source Badge:**
- `SegmentCard.tsx` — source count badge (wired by Team 3 contract)

**Live Agent Counter:**
- `ExpeditionLog.tsx` — "N agents working in parallel" counter, increments on each `agent_status: searching` SSE event

**Research Panel Footer:**
- `ResearchPanel.tsx` — sticky footer: `SOURCES FOUND · FACTS VERIFIED · SEGMENTS READY` stat bar (already partially present, make it always visible)

---

## Dependency Graph

```
Team 0 (types + stubs)
  └── Team 1 (branching)         — backend + live-relay + frontend BranchTree
  └── Team 2 (PDF highlighting)  — entity extractor + PDFViewer layer
  └── Team 3 (grounding panel)   — sources API + SourcePanel
  └── Team 4 (persona selector)  — prompts + live-relay + upload UI
  └── Team 5 (clip generator)    — clip API + ShareButton
  └── Team 6 (quick wins)        — UploadPage + SegmentCard + ExpeditionLog

Within Team 1: branch endpoint must exist before BranchTree frontend can test
Within Team 2: entity extraction must run before PDF annotations appear
Within Team 5: clip API must exist before ShareButton can function
```

---

## Files Changed Per Team

| Team | Backend files | Frontend files |
|---|---|---|
| 0 | `sse_helpers.py` | `types/index.ts` |
| 1 | `branch_pipeline.py`, `routes/session.py`, `live-relay/index.js` | `BranchTree.tsx`, `playerStore.ts`, `PlayerSidebar.tsx`, `useGeminiLive.ts` |
| 2 | `entity_extractor.py`, `script_agent_orchestrator.py` | `usePDFHighlights.ts`, `PDFViewer.tsx`, `researchStore.ts` |
| 3 | `routes/session.py` | `SourcePanel.tsx`, `PlayerSidebar.tsx`, `useGroundingSources.ts`, `SegmentCard.tsx` |
| 4 | `personas.js`, `live-relay/index.js`, `routes/session.py` | `PersonaSelector.tsx`, `UploadPage.tsx`, `sessionStore.ts`, `upload.ts` |
| 5 | `clip_generator.py`, `routes/session.py` | `ShareButton.tsx`, `useClipGeneration.ts`, `DocumentaryPlayer.tsx` |
| 6 | Firestore seed script | `UploadPage.tsx`, `SegmentCard.tsx`, `ExpeditionLog.tsx`, `ResearchPanel.tsx` |
