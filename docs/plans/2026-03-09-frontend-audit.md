# Frontend Audit — 2026-03-09

## Current State

**Quality: Production-grade.** Clean TypeScript, zero build errors, proper architecture throughout.
Build output: 958KB JS (gzipped 294KB), 36KB CSS — no type errors.

All 50 source files present and compiling cleanly (`tsc && vite build` passes with zero errors).

---

## What Is Fully Working

- Type contract (`src/types/index.ts`) — complete, covers all SSE event types and store shapes
- All 4 Zustand stores — fully typed with correct actions (`sessionStore`, `researchStore`, `voiceStore`, `playerStore`)
- `useSSE` — 150ms drip buffer, all event types handled, wired to store
- `SegmentCard` — cipher/decode title reveal, magnetic pull CTA, skeleton→content morph
- `KenBurnsStage` — image cycling, video swap, pause on voice activity
- `ResearchPanel` — 5-state agent cards, spotlight glow halo, animated conic-gradient border
- `AgentModal` — source evaluation shimmer, log entry stagger
- `ExpeditionLog` — phase markers, typewriter entries, stats accumulation bar
- `VoiceButton` — 5-state visuals, waveform canvas, fallback dot-pulse
- `DocumentaryPlayer` — full-screen layout, vignette layers, auto-hide chrome
- `KenBurnsStage` — Ken Burns CSS animation, crossfade, `<video>` swap
- `IrisOverlay` — `@property --iris-r` animated radial mask transition
- Dev seed bar in `UploadPage` — lets all screens be tested without a live backend

---

## Phase 1 — Type Contract Fixes (Critical)

**Gaps covered: 1, 2, 3**
**Files: `src/types/index.ts`**

Run `pnpm build` after this phase to confirm zero type errors before touching any component.

| Gap | Problem | Fix |
|---|---|---|
| **1** | `SegmentStatus` union is `'generating' \| 'ready'` but backend Phase V now emits `status: 'complete'` | Add `'complete'` to the union |
| **2** | `PipelinePhaseEvent.phase` typed as `1\|2\|3\|4` but Phase V emits `phase: 5` | Extend union to `1\|2\|3\|4\|5` |
| **3** | `StatsUpdateEvent` only has `sourcesFound/factsVerified/segmentsReady` — Phase V also emits `imagesGenerated/videosGenerated` | Add optional `imagesGenerated?: number` and `videosGenerated?: number` fields |

---

## Phase 2 — SSE & Store Handlers

**Gaps covered: 1, 2, 3 (follow-through)**
**Files: `src/hooks/useSSE.ts`, `src/store/researchStore.ts`**

After Phase 1 types land, the TypeScript compiler will surface every handler that needs updating. Fix all switch/conditional branches that reference `SegmentStatus`, `PipelinePhaseEvent.phase`, or `StatsUpdateEvent` fields.

- `useSSE.ts` — handle `status: 'complete'` in the `segment_update` branch; pass through new stats fields
- `researchStore.ts` — update any conditional on `SegmentStatus` values to cover `'complete'`

---

## Phase 3 — Component Updates

**Gaps covered: 2, 3, 5, 6**
**Files: `src/components/workspace/ExpeditionLog.tsx`, `src/components/workspace/ResearchPanel.tsx`, `src/components/workspace/SegmentCard.tsx`**

### ExpeditionLog.tsx (gap 2)

Add Phase V label. The phase → label map needs one new entry:

```
5 → "GENERATION"
```

### ResearchPanel.tsx (gaps 3, 5)

- **Stats bar** — display `imagesGenerated` and `videosGenerated` counts once the optional fields are populated.
- **`agentPhase()` mapper** — extend prefix matching to cover Phase IV and V agent ID patterns:
  - `visual_research_scene_*` → Phase IV
  - `visual_director_scene_*` → Phase V

### SegmentCard.tsx (gap 6)

- Map `status: 'complete'` to the same ready visual state as `'ready'`.
- Gate the "Watch Documentary" button on `imageUrls.length > 0` (not just status).

---

## Phase 4 — Document URL Trace

**Gap covered: 4**
**Files: `src/hooks/useSession.ts`, `src/components/workspace/PDFViewer.tsx`**

Verify that `documentUrl` flows end-to-end:

1. `useSession` polling — confirm `SessionStatusResponse` includes `documentUrl`
2. `sessionStore` — confirm the store action maps and stores the field
3. `PDFViewer.tsx` — confirm it reads `documentUrl` from the store (not a prop or local state)

No new logic expected; this is a tracing pass that fixes whichever link in the chain is broken.

---

## Phase 5 — Bundle Splitting

**Gap covered: 7**
**Files: `vite.config.ts`**

Bundle is 958KB (Vite warns above 500KB). `pdfjs-dist` and `motion` are the primary contributors.

Add `build.rollupOptions.output.manualChunks` to split them into separate async chunks:

```ts
manualChunks: {
  'pdf': ['pdfjs-dist'],
  'motion': ['motion'],
}
```

This defers both libraries until the routes that need them are loaded, dropping the initial bundle well below the 500KB threshold.

---

## Execution Order

```
Phase 1 → pnpm build (must pass)
Phase 2 → pnpm build (must pass)
Phase 3 → pnpm build (must pass)
Phase 4 → pnpm build (must pass)
Phase 5 → pnpm build (must pass, check chunk sizes in output)
```

None of these require new components. All are type fixes, store handler updates, and one config change.
