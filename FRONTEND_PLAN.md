# Frontend Plan — AI Historian

## Tech Stack

| Tool | Version | Role |
|---|---|---|
| React | 19 | UI framework |
| Vite | 6 | Build tool |
| TypeScript | strict | Language |
| Tailwind CSS | v4 | Styling (maps directly to parchment CSS variables from prototype) |
| Zustand | 5 | Client state (session, research agents, voice, player) |
| TanStack Query | v5 | Server state + SSE stream management |
| Framer Motion | v11 | Ken Burns animations, page transitions, waveform |
| Radix UI | latest | Accessible modal primitives (Agent Session Modal) |
| pdfjs-dist | latest | PDF rendering in viewer |
| pnpm | — | Package manager |

---

## Three Screens

```
Upload → Workspace (split layout) → Documentary Player
```

**Upload** — drag-and-drop zone, format badges, language tags, upload progress

**Workspace** — left: PDF viewer (scrollable, entity highlighting) / right: Historian Live panel + Research Activity panel + Segment cards

**Player** — full-screen cinematic: Ken Burns visuals / Veo 2 video, caption track, sidebar, always-on voice button

---

## Directory Structure

```
frontend/
  src/
    components/
      upload/        ← DropZone, FormatBadge
      workspace/     ← WorkspaceLayout, PDFViewer, HistorianPanel,
                        ResearchPanel, AgentModal, SegmentCard
      player/        ← DocumentaryPlayer, KenBurnsStage,
                        CaptionTrack, PlayerSidebar
      voice/         ← VoiceButton, Waveform, LiveToast
      ui/            ← Button, Badge, Spinner, Modal (shared primitives)
    hooks/
      useSession.ts       ← session lifecycle
      useSSE.ts           ← agent progress stream
      useAudioCapture.ts  ← mic → PCM pipeline
      useAudioPlayback.ts ← PCM chunk queue → Web Audio API
      useVoiceState.ts    ← voice button state machine
      useGeminiLive.ts    ← WebSocket session (Berkay's domain, UI hooks)
    store/
      sessionStore.ts     ← Zustand: sessionId, document, status
      researchStore.ts    ← Zustand: per-agent states, segment states
      voiceStore.ts       ← Zustand: voice button state machine
      playerStore.ts      ← Zustand: current segment, playback state
    services/
      api.ts              ← REST calls to backend
      upload.ts           ← GCS signed URL upload
    types/
      index.ts            ← ALL shared TypeScript types (contract file)
    pages/
      UploadPage.tsx
      WorkspacePage.tsx
      PlayerPage.tsx
    App.tsx
    main.tsx
```

---

## Agent Team (5 agents, run simultaneously)

### Communication Protocol
Agent 1 runs first and writes `src/types/index.ts` + store skeletons + Tailwind config. Agents 2–5 all read that contract before writing a single component. This keeps all agents in sync without conflicts.

### Agent Assignments

| Agent | Role | Owns |
|---|---|---|
| **Agent 1 — Design System** | UI/UX | Vite scaffold, Tailwind config, CSS variables (parchment theme), `types/index.ts`, Zustand store skeletons, shared `ui/` primitives |
| **Agent 2 — Upload + Layout** | Frontend Dev | `UploadPage`, `WorkspaceLayout`, `TopNav`, page routing, `PDFViewer` |
| **Agent 3 — Research UI** | Frontend Dev | `ResearchPanel`, `AgentModal`, `SegmentCard`, `useSSE` hook, TanStack Query integration |
| **Agent 4 — Voice & Audio** | Frontend Dev | `VoiceButton` state machine, `Waveform` canvas, `LiveToast`, `useAudioCapture`, `useAudioPlayback`, `useVoiceState` |
| **Agent 5 — Documentary Player** | Frontend Dev | `DocumentaryPlayer`, `KenBurnsStage`, `CaptionTrack`, `PlayerSidebar`, Framer Motion animations |

### Execution Order
1. **Agent 1** completes foundation (types contract + scaffold) — others wait for this output
2. **Agents 2, 3, 4, 5** run fully in parallel against the shared contract

---

## Design Tokens (from prototype.html)

```css
:root {
  --bg:     #F2EDE3;
  --bg2:    #EBE4D8;
  --bg3:    #E2D9CA;
  --bg4:    #D6CCBA;
  --gold:   #8B5E1A;
  --gold-d: #5C3D0E;
  --text:   #1E170C;
  --muted:  #8A7A62;
  --green:  #2E6E44;
  --teal:   #1E5E5E;
}
/* Documentary player always stays dark regardless of app theme */
```

---

## State Shape (Zustand Stores)

### sessionStore
```ts
{
  sessionId: string | null
  gcsPath: string | null
  status: 'idle' | 'uploading' | 'processing' | 'ready'
  language: string | null
  visualBible: string | null
}
```

### researchStore
```ts
{
  agents: Record<string, {
    id: string
    query: string
    status: 'queued' | 'searching' | 'done'
    logs: AgentLog[]
    elapsed: number
  }>
  segments: Record<string, {
    id: string
    title: string
    status: 'generating' | 'ready'
    imageUrls: string[]
    videoUrl?: string
    script: string
    mood: string
  }>
}
```

### voiceStore
```ts
{
  state: 'idle' | 'listening' | 'processing' | 'historian_speaking' | 'interrupted'
  resumeSegmentId: string | null
  resumeOffset: number
}
```

### playerStore
```ts
{
  isOpen: boolean
  currentSegmentId: string | null
  playbackOffset: number
  captionText: string
  isKenBurnsPaused: boolean
}
```

---

## Key Components — Behaviour Spec

### VoiceButton
Five states with distinct visuals:
- `idle` — static mic icon, gold border
- `listening` — pulsing ring animation, "Listening..." label
- `processing` — spinner on button
- `historian_speaking` — waveform ring animation
- `interrupted` — flash → transitions to listening

Always rendered fixed-position. Visible on Workspace and Player. Hidden on Upload screen.

### ResearchPanel
- Subscribes to SSE via `useSSE` hook
- Each agent card: status icon + query title + elapsed timer
- Status transitions: queued (grey) → searching (gold pulse) → done (green check)
- Staggered card entry (50ms delay per card)
- Click → opens AgentModal

### AgentModal
- Radix UI Dialog
- Fetches full log from Firestore via `useSession`
- **Running agent:** entries appear with typewriter animation at live pace
- **Done agent:** entries replay at 150ms per entry (review mode)
- Log entry format: icon + step description + timestamp

### KenBurnsStage
- 4 Imagen 3 images cycle (one active at a time)
- CSS `@keyframes`: `scale(1.0) → scale(1.12)` + `translate` over 12s
- Crossfade between images: opacity transition over 2s at the 10s mark
- Random start position per image (top-left, center, top-right, bottom-left)
- If `videoUrl` exists for segment: swap to `<video autoplay muted loop>`
- Pauses (`animation-play-state: paused`) when voiceStore.state is `listening` or `processing`

### PDFViewer
- `pdfjs-dist` renders GCS document URL
- Scrollable, zoom in/out controls
- After Scan Agent: entity terms highlighted via pdf.js text layer
- Always visible — never replaced during research pipeline

---

## Routing

```
/              → UploadPage
/workspace     → WorkspacePage  (redirects to / if no sessionId)
/player/:seg   → PlayerPage     (redirects to /workspace if no session)
```

React Router v6 with `createBrowserRouter`.

---

## API Integration Points

| Hook / Service | Calls |
|---|---|
| `upload.ts` | `GET /api/session/create` → signed GCS URL → `PUT` to GCS |
| `useSession` | `GET /api/session/:id/status` |
| `useSSE` | `GET /api/session/:id/stream` (SSE) |
| `useGeminiLive` | `wss://live-relay/session/:id` (WebSocket) |
| `AgentModal` | `GET /api/session/:id/agent/:agentId/logs` |

All backend URLs configurable via `VITE_API_BASE_URL` env variable.

---

## Status
- [ ] Awaiting approval
- [ ] Agent 1 — Design System foundation
- [ ] Agents 2–5 — Parallel implementation
- [ ] Integration pass
- [ ] Final review
