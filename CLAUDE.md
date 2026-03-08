# CLAUDE.md — AI Historian Project Guide

## Working Philosophy

This project is treated as a **production-grade product**, not a hackathon prototype. Every component — voice interaction latency, agent log readability, documentary visual quality, error handling, code structure, animation timing, typography hierarchy — is built to the highest standard possible.

Do not suggest shortcuts, reduced scope, or "good enough for a hackathon" trade-offs. Do not add phrases like "for a hackathon this is fine" or "you don't need to go this deep." The team manages their own priorities and time. Focus entirely on how to build each thing **correctly and beautifully**.

**Frontend rule:** Every time a new frontend feature, animation, component, or library is added, this file must be updated to reflect it. The Frontend section of this document is the single source of truth for the frontend stack.

---

## What This Project Is

**AI Historian** is a real-time multimodal research and documentary engine. A user uploads any historical document in any language. AI agents immediately begin researching it in parallel while the user reads the document. The research feeds a generative documentary pipeline — cinematic visuals, narration, and a living historian persona the user can speak to and interrupt at any moment, mid-playback.

### What makes it distinct

| Dimension | AI Historian |
|---|---|
| **Interaction model** | Not a chatbot. Not a video editor. A live AI persona that researches, narrates, and converses simultaneously |
| **Input** | Any historical document — PDF, image, scanned manuscript — in any language including dead scripts |
| **Output** | A self-generating documentary: cinematic visuals (Imagen 3 + Veo 2), AI narration (Gemini 2.5 Flash Native Audio), and live voice conversation |
| **Real-time** | Research pipeline runs while the user reads the document. First segment playable in < 45 seconds |
| **Interruption** | User speaks mid-documentary. Historian stops mid-sentence, answers, resumes. < 300ms latency |
| **Adaptation** | The documentary graph branches based on user questions. No two sessions produce the same documentary |

The system is the first to combine: **live OCR multilingually → parallel AI research with grounding → generative cinematic visuals → always-on live voice persona** in a single seamless flow.

---

## The Competition

| Field | Value |
|---|---|
| **Hackathon** | Gemini Live Agent Challenge |
| **Organizer** | Google LLC, administered by Devpost |
| **Submission Deadline** | March 16, 2026 at 5:00 PM PT |
| **Winners Announced** | April 22–24, 2026 — Google Cloud NEXT, Las Vegas |
| **Total Prize Pool** | $80,000 |
| **Registered Participants** | 7,590+ |
| **Submission page** | https://geminiliveagentchallenge.devpost.com/ |

**Target prizes:**
- Grand Prize: $25,000 + $3,000 cloud credits + 2× NEXT 2026 tickets + 2× $3,000 travel stipends + demo opportunity
- Best Creative Storytellers: $10,000 + $1,000 cloud credits + 2× NEXT 2026 tickets

---

## Competition Categories

Three categories exist. This project targets **Creative Storytellers** as primary.

### Creative Storytellers (Primary)
Agents that weave text, images, audio, and video in seamless interleaved output streams. The focus is on fluid multimodal narrative where media types flow together naturally, not sequentially. AI Historian generates all four modalities simultaneously from a single historical document.

### Live Agents (Secondary Strength)
Real-time voice interaction agents with natural conversation and interruption handling. The Historian persona is always-on, always listening, and responds without breaking the documentary experience.

### UI Navigators (Not Applicable)
Visual screen interpretation and automated action execution. Not relevant to this project.

---

## Judging Criteria

Scores are 1–5 per criterion, weighted. Bonus points (up to +1.0) are added to the final weighted score. Final range: 1.0–6.0.

### Innovation & Multimodal User Experience — 40%
The most heavily weighted criterion. Judges look for:
- Breaking the "text box" paradigm entirely
- Natural, immersive, non-chat interaction
- Seamless interleaving of text, image, audio, and video in a single coherent flow
- Distinct AI persona with live context-awareness
- For Creative Storytellers specifically: fluid media interleaving in a coherent narrative

**Every UI and UX decision must be made with this 40% weight in mind.**

Design decisions that directly serve this criterion:
- The iris reveal transition signals "cinematic product" to judges in 1.2 seconds
- Audio-reactive Ken Burns animation (driven by AnalyserNode) makes visuals breathe with the historian's voice
- The Expedition Log loading pattern turns pipeline waiting into the *first act of the documentary*
- Word-by-word caption reveal bridging text and narration is a live multimodal effect

### Technical Implementation & Agent Architecture — 30%
- Effective, correct use of Google GenAI SDK or ADK
- Robust Google Cloud hosting (Cloud Run, Vertex AI, Firestore)
- Sound multi-agent logic and orchestration
- Graceful error handling and edge case management
- Hallucination avoidance with grounding evidence (Google Search Grounding)

### Demo & Presentation — 30%
- Clear problem definition and solution narrative
- Legible, accurate architecture diagram
- Visual proof of Google Cloud deployment
- Actual working software demonstrated — no mockups, no slides pretending to be UI

**Tie-breaking:** Judges compare criteria scores in listed order. Judge decisions are final.

---

## Mandatory Requirements (Failure = Disqualification)

1. **Uses a Gemini model** — Gemini 2.0 Flash, Gemini 2.0 Pro, and Gemini 2.5 Flash Native Audio are all used
2. **Uses Google GenAI SDK or ADK** — raw REST API calls to Gemini are not sufficient; must use the official SDK or ADK
3. **At least one Google Cloud service** — Cloud Run, Firestore, GCS, Document AI, Pub/Sub, Vertex AI
4. **Backend hosted on Google Cloud** — Cloud Run is the primary hosting platform
5. **Project newly created during the contest period** (Feb 16 – Mar 16, 2026)
6. **Public code repository** — https://github.com/pancodo/gemini-live-agent-challenge — complete setup instructions in README
7. **Architecture diagram** — shows: User/Frontend, Gemini model location and access method, backend logic on Google Cloud, all component connections
8. **Demo video** — ≤ 4 minutes, publicly hosted on YouTube or Vimeo, English (or subtitled), actual working software
9. **Proof of Google Cloud deployment** — screen recording of GCP console or GitHub links to Google Cloud service API calls

---

## Bonus Points (All Pursued)

| Bonus | Points | Requirement |
|---|---|---|
| Published content (blog/podcast/video) about building with Google AI/Cloud | **+0.6** | Must include `#GeminiLiveAgentChallenge` hashtag and hackathon disclosure |
| Automated Cloud deployment (IaC scripts in public repo) | **+0.2** | Terraform in `terraform/` — `terraform apply` must provision all infrastructure |
| Active Google Developer Group (GDG) membership | **+0.2** | Both team members join GDG, provide public profile links in submission |

The +0.6 blog post bonus is the single largest lever in the entire scoring system — equivalent to 12% of a 5-point base score. Both team members write their posts while building, not after.

---

## Team

**Berkay** — Live Voice Layer & Real-Time Interaction
Owns everything that touches the Gemini Live API: live-relay Cloud Run service (Node.js WebSocket proxy), browser audio capture (PCM encoding), audio playback pipeline, interruption handling, voice button state machine, historian persona system prompt, and session resumption.

**Efe** — Research Pipeline, Agent Visualization & Documentary Engine
Owns everything that touches document processing and content generation: Document AI OCR, ADK Scan Agent, ADK Parallel Research Pipeline, Research Activity panel, Agent Session Modal, Script Generation Agent, Visual Director Agent (Imagen 3 + Veo 2), segment streaming, and the documentary player.

**Detailed task breakdown:** See `TASKS.md`
**Technology links and documentation:** See `RESOURCES.md`
**Full frontend specification:** See `FRONTEND_PLAN.md`

---

## Full Tech Stack

### AI Models

| Model | Use |
|---|---|
| `gemini-2.5-flash-native-audio-preview-12-2025` | Historian persona (Gemini Live API) |
| `gemini-live-2.5-flash-native-audio` | Historian persona (Vertex AI path) |
| `gemini-2.0-flash` | Scan Agent, Research Subagents |
| `gemini-2.0-pro` | Script Generation Agent |
| `imagen-3.0-fast-generate-001` | Scene images (200 req/min, ~5s each) |
| `veo-2.0-generate-001` | Dramatic video clips (async, 1–2 min each) |

⚠️ `gemini-2.0-flash-live-001` was **shut down December 9, 2025** — never use this model ID.

---

### Google Cloud Services

| Service | Role |
|---|---|
| Cloud Run | All backend services (Python 3.12 + Node.js 20) |
| Vertex AI | Imagen 3, Veo 2, Gemini model hosting |
| Firestore | Session state, agent logs, documentary graph |
| Cloud Storage (GCS) | Uploaded documents, generated images, MP4 videos |
| Document AI | Multilingual OCR (`OCR_PROCESSOR`) |
| Pub/Sub | Async agent event messaging |
| Secret Manager | API keys, service credentials |

---

### Agent Framework (Python, Backend)

| Package | Version | Role |
|---|---|---|
| `google-adk` | latest | Agent orchestration — SequentialAgent, ParallelAgent, Agent |
| `google-genai` | latest | Gemini model calls, Imagen 3, Veo 2 |
| `google-cloud-documentai` | latest | OCR processing |
| `fastapi` | 0.115+ | HTTP API gateway, SSE streaming |
| `uvicorn` | latest | ASGI server |
| `pydantic` | v2 | Request/response models with strict typing |

---

### Frontend Stack

The frontend is a **cinematic application layer** — not a generic web interface. Every library, animation, and interaction pattern was chosen to serve the product's documentary identity and maximize the 40% Innovation & Multimodal UX judging criterion.

#### Core Framework

| Package | Version | Role |
|---|---|---|
| **React** | 19 | UI framework — concurrent rendering, `useOptimistic`, `use()` hook for SSE |
| **Vite** | 6 | Build tool — instant HMR, ESBuild transforms, sub-second cold starts |
| **TypeScript** | 5.x, strict | Language — `strict: true`, no `any`, full type safety |
| **React Router** | v6 | Client-side routing — `createBrowserRouter`, data loaders |

#### Styling

| Package | Version | Role |
|---|---|---|
| **Tailwind CSS** | v4 | Utility-first styling — CSS-first config (no `tailwind.config.js`), Lightning CSS engine, CSS variables integration with design tokens |

Tailwind v4 changes from v3:
- Configuration lives in CSS (`@theme { }` block), not a JS config file
- Uses Lightning CSS for transforms and vendor prefixes automatically
- CSS custom properties from the design token system map directly to Tailwind utilities
- Dramatically faster build times vs v3

#### State Management

| Package | Version | Role |
|---|---|---|
| **Zustand** | 5 | Client state — `sessionStore`, `researchStore`, `voiceStore`, `playerStore` |
| **TanStack Query** | v5 | Server state — REST polling, SSE stream management via `useInfiniteQuery` |

Zustand 5 changes from v4:
- Signals-based subscriptions — components only re-render when their exact slice changes
- Built-in `immer` middleware support for immutable updates
- `useShallow` for stable selector references

#### Animation & Motion

| Package | Version | Role |
|---|---|---|
| **Motion** (Framer Motion) | 12.x | All React animations — springs, gestures, layout animations, `AnimatePresence`, `useMotionValue`, `useSpring`, `useTransform` |

Motion v12 key capabilities used in this project:
- `spring` transitions with `stiffness`/`damping` physics on every interactive element
- `AnimatePresence mode="wait"` for icon morphing (spinner → checkmark → error)
- `variants` + `staggerChildren` for research panel card cascades
- `useScroll` + `useTransform` for parallax in documentary player
- `whileInView` with `viewport={{ once: true }}` for scroll-triggered reveals
- `layoutId` for shared-element transitions between states

Native browser APIs used alongside Motion:
- **CSS `@property`** — animates custom properties through gradients (iris mask, rotating border angle)
- **View Transitions API** — segment-to-segment transitions in Chrome/Edge/Firefox 144+/Safari 18+
- **CSS scroll-driven animations** (`animation-timeline: view()`) for passive scroll reveals
- **Web Animations API** — imperative animations where React lifecycle is inconvenient

#### Accessible Primitives

| Package | Version | Role |
|---|---|---|
| **Radix UI** | latest | Headless accessible components — `Dialog` (AgentModal), `Tooltip`, `VisuallyHidden` |

#### Document Rendering

| Package | Version | Role |
|---|---|---|
| **pdfjs-dist** | latest | PDF rendering in viewer — text layer extraction for entity highlighting |

#### Notifications

| Package | Version | Role |
|---|---|---|
| **Sonner** | 2.x | Toast notifications — the Vercel/Cursor standard. CSS transitions (not keyframes), stacking depth, swipe-to-dismiss, progress variant, `toast.promise()` for async agent operations |

#### Audio

Native browser APIs only — no library required:

| API | Use |
|---|---|
| **Web Audio API — `AudioContext`** | Audio graph construction |
| **`MediaStream` + `AudioWorkletNode`** | Microphone capture → 16kHz PCM encoding |
| **`AudioBufferSourceNode`** | PCM chunk queue playback at 24kHz |
| **`AnalyserNode`** | Real-time frequency/waveform data for waveform visualizer and audio-reactive visuals |
| **`Canvas API`** | Waveform rendering (`quadraticCurveTo` for organic line style) |

#### Package Manager

`pnpm` — always. Never `npm` or `yarn`.

---

### Frontend Architecture

#### Three Screens

```
Upload → Workspace (split layout) → Documentary Player
```

**Upload** — Drag-and-drop zone, format badges, language tags, upload progress bar

**Workspace** — Left: PDF viewer (scrollable, entity highlighting) / Right: Historian Live panel + Research Activity panel (living agent cards) + Segment cards (skeleton-to-content morphing)

**Player** — Full-screen cinematic: Ken Burns visuals / Veo 2 video, caption track, player sidebar, always-on voice button. Auto-hides all chrome after 3s inactivity.

#### Directory Structure

```
frontend/
  src/
    components/
      upload/          ← DropZone, FormatBadge
      workspace/       ← WorkspaceLayout, PDFViewer, HistorianPanel,
                          ResearchPanel, AgentModal, SegmentCard
      player/          ← DocumentaryPlayer, KenBurnsStage,
                          CaptionTrack, PlayerSidebar
      voice/           ← VoiceButton, Waveform, LiveToast
      ui/              ← Button, Badge, Spinner, Modal, InkButton (shared primitives)
    hooks/
      useSession.ts         ← session lifecycle
      useSSE.ts             ← agent progress stream with 150ms drip buffer
      useAudioCapture.ts    ← mic → PCM pipeline
      useAudioPlayback.ts   ← PCM chunk queue → Web Audio API
      useVoiceState.ts      ← voice button state machine
      useGeminiLive.ts      ← WebSocket session
      useAudioVisualSync.ts ← AnalyserNode → CSS custom properties (audio-reactive visuals)
      useTextScramble.ts    ← cipher/decode text animation
    store/
      sessionStore.ts       ← Zustand: sessionId, document, status
      researchStore.ts      ← Zustand: per-agent states, segment states
      voiceStore.ts         ← Zustand: voice button state machine
      playerStore.ts        ← Zustand: current segment, playback state, idle timer
    services/
      api.ts                ← REST calls to backend
      upload.ts             ← GCS signed URL upload
    types/
      index.ts              ← ALL shared TypeScript types (contract file)
    pages/
      UploadPage.tsx
      WorkspacePage.tsx
      PlayerPage.tsx
    App.tsx
    main.tsx
```

#### Routing

```
/              → UploadPage
/workspace     → WorkspacePage  (redirects to / if no sessionId)
/player/:seg   → PlayerPage     (redirects to /workspace if no session)
```

#### API Integration

| Hook / Service | Endpoint | Protocol |
|---|---|---|
| `upload.ts` | `GET /api/session/create` → signed GCS URL → `PUT` to GCS | REST |
| `useSession` | `GET /api/session/:id/status` | REST |
| `useSSE` | `GET /api/session/:id/stream` | SSE (EventSource) |
| `useGeminiLive` | `wss://live-relay/session/:id` | WebSocket |
| `AgentModal` | `GET /api/session/:id/agent/:agentId/logs` | REST |

---

### Design System

#### Design Tokens (CSS Custom Properties)

```css
:root {
  /* Parchment palette */
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

  /* Cinematic dark (Documentary Player) */
  --bg-deep:   #0d0b09;
  --bg-card:   #1a1510;

  /* Interaction tokens */
  --glow-primary:   #c4956a;
  --glow-secondary: #d4a574;
  --shadow-warm:    rgba(139, 105, 20, 0.15);

  /* Audio-reactive (overridden dynamically by useAudioVisualSync) */
  --ken-speed:    28s;
  --glow-opacity: 0.5;
  --vig-spread:   110%;
}
/* Documentary player always dark regardless of app theme */
```

#### Typography

| Element | Font | Weight | Notes |
|---|---|---|---|
| App logo, section headers | Cormorant Garamond | 400 | 10–12px, uppercase, letter-spacing 0.3–0.5em |
| Segment titles | Cormorant Garamond | 400 | 18–22px |
| Documentary captions | Cormorant Garamond | 300 italic | 24–28px, letter-spacing 0.02em |
| Body text, descriptions | DM Sans | 400 | 13–14px |
| Status labels, metadata | DM Sans | 400 | 10–11px, uppercase, letter-spacing 0.1–0.25em |
| Agent log entries | DM Sans | 400 | 12–13px |
| Timestamps | DM Sans | 300 | 10px, tabular-nums |

Caption text-shadow (light text on dark, dual-layer for readability + bloom):
```css
text-shadow: 0 2px 28px rgba(0,0,0,0.9), 0 0 80px rgba(0,0,0,0.5);
```

---

### UI Polish & Micro-Interactions

This section summarizes the key interaction patterns. Full implementation specs live in `FRONTEND_PLAN.md § UI & UX Polish Layer`.

#### Global Atmosphere (always on)

- **Film grain overlay** — SVG `feTurbulence` filter at 2.5% opacity, `mix-blend-mode: multiply`, animated `grain-shift` keyframe (4-step, 0.5s). Adds tactile material quality to parchment backgrounds at a subconscious level.
- **Aurora gradient blobs** — Three blurred `border-radius: 50%` divs with `filter: blur(80px)`, drifting slowly via `@keyframes drift`. Applied on Upload + Workspace screens only. Hidden in documentary player.
- **`prefers-reduced-motion`** — All animations disabled or reduced globally. Motion's `useReducedMotion()` hook applied to all spring-based effects.

#### Loading Screen — "Expedition Log"

The research pipeline (OCR → Scan → Parallel Research → Synthesis → Visuals) is narrated as an expedition journal, not shown as a spinner.

- **Phase Markers** — Four named phases (TRANSLATION & SCAN, FIELD RESEARCH, SYNTHESIS, VISUAL COMPOSITION), each revealed when its pipeline stage begins
- **Self-drawing phase dividers** — Horizontal gold rules that scale from `scaleX(0)` to `scaleX(1)` with a centered ornament dot on phase transition
- **Typewriter log entries** — Each log entry types itself at 20ms/char with ±50% random jitter; uses cursor span that removes itself on completion
- **Staggered entry reveal** — Motion `staggerChildren: 0.08` with `y: 12, filter: blur(3px)` entrance and spring bounce
- **SSE drip rate** — Incoming SSE events buffered in a `pendingRef`, released at 150ms intervals to prevent visual overload from parallel agent bursts
- **Accumulation counter** — Stats bar showing `SOURCES FOUND · FACTS VERIFIED · SEGMENTS READY` with gold flash (`stat-flash` keyframe) on each increment

#### Research Panel — Living Agent Cards

Each agent card is a five-state visual machine:

| State | Dot | Border | Label |
|---|---|---|---|
| `queued` | Hollow, muted | None | Muted |
| `searching` | Filled teal, pulse | Animated conic-gradient (`@property --border-angle`, 3s rotation) | Teal |
| `evaluating` | Filled gold, shimmer | Shimmer sweep | Gold |
| `done` | Filled green, spring morph | None | Green |
| `error` | Filled red | None | Red |

- **Spotlight glow halo** — Radial gradient follows cursor via `--mouse-x`/`--mouse-y` CSS custom properties, `opacity: 0 → 1` on hover. Warm amber `rgba(196, 149, 106, 0.10)` color.
- **Source evaluation shimmer** — In AgentModal, source entries shimmer (`skeleton-pulse` keyframe) before revealing accepted/rejected state
- **Segment skeleton-to-content** — Generating cards show shimmer skeleton title using `-webkit-background-clip: text` with `background-attachment: fixed` (all skeletons shimmer in sync); on `ready`, crossfade to real content via `content-reveal` keyframe

#### Buttons & Interactive Elements

- **Spring physics** — `whileHover: scale(1.02)`, `whileTap: scale(0.97)`, `spring(stiffness:400, damping:17)` on all interactive elements
- **Ink ripple** — On primary button click, a `radial-gradient` blot spreads from exact click coordinates (historical ink aesthetic, replaces Material ripple)
- **Magnetic pull** — `useSpring(stiffness:150, damping:15)` attracts primary CTAs ("Begin Research", "Watch Documentary") toward cursor within 60px
- **Archival corner brackets** — `.archival-frame` CSS utility: `::before`/`::after` pseudo-elements draw gold corner brackets on hover (opacity `0 → 0.6`). Used on modals, drop zones, player topbar, segment cards.

#### Text Animations

- **Cipher/decode reveal** — Segment titles decode from ancient Greek/Cyrillic glyphs (`ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩαβγδεζηθ`) to actual text over 600ms via `useTextScramble` hook. Triggered when `status: 'ready'`.
- **Word-by-word caption reveal** — Documentary captions reveal one word at a time with `blur(4px) → blur(0)` entrance (`word-appear` keyframe, 0.2s each). Synced to narration timing.

#### Voice Button & Audio Waveform

- **Primary waveform** — Organic line using `Canvas API` + `AnalyserNode.getByteTimeDomainData()`. Drawn with `quadraticCurveTo` for smooth curves. 2px stroke, `#c4956a`, `shadowBlur: 8`.
- **Fallback waveform** — Three Motion-animated vertical bars (`scaleY` oscillating, 0.12s stagger) for `prefers-reduced-motion` or pre-audio states.
- **Audio-reactive visuals** — `useAudioVisualSync` hook reads `AnalyserNode` energy each rAF frame and drives:
  - `--ken-speed`: `28s` (silence) → `20s` (narration peak)
  - `--glow-opacity`: `0.5` → `1.0`
  - `--vig-spread`: `110%` → `140%`
  - `--cap-shadow`: `28px` → `48px`

#### Cinematic Transitions

- **Iris reveal** (Workspace → Player) — `@property --iris-r` animates a `radial-gradient` mask from `150%` to `0%` (iris close, 0.65s ease-in), then `0%` to `150%` (iris open, 0.75s ease-out). The single highest-impact animation in the app.
- **View Transitions API** (segment-to-segment) — `document.startViewTransition()` with custom `::view-transition-old/new` keyframes for fade + brightness + subtle scale. Chrome/Edge/Firefox 144+/Safari 18+. Opacity crossfade fallback for older browsers.
- **Auto-hide chrome** — All player controls fade (`opacity: 0`) and slide (`translateY`) after 3s inactivity, driven by `playerStore.isIdle`. Reset on `mousemove`/`keydown`/`touchstart`.
- **Between-segment transition** — Fade-to-black cross-dissolve with `scale(1.03)` on incoming segment for "camera settling" feel.

---

## ADK Agent Architecture

```
SequentialAgent (pipeline)
  └── scan_agent           (Agent, gemini-2.0-flash)
  └── ParallelAgent
        └── researcher_0   (Agent, google_search, gemini-2.0-flash)
        └── researcher_1   (Agent, google_search, gemini-2.0-flash)
        └── researcher_N   (Agent, google_search, gemini-2.0-flash)
  └── aggregator_agent     (Agent, reads all research_{n} state keys)
  └── script_agent         (Agent, gemini-2.0-pro)
  └── visual_director      (Agent, calls Imagen 3 + Veo 2)
```

### Critical ADK Constraints

- `google_search` tool **cannot be combined** with other tools in the same agent — research agents are search-only
- Agent results are shared via `output_key` → `session.state[key]` → referenced in downstream agent instructions via `{key}` template syntax
- `ParallelAgent` provides **no shared state during execution** — each subagent writes to its own `output_key`

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Browser (React 19 / TS)               │
│  PDF Viewer │ Research Panel │ Documentary Player        │
│  Motion animations │ Web Audio API │ Canvas waveform     │
│                  WebSocket ←→ live-relay                 │
└──────────┬───────────────────────────┬──────────────────┘
           │ REST + SSE                │ WebSocket
┌──────────▼──────────┐    ┌──────────▼──────────────────┐
│   historian-api      │    │   live-relay (Node.js 20)   │
│   FastAPI / Cloud Run│    │   Cloud Run                  │
└──────────┬──────────┘    └──────────┬──────────────────┘
           │                          │
┌──────────▼──────────┐    ┌──────────▼──────────────────┐
│ agent-orchestrator   │    │   Gemini Live API            │
│ Cloud Run (ADK)      │    │   gemini-2.5-flash-native-   │
│                      │    │   audio-preview-12-2025       │
│ ┌──────────────────┐ │    └─────────────────────────────┘
│ │ Scan Agent       │ │
│ │ ParallelAgent    │ │    ┌─────────────────────────────┐
│ │  └ researcher×N  │ │    │   Vertex AI                  │
│ │ Aggregator       │─┼───▶│   Imagen 3 / Veo 2           │
│ │ Script Agent     │ │    └─────────────────────────────┘
│ │ Visual Director  │ │
│ └──────────────────┘ │
└──────────┬──────────┘
           │
┌──────────▼──────────────────────────────────────────────┐
│  Firestore │ Cloud Storage (GCS) │ Pub/Sub │ Document AI │
└─────────────────────────────────────────────────────────┘
```

---

## Gemini Live API — Key Technical Facts

- **WebSocket endpoint:** `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent`
- **First message** after connection MUST be `BidiGenerateContentSetup` — no content before server sends `setupComplete`
- **VAD config** lives in `realtimeInputConfig.automaticActivityDetection`
- **Interruption** is server-detected: `serverContent.interrupted = true` → client must stop audio playback immediately and clear queue
- **Audio in:** 16-bit PCM, 16,000 Hz, mono, 1024-byte chunks
- **Audio out:** 16-bit PCM, 24,000 Hz, mono
- **Session limit:** 15 minutes without compression; unlimited with `contextWindowCompression.slidingWindow`
- **Resumption:** store `sessionResumptionUpdate.handle` token; reconnect with it on `goAway` or disconnect (valid 2 hours)

---

## Firestore Schema

```
/sessions/{sessionId}
  status: "uploading" | "processing" | "ready" | "playing"
  gcsPath: string
  language: string
  visualBible: string
  createdAt: timestamp

/sessions/{sessionId}/liveSession
  resumptionToken: string
  voiceState: string
  lastConnectedAt: timestamp

/sessions/{sessionId}/agents/{agentId}
  query: string
  status: "queued" | "searching" | "done"
  logs: array<{ step, ts, data }>
  facts: array<string>
  visualPrompt: string

/sessions/{sessionId}/segments/{segmentId}
  title: string
  script: string
  imageUrls: array<string>
  videoUrl: string (optional)
  mood: string
  sources: array<string>
  graphEdges: array<string>
  createdAt: timestamp
```

---

## Cloud Run Services

| Service | Runtime | Memory | CPU | Notes |
|---|---|---|---|---|
| `historian-api` | Python 3.12 | 2Gi | 2 | FastAPI gateway, signed URL generation |
| `agent-orchestrator` | Python 3.12 | 4Gi | 4 | ADK pipeline, SSE streaming |
| `live-relay` | Node.js 20 | 1Gi | 1 | WebSocket proxy to Gemini Live API |

Deploy ADK service: `adk deploy cloud_run --project=PROJECT --region=us-central1 --service_name=historian-agents agents/`

---

## Repository Structure

```
/
├── CLAUDE.md              ← This file — single source of truth for AI assistants
├── FRONTEND_PLAN.md       ← Full frontend spec: components, state, animations, API
├── TASKS.md               ← Per-task breakdown for Berkay and Efe
├── RESOURCES.md           ← All documentation links
├── PRD.md                 ← Product Requirements Document
├── SRS.md                 ← Software Requirements Specification
├── prototype.html         ← Interactive UX mockup (full design reference)
├── frontend/              ← React 19 + TypeScript + Vite 6 + Tailwind v4
│   ├── src/
│   │   ├── components/    ← upload/, workspace/, player/, voice/, ui/
│   │   ├── hooks/         ← useGeminiLive, useAudioCapture, useAudioPlayback,
│   │   │                     useAudioVisualSync, useSSE, useTextScramble
│   │   ├── store/         ← sessionStore, researchStore, voiceStore, playerStore
│   │   ├── services/      ← api.ts, upload.ts
│   │   ├── types/         ← index.ts (contract file)
│   │   └── pages/         ← UploadPage, WorkspacePage, PlayerPage
│   └── package.json       ← pnpm only
├── backend/
│   ├── historian_api/     ← FastAPI gateway service
│   ├── agent_orchestrator/ ← ADK pipeline service
│   │   └── agents/        ← scan_agent, research_agents, script_agent, visual_director
│   └── live_relay/        ← Node.js WebSocket relay
└── terraform/             ← Infrastructure as Code (bonus +0.2 pts)
    └── main.tf
```

---

## Code Standards

### Python (backend)
- Python 3.12+, type hints everywhere
- `async`/`await` for all I/O — never blocking calls in async context
- Pydantic v2 models for all request/response schemas
- Every external API call (Gemini, Imagen, Veo 2, Document AI) retried up to 3× with exponential backoff

### TypeScript (frontend)
- `strict: true` — no `any`, no implicit `any`, no unsafe assertions
- All Zustand state slices typed with explicit interfaces in `types/index.ts`
- SSE event payloads typed and validated at the boundary in `useSSE.ts`
- React hooks follow the rules: no conditional hooks, deps arrays always complete

### General
- **Package manager:** `pnpm` — never `npm` or `yarn` in Node.js projects
- **Commits:** imperative present tense (`add`, `fix`, `update`) — no co-author lines
- **Secrets:** never hardcoded — always Secret Manager or environment variables
- **Security:** validate all inputs at system boundaries (file upload type/size, user speech text)
- **Accessibility:** `aria-busy="true"` on all loading containers, `prefers-reduced-motion` respected everywhere

---

## Performance Targets

| Metric | Target |
|---|---|
| First segment playable | < 45 seconds from document upload |
| Voice interruption latency | < 300ms (historian stops mid-word) |
| Historian response start | < 1.5 seconds after user speech ends |
| Research subagent completion | < 30 seconds per agent |
| Imagen 3 fast generation | ~5 seconds per image |
| Veo 2 video generation | 1–2 minutes per clip (async) |
| Frontend initial bundle | < 200KB gzipped (Vite code splitting) |
| Animation frame budget | 60fps maintained; rAF loops capped at 50 particles |

---

## Submission Checklist

- [ ] All backend services deployed and running on Cloud Run
- [ ] `terraform/` directory with working `terraform apply`
- [ ] `README.md` with step-by-step setup instructions for judges
- [ ] Architecture diagram (Mermaid or image) embedded in README
- [ ] Screen recording of GCP console showing deployment
- [ ] Demo video ≤ 4 minutes on YouTube or Vimeo (unlisted is fine)
- [ ] Demo video shows real working software — no mockup screens
- [ ] Berkay's blog post published with `#GeminiLiveAgentChallenge` tag
- [ ] Efe's blog post published with `#GeminiLiveAgentChallenge` tag
- [ ] Both team members joined GDG with public profile links
- [ ] Repository is public: https://github.com/pancodo/gemini-live-agent-challenge
- [ ] Devpost submission form completed at: https://geminiliveagentchallenge.devpost.com/

---

## Reference Links

| Resource | URL |
|---|---|
| Competition page | https://geminiliveagentchallenge.devpost.com/ |
| Official rules | https://geminiliveagentchallenge.devpost.com/rules |
| FAQs | https://geminiliveagentchallenge.devpost.com/details/faqs |
| Resources page | https://geminiliveagentchallenge.devpost.com/resources |
| GitHub repo | https://github.com/pancodo/gemini-live-agent-challenge |
| Gemini Live API docs | https://ai.google.dev/gemini-api/docs/multimodal-live |
| ADK documentation | https://google.github.io/adk-docs/ |
| ADK bidi-streaming guide | https://google.github.io/adk-docs/streaming/dev-guide/part1/ |
| Imagen 3 guide | https://cloud.google.com/vertex-ai/generative-ai/docs/image/generate-images |
| Veo 2 guide | https://cloud.google.com/vertex-ai/generative-ai/docs/video/generate-videos-from-text |
| Document AI OCR | https://cloud.google.com/document-ai/docs/process-documents-ocr |
| Google Cloud credits form | https://forms.gle/rKNPXA1o6XADvQGb7 |
| GDG membership | https://gdg.community.dev/ |
| Official Live API sample code | https://github.com/GoogleCloudPlatform/generative-ai/tree/main/gemini/multimodal-live-api |
| ADK bidi-streaming samples | https://github.com/google/adk-samples/tree/main/python/agents/bidi-demo |
| Motion (Framer Motion) docs | https://motion.dev/docs/react |
| Tailwind CSS v4 docs | https://tailwindcss.com/docs |
| TanStack Query v5 docs | https://tanstack.com/query/v5 |
| Zustand 5 docs | https://zustand.docs.pmnd.rs/ |
| Sonner docs | https://sonner.emilkowal.ski/ |
| Radix UI docs | https://www.radix-ui.com/primitives |
| View Transitions API — MDN | https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API |
| Web Audio API visualizations — MDN | https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Visualizations_with_Web_Audio_API |
| CSS @property — MDN | https://developer.mozilla.org/en-US/docs/Web/CSS/@property |
| All technology links | See RESOURCES.md |
