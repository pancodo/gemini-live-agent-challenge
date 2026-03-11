# UI/UX Production Improvements — Agent Assignments
**Date:** 2026-03-11
**Source:** 7-domain parallel research synthesis
**Total agents:** 14

---

## Priority Legend
- P0 — Bug or correctness issue. Must fix before demo.
- P1 — High-impact feature. Directly serves 40% Innovation criterion.
- P2 — Polish. Visible to attentive judges.
- P3 — Nice-to-have if time permits.

---

## Agent-1 — Fix Ken Burns Audio-Reactive Speed
**Priority:** P0 (Bug)
**File:** `frontend/src/hooks/useAudioVisualSync.ts`

**Problem:** CSS `animation-duration` is snapshotted when the animation starts. Setting `--ken-speed`
via `setProperty` while an animation is running causes a visible jump/restart. The spec's current approach
is architecturally broken for this one property.

**Fix:** Remove the `--ken-speed` CSS custom property write from the rAF loop. Replace with Web Animations
API `playbackRate` control on the running Ken Burns animation:

```
// REMOVE from useAudioVisualSync rAF loop:
root.style.setProperty('--ken-speed', ...)

// ADD instead:
const kenEl = document.querySelector('.ken-burns-stage');
const anim = kenEl?.getAnimations()[0];
if (anim) anim.playbackRate = 0.7 + energy * 0.6;
// Maps: 0.7x at silence -> 1.3x at narration peak
```

Keep all other CSS custom property writes (`--glow-opacity`, `--vig-spread`, `--cap-shadow`) — those are
consumed by static styles and work correctly.

**Also:** Move all `setProperty` calls from `:root` to the scoped player container element
(`document.getElementById('player-container')`). Writing to `:root` invalidates ALL style calculations
document-wide; a scoped container only invalidates its subtree.

**Done when:** Ken Burns smoothly speeds up during narration peaks with no jump or restart. No writes to `:root`.

---

## Agent-2 — Fix SSE Reconnection
**Priority:** P0 (Bug)
**File:** `frontend/src/hooks/useSSE.ts`

**Problem:** The current `useSSE.ts` has no reconnection logic. If the `EventSource` connection drops
(Cloud Run timeout, network flap), the stream is silently lost with no recovery. A 15-minute demo
session will almost certainly encounter this.

**Fix:** Add exponential backoff reconnection with jitter. Also wrap the 150ms drip interval dispatch
in React 19's `startTransition` to prevent SSE bursts from blocking user interactions.

```
// Reconnection skeleton:
const MAX_RETRIES = 5;
const retryCountRef = useRef(0);

function connect() {
  const es = new EventSource(url);
  es.onmessage = (e) => {
    retryCountRef.current = 0;               // reset on success
    pendingRef.current.push(JSON.parse(e.data));
  };
  es.onerror = () => {
    es.close();
    if (retryCountRef.current < MAX_RETRIES) {
      const base = Math.min(1000 * 2 ** retryCountRef.current, 30000);
      const jitter = base * 0.3 * Math.random();
      setTimeout(() => { retryCountRef.current++; connect(); }, base + jitter);
    }
  };
  return es;
}

// Drip interval — wrap state updates in startTransition:
import { startTransition } from 'react';
setInterval(() => {
  const batch = pendingRef.current.splice(0);
  if (!batch.length) return;
  startTransition(() => {
    useResearchStore.getState().applyBatch(batch);
  });
}, 150);
```

**Done when:** Dropping the network connection and reconnecting recovers the stream automatically.
SSE updates don't cause visible jank during user interaction.

---

## Agent-3 — Fix CSS Token Duplication (Tailwind v4)
**Priority:** P0 (Bug)
**File:** `frontend/src/index.css`

**Problem:** Tailwind v4 automatically exposes all `@theme {}` tokens as CSS custom properties.
The current `index.css` declares these colors a second time in a `:root {}` block, creating duplicates.

Also a Tailwind v4 breaking change: bare `border` utilities now default to `currentColor` (changed
from `gray-200` in v3). Any bare `border` on parchment elements uses text color.

**Fixes:**
1. Remove all color/font tokens from `:root {}` that already exist in `@theme {}`. Keep ONLY these
   in `:root`: `--ken-speed`, `--glow-opacity`, `--vig-spread`, `--cap-shadow`, `--shadow-warm`,
   `--ambient-color` (audio-reactive / JS-driven runtime values).
2. Audit all components for bare `border`, `border-t`, `border-l` utilities and add explicit colors:
   `border-[var(--bg4)]` or `border-[var(--color-bg4)]`.
3. Add `color-scheme: only dark` to `.player-root` so browser scrollbars and form controls render dark.

**Done when:** No duplicate token declarations. All bare borders have explicit colors. Player scrollbar is dark.

---

## Agent-4 — Conic-Gradient Rotating Border for Searching State
**Priority:** P1
**File:** `frontend/src/index.css`

**Context:** The CLAUDE.md specifies an animated conic-gradient border for agent cards in the `searching`
state using `@property --border-angle`. This is specified but not fully implemented — cards use a class
swap instead. `@property` is supported in all modern browsers (Chrome 85+, Safari 16.4+, Firefox 128+)
and enables true smooth CSS rotation with zero JS.

**Implementation:**

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
      var(--teal) 0%,
      transparent 30%,
      transparent 70%,
      var(--teal) 100%
    ) border-box;
  animation: rotate-border 3s linear infinite;
}

@keyframes rotate-border {
  to { --border-angle: 360deg; }
}
```

Also implement the `evaluating` state gold shimmer via `background-position` animation over a linear
gradient (sweeps left-to-right).

**Done when:** Searching cards show a smoothly rotating teal border arc. Evaluating cards show a gold
shimmer sweep. No JS required for either effect.

---

## Agent-5 — Media Session API Integration
**Priority:** P1
**Files:** `frontend/src/hooks/` (new file), `frontend/src/components/player/DocumentaryPlayer.tsx`

**Context:** The Media Session API integrates with OS media controls: macOS Control Center, iOS lock
screen, Android notification shade, AirPods controls. Full browser support. ~30 minutes to implement.
Judges testing on phones or with wireless headphones will notice this immediately — it makes the app
feel native, not web.

**Create `hooks/useMediaSession.ts`:**

```typescript
export function useMediaSession(segment: Segment | null) {
  useEffect(() => {
    if (!('mediaSession' in navigator) || !segment) return;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: segment.title,
      artist: 'AI Historian',
      album: 'Documentary Session',
      artwork: segment.imageUrls.slice(0,1).map(src => ({
        src, sizes: '512x512', type: 'image/jpeg'
      })),
    });

    navigator.mediaSession.setActionHandler('play',          () => playerStore.getState().resume());
    navigator.mediaSession.setActionHandler('pause',         () => playerStore.getState().pause());
    navigator.mediaSession.setActionHandler('nexttrack',     () => playerStore.getState().nextSegment());
    navigator.mediaSession.setActionHandler('previoustrack', () => playerStore.getState().previousSegment());
    navigator.mediaSession.setActionHandler('seekforward',   (d) => playerStore.getState().seekBy(d.seekOffset ?? 10));
    navigator.mediaSession.setActionHandler('seekbackward',  (d) => playerStore.getState().seekBy(-(d.seekOffset ?? 10)));
  }, [segment?.id]);
}
```

Call `useMediaSession(currentSegment)` in `DocumentaryPlayer.tsx`. Update `playbackState` on play/pause.
Update metadata on every segment transition.

**Done when:** macOS Control Center and iOS lock screen show segment title + Imagen 3 artwork during
playback. AirPods double-tap fires play/pause.

---

## Agent-6 — Ambient Color Glow (YouTube Ambient Mode)
**Priority:** P1
**Files:** `frontend/src/components/player/KenBurnsStage.tsx`, `frontend/src/index.css`

**Context:** When each Imagen 3 image loads, sample its dominant color using a 4x4 canvas downscale
and apply as a soft radial glow behind the player stage. This is YouTube's ambient mode adapted for
AI-generated still images. For still images it's simpler than live video — sample once per image on
load, no rAF required.

**Add to `KenBurnsStage.tsx`:**

```typescript
function sampleImageColor(img: HTMLImageElement): string {
  const canvas = document.createElement('canvas');
  canvas.width = 4; canvas.height = 4;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, 4, 4);
  const d = ctx.getImageData(0, 0, 4, 4).data;
  const r = Math.round((d[0]+d[4]+d[8]+d[12]) / 4);
  const g = Math.round((d[1]+d[5]+d[9]+d[13]) / 4);
  const b = Math.round((d[2]+d[6]+d[10]+d[14]) / 4);
  return `rgba(${r},${g},${b},0.3)`;
}

// In onLoad handler:
const color = sampleImageColor(imgEl);
playerContainerRef.current?.style.setProperty('--ambient-color', color);
```

**Add to `index.css`:**

```css
.player-stage::before {
  content: '';
  position: absolute;
  inset: -120px;
  background: var(--ambient-color, transparent);
  filter: blur(80px);
  transition: background 2.5s ease;
  pointer-events: none;
  z-index: -1;
}
```

**Done when:** As Ken Burns images transition between segments, a soft colored glow subtly shifts around
the player edges, matching each scene's dominant color.

---

## Agent-7 — React-Resizable-Panels (Resizable Workspace Split)
**Priority:** P1
**File:** `frontend/src/components/workspace/WorkspaceLayout.tsx`

**Context:** The current workspace uses a fixed 52%/48% CSS split (`w-[52%]` / `flex-1`).
`react-resizable-panels` (~7KB, by Brian Vaughn — React DevTools author, used by shadcn/ui) replaces
this with a user-resizable split with keyboard support, and localStorage persistence.

```bash
pnpm add react-resizable-panels
```

**Replace the fixed layout in `WorkspaceLayout.tsx`:**

```tsx
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';

<PanelGroup direction="horizontal" autoSaveId="workspace-layout">
  <Panel defaultSize={52} minSize={28}>
    <PDFViewer />
  </Panel>
  <PanelResizeHandle className="w-[5px] bg-[var(--bg4)] hover:bg-[var(--gold)]/40 transition-colors cursor-col-resize" />
  <Panel defaultSize={48} minSize={24}>
    {/* research + historian panels */}
  </Panel>
</PanelGroup>
```

The `autoSaveId` prop persists the user's preferred ratio across sessions via localStorage.

**Done when:** Users can drag the divider between the PDF viewer and research panel. Layout persists on
reload. Keyboard-accessible (arrow keys resize when handle is focused).

---

## Agent-8 — Self-Hosted Variable Fonts + CLS Fix
**Priority:** P1
**Files:** `frontend/public/fonts/`, `frontend/src/index.css`, `frontend/index.html`

**Context:** Current setup loads Cormorant Garamond and DM Sans from Google Fonts CDN (multiple static
weight files). Variable fonts: single `.woff2` per family, ~50% size reduction (250KB → 85KB Cormorant,
120KB → 45KB DM Sans). Fallback font metric overrides eliminate CLS when fonts load. The cipher
animation uses Greek/Cyrillic glyphs — those unicode ranges must be included.

**Steps:**
1. Download `CormorantGaramond-Variable.woff2` and `DMSans-Variable.woff2`
2. Place in `frontend/public/fonts/`
3. Add preload in `index.html`:
   ```html
   <link rel="preload" href="/fonts/CormorantGaramond-Variable.woff2"
         as="font" type="font/woff2" crossorigin>
   ```
4. Replace the Google Fonts `@import` in `index.css` with local `@font-face` declarations:

```css
@font-face {
  font-family: 'Cormorant Garamond';
  src: url('/fonts/CormorantGaramond-Variable.woff2') format('woff2-variations');
  font-weight: 300 700;
  font-style: normal;
  font-display: swap;
  /* Match Georgia fallback metrics to eliminate layout shift */
  ascent-override: 92%;
  descent-override: 25%;
  size-adjust: 105%;
  /* Latin + Greek + Cyrillic for cipher animation */
  unicode-range: U+0000-00FF, U+0370-03FF, U+0400-04FF, U+2000-206F;
}

@font-face {
  font-family: 'DM Sans';
  src: url('/fonts/DMSans-Variable.woff2') format('woff2-variations');
  font-weight: 100 1000;
  font-style: normal;
  font-display: optional; /* System fallback on first load — no CLS */
}
```

5. Add `font-optical-sizing: auto` to DM Sans usage contexts for free legibility at small sizes.

**Done when:** No Google Fonts CDN requests. Zero layout shift on font load. Cipher animation renders
Greek/Cyrillic glyphs correctly.

---

## Agent-9 — AudioWorklet for Both Capture AND Playback
**Priority:** P1
**Files:** `frontend/src/hooks/useAudioCapture.ts`, `frontend/src/hooks/useAudioPlayback.ts`,
`frontend/public/worklets/`

**Context:** Both microphone capture (PCM 16kHz encode) AND PCM playback (24kHz decode) must run on
AudioWorklet threads — off the main thread. The main thread is shared with React re-renders, rAF loops,
and GC. Keeping audio on the main thread causes glitches and latency spikes under load.

Full interruption budget: Gemini VAD ~100-150ms + relay ~5-10ms + AudioWorklet flush ~3ms (one 128-sample
render quantum at 24kHz) = **~110-165ms total**. Well under 300ms target.

**Steps:**
1. Create `frontend/public/worklets/pcm-playback.worklet.js`:
   - Maintains a `Float32Array[]` queue
   - Responds to `{ type: 'chunk', samples }` and `{ type: 'flush' }` via `this.port.onmessage`
   - On `flush`: clears queue immediately (stops audio in one render quantum = ~3ms)
   - Fills silence on underrun (prevents click artifacts)

2. Create `frontend/public/worklets/pcm-capture.worklet.js`:
   - Receives Float32 mic samples at system sample rate
   - Downsamples to 16000 Hz (linear interpolation)
   - Converts Float32 → Int16 (multiply by 32767, clamp)
   - Posts `ArrayBuffer` back to main thread via `port.postMessage(buffer, [buffer])` (transfer = zero-copy)

3. Update `useAudioPlayback.ts`:
   - `new AudioContext({ sampleRate: 24000 })` — matches Gemini output, avoids resampling
   - Load worklet via `context.audioWorklet.addModule('/worklets/pcm-playback.worklet.js')`
   - `feedChunk(pcmBytes)`: decode Int16 → Float32, post to worklet with buffer transfer
   - `flush()`: post `{ type: 'flush' }` to worklet port

4. Update `useAudioCapture.ts` to use the capture worklet. Add `comlink` for ergonomic RPC:
   ```bash
   pnpm add comlink
   ```

5. Pre-buffer 3 chunks before connecting worklet output to destination (prevents initial underrun click).

**Done when:** Audio capture and playback are both off-main-thread. Interruption stops audio within
one render quantum (~3ms). No glitches when React renders heavily.

---

## Agent-10 — CSS Custom Highlight API for Entity Highlighting
**Priority:** P2
**File:** `frontend/src/components/workspace/PDFViewer.tsx`

**Context:** Full browser support as of 2026 (Chrome 105+, Firefox 140+, Safari 17.2+). The CSS Custom
Highlight API highlights text ranges without mutating the DOM. The current approach wraps pdfjs text layer
`<span>` elements in `<mark>` tags — fragile because pdfjs can re-render and destroy the highlights.
Range-based highlighting is the correct architecture.

**Replace `applyEntityHighlights` with:**

```typescript
function highlightEntities(container: HTMLDivElement, entities: string[]) {
  if (!CSS.highlights) {
    // Fallback: keep existing DOM mutation approach
    applyEntityHighlightsFallback(container, entities);
    return;
  }

  CSS.highlights.delete('entity-matches');
  if (!entities.length) return;

  const escaped = entities.map(e => e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`(${escaped.join('|')})`, 'gi');
  const ranges: Range[] = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);

  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const text = node.textContent ?? '';
    let m: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((m = pattern.exec(text)) !== null) {
      const r = new Range();
      r.setStart(node, m.index);
      r.setEnd(node, m.index + m[0].length);
      ranges.push(r);
    }
  }

  if (ranges.length) CSS.highlights.set('entity-matches', new Highlight(...ranges));
}
```

```css
::highlight(entity-matches) {
  background-color: rgba(139, 94, 26, 0.22);
  color: var(--text);
}
```

**Done when:** Entity highlighting survives pdfjs text layer re-renders. CSS Custom Highlight used in
Chrome/Firefox/Safari with DOM fallback for older browsers.

---

## Agent-11 — Scroll-to-Entity Bridge (PDF ↔ Research Panel)
**Priority:** P2
**Files:** `frontend/src/components/workspace/PDFViewer.tsx`,
`frontend/src/components/workspace/ResearchPanel.tsx`,
`frontend/src/components/workspace/WorkspaceLayout.tsx`

**Context:** Missing interaction: when a user clicks an entity mention in the research panel or agent
logs, the PDF viewer should scroll to and pulse the matching highlighted word. This is the most visible
cross-panel interaction in the app — directly demonstrates "seamless multimodal interleaving" to judges.

**Steps:**
1. Expose `scrollToEntity(text: string)` from `PDFViewer` via `useImperativeHandle` on a ref
2. Store a `pdfViewerRef` in `WorkspaceLayout` and pass it to both panels
3. Add click handlers to entity chips in `AgentModal` and `ResearchPanel`
4. Add the pulse animation:

```css
@keyframes entity-pulse {
  0%   { background: rgba(139, 94, 26, 0.22); }
  50%  { background: rgba(139, 94, 26, 0.55); box-shadow: 0 0 12px rgba(139,94,26,0.35); }
  100% { background: rgba(139, 94, 26, 0.22); }
}
.entity-highlight.entity-pulse {
  animation: entity-pulse 1.5s ease-in-out;
}
```

5. Add a reading progress bar — 2px gold bar at the top of the PDF viewer panel:

```tsx
<div className="h-[2px] bg-[var(--bg4)]">
  <div className="h-full bg-[var(--gold)] transition-[width] duration-200"
       style={{ width: `${scrollProgress}%` }} />
</div>
```

Derive `scrollProgress` from `scrollTop / (scrollHeight - clientHeight) * 100`.

**Done when:** Clicking an entity in the research panel scrolls the PDF to that word and pulses it.
Progress bar reflects document reading progress.

---

## Agent-12 — React Compiler + Bundle Splitting
**Priority:** P2
**Files:** `frontend/vite.config.ts`, `frontend/src/App.tsx`

**Context:** React Compiler (beta, 2026) auto-memoizes components at build time — removes the need for
manual `useMemo`/`useCallback`/`memo()`. Main benefit: the research panel with 10+ agent cards
re-rendering on every SSE batch. Bundle splitting isolates `pdfjs-dist` (~400KB gzipped) to the workspace
route, keeping initial load at ~120KB.

**Steps:**

1. Install React Compiler:
```bash
pnpm add -D babel-plugin-react-compiler eslint-plugin-react-compiler
```

Configure in `vite.config.ts`:
```typescript
react({
  babel: {
    plugins: [['babel-plugin-react-compiler']],
  },
}),
```

2. Route-based lazy loading in `App.tsx`:
```tsx
const UploadPage    = lazy(() => import('./pages/UploadPage'));
const WorkspacePage = lazy(() => import('./pages/WorkspacePage'));
const PlayerPage    = lazy(() => import('./pages/PlayerPage'));
```

3. Manual chunk splitting in `vite.config.ts`:
```typescript
build: {
  rollupOptions: {
    output: {
      manualChunks: {
        'vendor-react':  ['react', 'react-dom', 'react-router-dom'],
        'vendor-motion': ['motion'],
        'vendor-data':   ['zustand', '@tanstack/react-query'],
        'vendor-pdf':    ['pdfjs-dist'],  // workspace route only
      },
    },
  },
},
```

4. Chunk preloading on navigation intent:
```typescript
// In UploadPage — after upload starts:
onUploadStart: () => import('./pages/WorkspacePage'),

// In WorkspacePage — when first segment ready:
onFirstSegment: () => import('./pages/PlayerPage'),
```

5. Add `rollup-plugin-visualizer` to verify bundle sizes:
```bash
pnpm add -D rollup-plugin-visualizer
```

**Expected sizes:** ~120KB gzipped initial, ~200KB at workspace (with pdfjs-dist).

**Done when:** React Compiler enabled. Route-based splitting active. `pdfjs-dist` absent from initial
bundle. Visualizer output shows targets met.

---

## Agent-13 — Fluid Type Scale + CSS Design System Polish
**Priority:** P2
**File:** `frontend/src/index.css`

**Context:** Three independent polish items that fit together naturally:
(1) `clamp()` fluid type scale for captions and headers
(2) `color-mix()` warm hover states (archival warmth instead of generic darkening)
(3) CSS vignette for document viewer and player
(4) `font-optical-sizing: auto` for DM Sans small text

**Steps:**

1. Add `clamp()` fluid type scale to `@theme`:
```css
@theme {
  --text-caption: clamp(1.5rem, 1.3rem + 0.8vw, 1.75rem);   /* 24-28px */
  --text-segment: clamp(1.125rem, 1rem + 0.5vw, 1.375rem);   /* 18-22px */
  --text-header:  clamp(1.75rem, 1.5rem + 1vw, 2.25rem);     /* 28-36px */
}
```

2. Add warm hover states via `color-mix()`:
```css
@theme {
  --color-bg-hover:  color-mix(in oklch, var(--color-bg) 92%, var(--color-gold) 8%);
  --color-bg-active: color-mix(in oklch, var(--color-bg) 85%, var(--color-gold) 15%);
}
```
Replace `hover:bg-[var(--bg3)]` patterns with `hover:bg-[var(--color-bg-hover)]`.

3. Add vignettes — soft on document viewer, heavy on player:
```css
.pdf-viewer-container::after {
  content: ''; position: absolute; inset: 0; pointer-events: none;
  background: radial-gradient(ellipse 70% 70% at 50% 50%,
    transparent 40%, rgba(92,61,14,0.04) 70%, rgba(30,23,12,0.10) 100%);
}

.ken-burns-stage::after {
  content: ''; position: absolute; inset: 0; pointer-events: none;
  background: radial-gradient(ellipse 80% 80% at 50% 50%,
    transparent 30%, rgba(13,11,9,0.35) 65%, rgba(13,11,9,0.8) 100%);
}
```

4. Add `font-optical-sizing: auto` to DM Sans usage sites:
```css
.body-text, .agent-log, .metadata, .status-label {
  font-optical-sizing: auto;
}
```

**Done when:** Captions and segment titles scale fluidly with viewport. Hover states warm toward gold.
Vignettes applied. No legibility issues at small DM Sans sizes.

---

## Agent-14 — Memory Bounds + Progressive Phase Collapse
**Priority:** P2
**Files:** `frontend/src/store/researchStore.ts`,
`frontend/src/components/workspace/ExpeditionLog.tsx`

**Context:** Two P2 improvements that share a theme (long-session UX):
(1) The Zustand research store has no bounds on `evaluatedSources` per agent — over 15 minutes with
many sources evaluated, memory grows unbounded.
(2) The ExpeditionLog shows all log entries for all phases at full size — as the pipeline advances,
early phases accumulate entries that cause scroll fatigue and visual noise.

**Steps:**

1. Cap `evaluatedSources` per agent in `researchStore.ts` `applyBatch`:
```typescript
// After processing agent_source_evaluation:
const MAX_SOURCES = 50;
if (draft.agents[id].evaluatedSources.length > MAX_SOURCES) {
  draft.agents[id].evaluatedSources = draft.agents[id].evaluatedSources.slice(-MAX_SOURCES);
}
```

2. Reset store on workspace exit:
```typescript
// In WorkspacePage.tsx
useEffect(() => () => useResearchStore.getState().reset(), []);
```

3. Auto-collapse completed phases in `ExpeditionLog.tsx`:
```tsx
function PhaseSection({ phase, isActive }) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (!isActive && phase.status === 'done') {
      const t = setTimeout(() => setCollapsed(true), 2000);
      return () => clearTimeout(t);
    }
  }, [isActive, phase.status]);

  return (
    <div>
      <button onClick={() => setCollapsed(c => !c)} className="phase-header w-full">
        <PhaseIcon status={phase.status} />
        <span>{phase.label}</span>
        <ChevronIcon collapsed={collapsed} />
      </button>
      <AnimatePresence>
        {!collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
          >
            {phase.entries.map(e => <LogEntry key={e.id} entry={e} />)}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
```

4. Add `subscribeWithSelector` middleware to `researchStore` to enable selector-based `.subscribe()`
calls from non-React code (e.g. Sonner toasts when `segmentsReady` increments):
```typescript
import { subscribeWithSelector } from 'zustand/middleware';
export const useResearchStore = create()(subscribeWithSelector(immer((set) => ({ ... }))));
```

**Done when:** No unbounded growth during long sessions. Completed phases auto-collapse after 2 seconds.
Sonner toast can subscribe to `segmentsReady` changes imperatively.

---

## Execution Order

| Wave | Agents | Note |
|---|---|---|
| Wave 1 | 1, 2, 3 | P0 bugs — run in parallel, no dependencies |
| Wave 2 | 4, 5, 6, 7 | P1 features — after bugs fixed |
| Wave 3 | 8, 9 | P1 infrastructure — font + audio (can run parallel to wave 2) |
| Wave 4 | 10, 11, 12, 13, 14 | P2 polish — after wave 3 |

---

## Skip List (Researched, Not Recommended)

| Technique | Reason |
|---|---|
| GSAP ScrollTrigger | Motion covers all scroll needs; +23KB, second paradigm |
| Theatre.js | Keyframed editor — project needs procedural/data-driven animation |
| WebGL Ken Burns with depth maps | CSS covers 90% of impact; Three.js adds 185KB + depth pipeline |
| Spatial audio (PannerNode) | Single narrator — minimal value to judges |
| Document Picture-in-Picture | Chrome/Edge only, not a core interaction path |
| wavesurfer.js / peaks.js / Tone.js | File-based tools — wrong for real-time streaming voice |
| Silero VAD (@ricky0123/vad-web) | 2-3MB bundle; redundant with Gemini server-side VAD |
| ReactFlow agent DAG | 150KB; wrong aesthetic; pipeline is fixed not editable |
| react-lazylog | Mozilla archived; unmaintained |
| TanStack Query for SSE | Zustand batch pattern is more appropriate |
| React 19 Server Actions / useFormStatus | Requires Next.js RSC — not applicable to Vite SPA |
| light-dark() CSS function | App has fixed light/dark contexts per screen |
| Water stain / age spot decorative effects | Risks looking kitschy not archival-elegant |
| File System Access API | No Safari/Firefox support |
| PSPDFKit / PDFTron | Commercial licensing + massive bundle |
| react-pdf (wojtekmaj) | Wrapper blocks custom TextLayer manipulation |
| allotment split-pane | Heavier with fewer downloads than react-resizable-panels |
| WebCodecs for live PCM | Raw PCM needs no codec |
| CSS scroll-driven animation-timeline | Progressive enhancement only — Motion whileInView is primary |
