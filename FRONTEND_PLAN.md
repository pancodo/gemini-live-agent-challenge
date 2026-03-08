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

## UI & UX Polish Layer

This section defines every animation, micro-interaction, and cinematic detail across the three screens. It is part of the Agent 1 contract and is referenced by all implementation agents.

---

### 1. Global Atmosphere — Always On

These effects are rendered at the root level and apply everywhere.

#### Film Grain Overlay (CSS SVG noise)
A single SVG `feTurbulence` filter inlined in `index.html`, referenced by a fixed-position overlay div. Creates subconscious material quality without a literal paper texture image.

```css
/* grain.css — applied via <div class="grain-overlay"> in App.tsx */
.grain-overlay {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 9998;
  opacity: 0.025;           /* 2.5% — subconscious, never visible */
  filter: url(#grain);
  mix-blend-mode: multiply; /* warms the parchment tones */
  animation: grain-shift 0.5s steps(4) infinite;
}

@keyframes grain-shift {
  0%   { transform: translate(0, 0); }
  25%  { transform: translate(-2px, 2px); }
  50%  { transform: translate(2px, -1px); }
  75%  { transform: translate(-1px, -2px); }
}
```

Inlined SVG filter in `index.html`:
```html
<svg style="position:absolute;width:0;height:0;overflow:hidden">
  <filter id="grain">
    <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="4" stitchTiles="stitch"/>
    <feColorMatrix type="saturate" values="0"/>
  </filter>
</svg>
```

#### Aurora Background (Upload + Workspace screens only)
Three blurred gradient blobs drift slowly behind the content layer, creating atmospheric depth without overwhelming the parchment palette.

```css
.aurora-blob {
  position: fixed;
  width: 40vw; height: 40vw;
  border-radius: 50%;
  filter: blur(80px);
  opacity: 0.08;
  pointer-events: none;
  z-index: -1;
}
/* blob colors use muted versions of the gold palette */
.aurora-blob:nth-child(1) { background: #8b6914; top: -10%; left: -10%;
  animation: drift 22s ease-in-out infinite alternate; }
.aurora-blob:nth-child(2) { background: #3d2e1a; bottom: -10%; right: -10%;
  animation: drift 28s ease-in-out infinite alternate-reverse; }
.aurora-blob:nth-child(3) { background: #2a1f14; top: 50%; left: 40%;
  animation: drift 32s ease-in-out infinite alternate; }

@keyframes drift {
  from { transform: translate(0, 0) scale(1); }
  to   { transform: translate(40px, 25px) scale(1.08); }
}
```

#### Accessibility
```css
@media (prefers-reduced-motion: reduce) {
  .grain-overlay, .aurora-blob { animation: none !important; }
}
```

---

### 2. Loading Screen — "Expedition Log" Pattern

The processing pipeline (Upload → OCR → Scan → Research → Script → Visuals) is not a spinner. It is a **narrated expedition journal** that types itself in real time as agents work.

#### Architecture
Replace a generic progress bar with four named **Phase Markers**, each revealing itself when its pipeline phase begins. Each phase contains live log entries that stream in via SSE.

```
Phase I  — TRANSLATION & SCAN
  └── "Ottoman imperial decree (ferman), circa 16th century"
  └── "3 entities identified · 2 geographic references · 4 knowledge gaps"

Phase II — FIELD RESEARCH  (5 agents dispatched)
  └── Agent 1: "Who was Grand Vizier Sokollu Mehmed Pasha?" · searching...
  └── Agent 2: "Edirne in the 1570s: political context" · 3 sources found
  └── Agent 3: "Topkapi Palace administrative structure" · done · 8 facts

Phase III — SYNTHESIS
  └── "Combining 23 verified facts into narrative..."

Phase IV — VISUAL COMPOSITION
  └── Scene 1: "Grand Vizier's audience chamber" · Imagen 3 · generating...
  └── Scene 2: "Ottoman fleet at port" · done · image ready
```

#### Phase Divider Animation
When a new phase begins, a horizontal rule draws itself from center outward with a gold ornament:

```css
.phase-divider {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 20px 0;
}
.phase-divider::before,
.phase-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: linear-gradient(to right, transparent, var(--gold), transparent);
  transform: scaleX(0);
  transform-origin: center;
  animation: draw-rule 0.8s ease-out forwards;
}
.phase-divider-dot {
  width: 4px; height: 4px;
  border-radius: 50%;
  background: var(--gold);
  opacity: 0;
  animation: dot-appear 0.3s 0.4s ease-out forwards;
}
@keyframes draw-rule { to { transform: scaleX(1); } }
@keyframes dot-appear { to { opacity: 1; } }
```

#### Log Entry Typewriter Reveal
Each log entry types itself at 20ms/char with ±50% random jitter (simulates a person typing):

```typescript
// hooks/useTypewriter.ts
export function typewriteEntry(
  el: HTMLElement,
  text: string,
  speed = 20
): void {
  let i = 0;
  el.textContent = '';
  const cursor = document.createElement('span');
  cursor.className = 'tw-cursor';   /* blinking bar */
  el.appendChild(cursor);

  function tick() {
    if (i < text.length) {
      el.insertBefore(document.createTextNode(text[i]), cursor);
      i++;
      setTimeout(tick, speed + Math.random() * speed * 0.5);
    } else {
      cursor.remove();
    }
  }
  tick();
}
```

#### Staggered Entry Reveal (Framer Motion)
Agent log entries slide up from below with blur-to-sharp entrance:

```typescript
const logEntry = {
  hidden: { opacity: 0, y: 12, filter: 'blur(3px)' },
  show: {
    opacity: 1, y: 0, filter: 'blur(0px)',
    transition: { type: 'spring', stiffness: 280, damping: 22 }
  }
};
// stagger via container variants: staggerChildren: 0.08
```

#### Controlled SSE Drip Rate
Incoming SSE events are buffered and released at 150ms intervals to prevent visual overload from parallel agent bursts:

```typescript
// hooks/useSSE.ts — buffer and drip pattern
const pendingRef = useRef<AgentEvent[]>([]);
// On each SSE message: pendingRef.current.push(event)
// setInterval every 150ms: pop one event → setState
```

#### Stats Bar (Accumulation Counter)
A fixed bar below the phase log shows running totals, flashing gold on each increment:

```
12 SOURCES FOUND  ·  23 FACTS VERIFIED  ·  3 OF 5 SEGMENTS READY
```

```css
.stat-value.updated {
  animation: stat-flash 0.5s ease-out;
}
@keyframes stat-flash {
  0%   { color: var(--green); transform: scale(1.1); }
  100% { color: var(--gold);  transform: scale(1); }
}
```

---

### 3. Research Panel — "Living Agent Cards"

Each agent card is a state machine with distinct visual states:

| State | Dot | Animation | Label color |
|---|---|---|---|
| `queued` | Hollow circle, `--muted` | None | Muted |
| `searching` | Filled `--teal`, pulse | Rotating search icon | Teal |
| `evaluating` | Filled `--gold`, shimmer border | Source count incrementing | Gold |
| `done` | Filled `--green`, checkmark morph | Fact count displayed | Green |
| `error` | Filled red | Retry indicator blinks | Red |

#### Animated Conic-Gradient Border (active/searching cards)
```css
@property --border-angle {
  syntax: '<angle>';
  inherits: false;
  initial-value: 0deg;
}
.agent-card.searching {
  border: 1px solid transparent;
  background:
    linear-gradient(var(--bg2), var(--bg2)) padding-box,
    conic-gradient(
      from var(--border-angle),
      transparent 25%,
      var(--teal) 50%,
      transparent 75%
    ) border-box;
  animation: rotate-border 3s linear infinite;
}
@keyframes rotate-border { to { --border-angle: 360deg; } }
```

#### Shimmer Border (evaluating state)
```css
.agent-card.evaluating::before {
  content: '';
  position: absolute;
  inset: -1px;
  border-radius: inherit;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(196, 149, 106, 0.5) 50%,
    transparent 100%
  );
  background-size: 200% 100%;
  animation: shimmer 1.8s ease-in-out infinite;
  mask: linear-gradient(#fff 0 0) content-box,
        linear-gradient(#fff 0 0);
  mask-composite: exclude;
  padding: 1px;
}
@keyframes shimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
```

#### Spotlight Glow Halo (on hover — all cards)
A radial gradient follows the cursor inside the card, giving a warm candlelight effect:

```css
.agent-card {
  --mouse-x: 50%;
  --mouse-y: 50%;
}
.agent-card::after {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(
    400px circle at var(--mouse-x) var(--mouse-y),
    rgba(196, 149, 106, 0.10),
    transparent 40%
  );
  opacity: 0;
  transition: opacity 0.25s ease;
  pointer-events: none;
  border-radius: inherit;
}
.agent-card:hover::after { opacity: 1; }
/* Update --mouse-x/--mouse-y via onMouseMove in React */
```

#### Source Evaluation Shimmer (AgentModal)
Before each source's accepted/rejected status is revealed, it shimmers briefly:

```css
.log-source.evaluating {
  background: linear-gradient(90deg, var(--bg3) 25%, var(--bg4) 50%, var(--bg3) 75%);
  background-size: 200% 100%;
  animation: skeleton-pulse 1.2s ease-in-out infinite;
}
@keyframes skeleton-pulse {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
```

#### Segment Cards — Skeleton-to-Content Morph
Cards in `generating` state show a shimmer skeleton title; on `ready`, they crossfade to real content without layout shift:

```css
.seg-card.generating .seg-title {
  background: linear-gradient(90deg, var(--bg3) 25%, var(--bg4) 50%, var(--bg3) 75%);
  background-size: 200% 100%;
  background-attachment: fixed;   /* all skeletons shimmer in sync */
  animation: skeleton-pulse 1.5s ease-in-out infinite;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}
.seg-card.ready .seg-title {
  -webkit-text-fill-color: initial;
  animation: content-reveal 0.4s ease-out;
}
@keyframes content-reveal {
  from { opacity: 0; filter: blur(4px); }
  to   { opacity: 1; filter: blur(0); }
}
```

---

### 4. Interactive Details — Buttons & Inputs

#### Spring Physics on All Interactive Elements
```tsx
// Apply to every <button>, <a>, interactive <div>
<motion.button
  whileHover={{ scale: 1.02 }}
  whileTap={{ scale: 0.97 }}
  transition={{ type: 'spring', stiffness: 400, damping: 17 }}
>
```

#### Ink Ripple (Historical theme — replaces Material ripple)
On primary button click, an ink blot spreads from the exact click point:

```typescript
// components/ui/InkButton.tsx
// Track click coords → render <span> with radial-gradient animation
// animation: ink-spread 0.6s ease-out forwards
// @keyframes: scale(0) opacity(0.3) → scale(2.5) opacity(0)
```

#### Magnetic Pull (Primary CTAs only — "Begin Research", "Watch Documentary")
Buttons magnetically attract the cursor when within 60px:

```typescript
// useMotionValue(x/y) + useSpring(stiffness:150, damping:15)
// onMouseMove: x.set(distX * 0.3), y.set(distY * 0.3)
// onMouseLeave: x.set(0), y.set(0)
```

#### Archival Corner Brackets (recurring motif)
Applied via a CSS utility class `.archival-frame` on modal headers, drop zones, player topbar, segment card hover states:

```css
.archival-frame { position: relative; }
.archival-frame::before {
  content: '';
  position: absolute;
  top: -1px; left: -1px;
  width: 14px; height: 14px;
  border-top: 1px solid var(--gold);
  border-left: 1px solid var(--gold);
  opacity: 0;
  transition: opacity 0.3s ease;
}
.archival-frame::after {
  content: '';
  position: absolute;
  bottom: -1px; right: -1px;
  width: 14px; height: 14px;
  border-bottom: 1px solid var(--gold);
  border-right: 1px solid var(--gold);
  opacity: 0;
  transition: opacity 0.3s ease;
}
.archival-frame:hover::before,
.archival-frame:hover::after { opacity: 0.6; }
```

---

### 5. Text Animations

#### Cipher/Decode Reveal (Segment Titles)
Segment titles decode from ancient Greek/Cyrillic glyphs to actual text when revealed. Applied on `status: 'ready'` transition:

```typescript
// hooks/useTextScramble.ts
const HISTORICAL_CHARS = 'ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩαβγδεζηθικλμνξοπρσ';

export function scrambleTo(
  target: string,
  onUpdate: (text: string) => void,
  duration = 600
): void {
  const start = performance.now();
  function frame(now: number) {
    const progress = Math.min((now - start) / duration, 1);
    const resolved = Math.floor(progress * target.length);
    const result = target
      .split('')
      .map((char, i) => {
        if (i < resolved) return char;
        return HISTORICAL_CHARS[Math.floor(Math.random() * HISTORICAL_CHARS.length)];
      })
      .join('');
    onUpdate(result);
    if (progress < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
```

#### Word-by-Word Caption Reveal (Documentary Player)
Each word in the historian's narration appears with a blur-to-sharp entrance, staggered by word:

```css
.cap-word { display: inline; }
.cap-word-new {
  display: inline;
  animation: word-appear 0.2s ease-out forwards;
}
@keyframes word-appear {
  from { opacity: 0; filter: blur(4px); }
  to   { opacity: 1; filter: blur(0); }
}
```

Caption text style (improved readability on dark):
```css
.cap-text {
  font-family: var(--serif);
  font-size: clamp(20px, 2.4vw, 28px);
  font-weight: 300;
  font-style: italic;
  color: rgba(240, 225, 195, 0.94);
  letter-spacing: 0.02em;   /* +tracking for light-on-dark legibility */
  line-height: 1.65;
  text-shadow:
    0 2px 28px rgba(0,0,0,0.9),   /* tight halo */
    0 0 80px rgba(0,0,0,0.5);     /* wide ambient bloom */
}
```

---

### 6. Voice Button & Audio Waveform

#### Waveform Style: Organic Line (recommended) + Fallback Dot Pulse

**Primary (when Web Audio API active):** A smooth sine-like wave using `quadraticCurveTo` on canvas, responding to `AnalyserNode.getByteTimeDomainData`. Stroke: 2px `#c4956a` with `shadowBlur: 8, shadowColor: #c4956a`.

**Fallback (no audio / reduced-motion):** Three vertical bars that scale independently with Framer Motion:

```tsx
// components/voice/Waveform.tsx
{[0, 1, 2].map(i => (
  <motion.div
    key={i}
    className="waveform-bar"  /* 3px wide, 12px base height, --gold */
    animate={{
      scaleY: isActive ? [1, 1.8, 0.9, 1.5, 1] : 1,
      opacity: isActive ? 1 : 0.35,
    }}
    transition={{
      duration: 0.5,
      repeat: Infinity,
      delay: i * 0.12,
      ease: 'easeInOut',
    }}
  />
))}
```

#### Audio-Reactive Visuals (Documentary Player)
`AudioVisualSync` class reads `AnalyserNode` frequency energy and drives CSS custom properties on `<html>` each rAF frame:

| CSS Property | Silence | Peak narration |
|---|---|---|
| `--glow-opacity` | `0.5` | `1.0` |
| `--ken-speed` | `28s` (slow drift) | `20s` (livelier) |
| `--vig-spread` | `110%` (tighter) | `140%` (wider) |
| `--cap-shadow` | `28px` (tight) | `48px` (bloom) |

```typescript
// hooks/useAudioVisualSync.ts
function updateVisuals(energy: number) {
  const root = document.documentElement;
  root.style.setProperty('--glow-opacity', String(0.5 + energy * 0.5));
  root.style.setProperty('--ken-speed', String(Math.round(28 - energy * 8)) + 's');
  root.style.setProperty('--vig-spread', String(Math.round(110 + energy * 30)) + '%');
}
// Call from rAF loop in DocumentaryPlayer
```

---

### 7. Cinematic Transitions

#### Iris Reveal — Workspace → Documentary Player

The most impactful single animation in the app. When the user clicks "Watch Documentary":

- Phase 1 (0–300ms): Clicked segment card scales `1.0 → 1.03`; all other content fades to `opacity: 0.3`
- Phase 2 (300–900ms): A black overlay closes inward via `@property` animated radial mask (iris close)
- Phase 3 (900–1500ms): Documentary visual fades in as iris opens outward to reveal player

```css
@property --iris-r {
  syntax: '<percentage>';
  inherits: false;
  initial-value: 150%;
}

.iris-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: #000;
  mask-image: radial-gradient(
    circle,
    transparent var(--iris-r),
    black calc(var(--iris-r) + 4%)
  );
  pointer-events: none;
}

.iris-close { animation: iris-close 0.65s ease-in forwards; }
.iris-open  { animation: iris-open  0.75s ease-out forwards; }

@keyframes iris-close {
  from { --iris-r: 150%; }
  to   { --iris-r: 0%; }
}
@keyframes iris-open {
  from { --iris-r: 0%; }
  to   { --iris-r: 150%; }
}
```

Fallback for Firefox < 144: simple `opacity: 0 → 1` crossfade at 0.6s.

#### View Transitions API (Segment-to-Segment)
For browsers supporting View Transitions (Chrome, Edge, Firefox 144+, Safari 18+):

```javascript
// On segment change
document.startViewTransition(() => setCurrentSegment(nextId));
```

```css
::view-transition-old(root) {
  animation: 0.6s ease-in-out both vt-fade-out;
}
::view-transition-new(root) {
  animation: 0.8s 0.2s ease-in-out both vt-fade-in;
}
@keyframes vt-fade-out {
  to { opacity: 0; filter: brightness(0.2); transform: scale(0.98); }
}
@keyframes vt-fade-in {
  from { opacity: 0; filter: brightness(0.2); transform: scale(1.02); }
}
```

#### Transition Decision Matrix

| Narrative context | Transition | Duration |
|---|---|---|
| Workspace → Documentary | Iris close + open | 1.4s total |
| Documentary → Workspace | Reverse iris (open outward) | 0.8s |
| Segment → next segment (same era) | Fade-to-black cross-dissolve | 1.4s |
| Historian interrupted | Instant cut + opacity flash | 0.15s |
| Image-to-image within segment | Ken Burns crossfade (overlap) | 2.0s |

#### Auto-Hide Chrome (Documentary Player)
All UI controls fade and slide away after 3 seconds of inactivity:

```css
.doc-controls {
  transition: opacity 0.5s ease, transform 0.4s ease;
}
.player-idle .doc-topbar {
  opacity: 0;
  transform: translateY(-100%);
  pointer-events: none;
}
.player-idle .doc-botbar {
  opacity: 0;
  transform: translateY(100%);
  pointer-events: none;
}
```

```typescript
// 3-second inactivity timer reset on mousemove/keydown/touchstart
// playerStore.setIdle(true) triggers .player-idle on root
```

---

### 8. Toast Notifications — Sonner

Use **Sonner** (`sonner` package) themed to match the parchment system. The historian persona gets a custom styled toast.

```tsx
// Historian discovery toast
toast.custom((t) => (
  <div className={`historian-toast ${t.visible ? 'show' : ''}`}>
    <QuillIcon className="toast-icon" />
    <span>New connection discovered</span>
  </div>
));

// Agent progress toast
toast.promise(runAgent(query), {
  loading: 'Searching archives...',
  success: (d) => `Found ${d.facts.length} historical facts`,
  error: 'Research agent failed — retrying...',
});
```

Icon morphs between states using `AnimatePresence mode="wait"` with spring scale transitions: spinner → checkmark → X.

---

### 9. Additional Design Tokens

Extend the existing CSS variables with new interaction tokens:

```css
:root {
  /* existing tokens ... */

  /* Interaction & animation */
  --glow-primary:   #c4956a;
  --glow-secondary: #d4a574;
  --shadow-warm:    rgba(139, 105, 20, 0.15);
  --bg-deep:        #0d0b09;   /* documentary player base */
  --bg-card:        #1a1510;   /* dark card surfaces */

  /* Animation durations (overridden by audio-reactive system) */
  --ken-speed:      28s;
  --glow-opacity:   0.5;
  --vig-spread:     110%;
}
```

---

### 10. New Package Additions

| Package | Reason |
|---|---|
| `sonner` | Toast notifications (Vercel/Cursor standard) |
| `@lottiefiles/dotlottie-react` | Optional: branded Lottie loaders for any idle states |

No WebGL libraries (Three.js, VFX-JS) — too heavy for this scope. All effects above are pure CSS + Canvas API + Motion.

---

## Implementation Parts

The frontend is split into 5 sequential parts. Each part is self-contained and builds on the previous one. Execute one part per chat session to stay within context limits.

**To continue in a new chat:** Read `FRONTEND_PLAN.md` fully, check the status table below, then say "start Part N" for the next uncompleted part.

| Part | Scope | Status |
|---|---|---|
| **Part 1** | Scaffold + Design System Foundation | [x] Complete |
| **Part 2** | Upload Page + Workspace Layout | [x] Complete |
| **Part 3** | Research Pipeline UI | [x] Complete |
| **Part 4** | Voice Button + Audio System | [x] Complete |
| **Part 5** | Documentary Player + Cinematic Transitions | [x] Complete |

---

### Part 1 — Scaffold + Design System Foundation

**Delivers:** A runnable Vite app with the complete design system, all stores, all types, and shared UI primitives. Every subsequent part imports from this foundation.

- Vite 6 project creation, all package installs:
  `react@19`, `react-dom@19`, `typescript`, `tailwindcss@next` (v4), `motion@12`, `zustand@5`, `@tanstack/react-query@5`, `@radix-ui/react-dialog`, `react-router-dom@6`, `pdfjs-dist`, `sonner`, `@types/react`, `@types/react-dom`
- Tailwind v4 CSS-first config (`@theme {}` block in CSS, no `tailwind.config.js`)
- Full design token system — all CSS custom properties (parchment palette, cinematic dark, interaction tokens, audio-reactive variables)
- `src/types/index.ts` — complete shared type contract (all interfaces: `Session`, `AgentState`, `SegmentState`, `VoiceState`, `AgentLog`, `SSEEvent`, etc.)
- All 4 Zustand store skeletons with typed state + actions: `sessionStore`, `researchStore`, `voiceStore`, `playerStore`
- React Router v6 setup with `createBrowserRouter` + empty page shells (`UploadPage`, `WorkspacePage`, `PlayerPage`)
- `App.tsx` — router provider, grain overlay `<div>`, aurora blob `<div>`s, Sonner `<Toaster />`
- Shared UI primitives in `src/components/ui/`:
  - `Button` — Motion spring physics (`whileHover scale(1.02)`, `whileTap scale(0.97)`)
  - `Badge` — format/language display
  - `Spinner` — animated ring
  - `InkButton` — ink ripple from click coordinates
  - `Modal` — Radix Dialog wrapper
- Global CSS keyframes: `grain-shift`, `drift`, `draw-rule`, `dot-appear`, `shimmer`, `skeleton-pulse`, `content-reveal`, `log-appear`, `word-appear`, `stat-flash`, `iris-close`, `iris-open`, `rotate-border`
- `.archival-frame` CSS utility class (corner bracket pseudo-elements)
- SVG grain filter inlined in `index.html`

---

### Part 2 — Upload Page + Workspace Layout

**Delivers:** A working upload flow that creates a session, uploads to GCS, and lands on the workspace with a PDF visible.

**Reads from Part 1:** types, stores, shared UI primitives, design tokens.

- `src/services/api.ts` — base REST client with typed methods, `VITE_API_BASE_URL` config
- `src/services/upload.ts` — `createSession()` → signed GCS URL → `PUT` to GCS → return `sessionId`
- `src/hooks/useSession.ts` — session lifecycle, status polling via TanStack Query
- `src/components/upload/DropZone.tsx` — drag-and-drop, format validation (PDF/JPG/PNG/TIFF), spring-animated border, archival corner brackets on drag-over
- `src/components/upload/FormatBadge.tsx` — format + language tag display
- `src/pages/UploadPage.tsx` — full upload screen wired to `upload.ts` + `sessionStore`
- `src/components/workspace/WorkspaceLayout.tsx` — split-panel layout (left: PDF viewer, right: panel stack)
- `src/components/workspace/TopNav.tsx` — session title, status indicator, breadcrumb
- `src/components/workspace/PDFViewer.tsx` — `pdfjs-dist` rendering, scrollable, zoom controls, entity highlight layer (populated after Scan Agent)
- `src/components/workspace/HistorianPanel.tsx` — shell (wired to voice in Part 4)
- `src/pages/WorkspacePage.tsx` — assembles layout, guards redirect if no `sessionId`

---

### Part 3 — Research Pipeline UI

**Delivers:** The live research experience — the Expedition Log loading screen, all agent card states, the agent detail modal, segment cards morphing from skeleton to content, and toast notifications.

**Reads from Part 1:** types, stores, primitives, keyframes.
**Reads from Part 2:** `useSession`, `WorkspaceLayout`.

- `src/hooks/useSSE.ts` — `EventSource` with 150ms drip buffer (`pendingRef` + `setInterval`) to prevent visual overload from parallel agent bursts
- **Expedition Log loading screen** (inside `WorkspacePage` during `status: 'processing'`):
  - Four named phase markers: TRANSLATION & SCAN, FIELD RESEARCH, SYNTHESIS, VISUAL COMPOSITION
  - Self-drawing gold phase dividers (`draw-rule` + `dot-appear` keyframes)
  - Typewriter log entries at 20ms/char with ±50% random jitter (`useTypewriter` hook)
  - Staggered entry reveal via Motion `staggerChildren: 0.08`, `y:12 blur(3px)` entrance
  - Stats accumulation bar: `SOURCES FOUND · FACTS VERIFIED · SEGMENTS READY` with `stat-flash` keyframe on each increment
- `src/components/workspace/ResearchPanel.tsx` — living agent cards, 5-state machine:
  - `queued` — hollow dot, muted
  - `searching` — filled teal dot, rotating search icon, animated conic-gradient border (`@property --border-angle`, 3s rotation)
  - `evaluating` — filled gold dot, shimmer border sweep
  - `done` — filled green dot, spring-morphed checkmark, fact count displayed
  - `error` — filled red dot, retry indicator
  - Spotlight glow halo on all cards: cursor-tracking `--mouse-x`/`--mouse-y` radial gradient
- `src/components/workspace/AgentModal.tsx` — Radix Dialog:
  - Log entries with `log-appear` stagger
  - Source evaluation shimmer (`skeleton-pulse`) before accept/reject reveal
  - Footprints: thin vertical line connecting log entry nodes
- `src/components/workspace/SegmentCard.tsx`:
  - `generating` state: shimmer skeleton title (`background-attachment: fixed` for sync)
  - `ready` state: `content-reveal` crossfade, cipher/decode title via `useTextScramble`
- `src/hooks/useTextScramble.ts` — Greek/Cyrillic glyph decode animation
- Sonner custom historian toast + `toast.promise()` wiring for agent operations
- Wire `useSSE` → `researchStore` → `ResearchPanel` + `SegmentCard` + Expedition Log

---

### Part 4 — Voice Button + Audio System

**Delivers:** A fully working real-time voice layer — mic capture, PCM encoding, WebSocket to live-relay, audio playback, interruption handling, and the waveform visualizer.

**Reads from Part 1:** types, `voiceStore`, `sessionStore`, shared primitives.
**Reads from Part 2:** `WorkspaceLayout`, session context.

- `src/hooks/useAudioCapture.ts` — `getUserMedia()` → `AudioWorkletNode` → 16kHz PCM Int16 encoding → chunk callback
- `src/hooks/useAudioPlayback.ts` — `AudioBufferSourceNode` queue, 24kHz PCM playback, drain on interruption signal
- `src/hooks/useVoiceState.ts` — state machine: `idle → listening → processing → historian_speaking → interrupted → idle`
- `src/hooks/useGeminiLive.ts` — WebSocket to `live-relay`:
  - First message: `BidiGenerateContentSetup`
  - Waits for `setupComplete` before sending audio
  - Forwards PCM chunks from `useAudioCapture`
  - Handles `serverContent.interrupted = true` → clears playback queue instantly
  - Stores `sessionResumptionUpdate.handle` token in `voiceStore` + Firestore
  - Reconnects with resumption token on `goAway` or disconnect
- `src/components/voice/VoiceButton.tsx` — 5-state visuals:
  - `idle` — static mic icon, gold border
  - `listening` — pulsing ring, "Listening..." label
  - `processing` — `Spinner` on button
  - `historian_speaking` — waveform ring animation
  - `interrupted` — flash transition → listening
  - Fixed-position, visible on Workspace + Player, hidden on Upload
- `src/components/voice/Waveform.tsx`:
  - Canvas API organic line — `AnalyserNode.getByteTimeDomainData()`, `quadraticCurveTo`, 2px `#c4956a` stroke, `shadowBlur: 8`
  - Motion dot-pulse fallback (3 bars, `scaleY` oscillating, 0.12s stagger)
- `src/components/voice/LiveToast.tsx` — real-time historian status announcements
- Wire `useGeminiLive` → `useAudioCapture` → `useAudioPlayback` → `voiceStore` → `VoiceButton`

---

### Part 5 — Documentary Player + Cinematic Transitions

**Delivers:** The full cinematic documentary experience — Ken Burns visuals, narration captions, audio-reactive animations, the iris transition into player mode, and all remaining cross-app polish.

**Reads from all previous parts.**

- `src/hooks/useAudioVisualSync.ts` — `AnalyserNode.getByteFrequencyData()` each rAF frame → drives on `document.documentElement`:
  - `--ken-speed`: `28s` (silence) → `20s` (narration peak)
  - `--glow-opacity`: `0.5` → `1.0`
  - `--vig-spread`: `110%` → `140%`
  - `--cap-shadow`: `28px` → `48px`
- `src/components/player/KenBurnsStage.tsx` — 4 Imagen 3 images cycling, `scale(1.0→1.12) + translate` over `var(--ken-speed)`, crossfade at 10s, random start position per image, `<video>` swap when `videoUrl` present, pauses when `voiceStore.state` is `listening`/`processing`
- `src/components/player/CaptionTrack.tsx` — word-by-word `word-appear` reveal (`blur(4px)→blur(0)`), dual `text-shadow`, `letter-spacing: 0.02em`
- `src/components/player/PlayerSidebar.tsx` — segment list navigation
- `src/components/player/DocumentaryPlayer.tsx` — full-screen layout, vignette layers (`.v-top`, `.v-bot`, `.v-vig`), auto-hide chrome (3s `playerStore.setIdle(true)` on inactivity)
- `src/pages/PlayerPage.tsx` — assembles player, guards redirect if no session
- **Iris reveal transition** — `@property --iris-r` animated radial mask overlay: phase 1 (card scale-up, others fade), phase 2 (iris close 0.65s), phase 3 (iris open 0.75s). Firefox fallback: opacity crossfade.
- **View Transitions API** — `document.startViewTransition()` for segment changes with `::view-transition-old/new` keyframes; opacity fallback for unsupported browsers
- **Between-segment transition** — fade-to-black cross-dissolve, `scale(1.03)` on incoming segment
- **Magnetic pull** — `useSpring` + `useMotionValue` on "Begin Research" and "Watch Documentary" CTAs
- Full `prefers-reduced-motion` audit across all components
- Final integration wire-up: all pages connected, all stores synchronized, all hooks live

---

## Status
- [x] Approved
- [x] Part 1 — Scaffold + Design System Foundation
- [x] Part 2 — Upload Page + Workspace Layout
- [x] Part 3 — Research Pipeline UI
- [x] Part 4 — Voice Button + Audio System
- [x] Part 5 — Documentary Player + Cinematic Transitions
