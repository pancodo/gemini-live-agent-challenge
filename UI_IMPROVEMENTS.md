# UI Improvements Plan

Minimalistic, focused improvements only. No new libraries. No new complexity.
One agent = one self-contained task.

---

## agent-1 — TopNav: Logo link + inline doc rename

**File:** `frontend/src/components/workspace/TopNav.tsx`

**What's broken now:**
- "AI Historian" logo text is just a `<span>` — clicking it does nothing
- Document filename shows the raw GCS filename (e.g. `sample-pompeii.pdf`) and is not editable
- No way to go back to Upload from Workspace

**What to build:**
1. Wrap logo text in `<Link to="/" onClick={reset}>` — clicking logo resets session and goes home
2. Make the filename in the center clickable. On click → turns into an `<input>` with the current name pre-filled. `Enter` or `blur` commits to `sessionStore`. `Escape` cancels. Instant, no modal.
3. Add a subtle `←` back chevron icon before the logo on small screens (hidden on wide)

**Rules:**
- No new component files — edit `TopNav.tsx` only
- The input should look identical to the text it replaces (same size, same color, just focusable)
- `sessionStore.reset()` already exists — just call it

---

## agent-2 — Pipeline phase indicator

**Files:** `frontend/src/components/workspace/TopNav.tsx`, `frontend/src/store/researchStore.ts`

**What's broken now:**
- During processing, the TopNav only shows a plain elapsed timer (`2:14`). No sense of progress.
- The 5 phases (Scan → Research → Synthesis → Visual Composition → Generation) are tracked in `researchStore.phases` via SSE `pipeline_phase` events but not shown anywhere outside ExpeditionLog.

**What to build:**
A single row of 5 small dots directly below the `<header>` in TopNav, visible only when `status === 'processing'`.

```
● ● ○ ○ ○    Phase II — Field Research
```

- Filled dot = phase complete
- Pulsing dot = phase active
- Empty dot = not started
- Label shows current phase name next to dots
- Row fades in when processing starts, fades out when done

**Rules:**
- Pure CSS dots using `<span>` — no SVG, no icons
- One `<div>` row, 5 dots, one label. That's it.
- Read current active phase from `researchStore` — the store already tracks `phases[]` from SSE

---

## agent-3 — Player: missing keyboard shortcuts

**File:** `frontend/src/components/player/DocumentaryPlayer.tsx`

**What exists already:** `←` / `→` for segment navigation, `Escape` to close sidebar.

**What's missing:**

| Key | Action |
|-----|--------|
| `Escape` | Navigate back to `/workspace` (currently only closes sidebar) |
| `F` | Toggle fullscreen (`document.documentElement.requestFullscreen()`) |
| `Space` | Toggle voice button (dispatch to `voiceStore`) |

**What to build:**
1. Expand the existing `onKeyDown` handler in `DocumentaryPlayer.tsx`:
   - `Escape` with sidebar closed → `navigate('/workspace')`
   - `F` → `document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()`
   - `Space` → toggle `voiceStore.isActive` (prevent default to stop page scroll)

2. A tiny `?` pill button in the player top bar (next to the `1 / 3` index). On click, shows a small absolute-positioned tooltip listing the shortcuts. Dismiss on click-outside. No modal, no Radix Dialog — just a `<div>` with `position: absolute`.

**Rules:**
- No new files
- The shortcuts tooltip is max 6 lines, plain text, no icons
- Fullscreen only if `document.fullscreenEnabled`

---

## agent-4 — Recent sessions on Upload page

**Files:** `frontend/src/pages/UploadPage.tsx`, `frontend/src/store/sessionStore.ts`

**What's broken now:**
- `sessionStore` persists one session (sessionId + gcsPath) but there's no history list.
- If you upload a new doc, the old session is silently overwritten.
- Upload page has no way to return to an in-progress or completed session.

**What to build:**
1. Add a `recentSessions` array to `sessionStore` (max 5 entries). Each entry: `{ sessionId, label, status, createdAt }`.
2. When `setSession()` is called with a new sessionId, prepend it to `recentSessions` and trim to 5.
3. On `UploadPage`, add a `<RecentSessions />` section below the sample docs. Shows max 3 cards. Each card: doc label, timestamp, status badge, and a "Resume →" button that calls `setSession()` with that entry and navigates to `/workspace`.
4. Cards only show if `recentSessions.length > 0` — otherwise the section is invisible.

**Rules:**
- `RecentSessions` is a local function component inside `UploadPage.tsx` (like `SampleDocuments` already is)
- No new files
- The "label" defaults to the filename, but uses the renamed doc name if `agent-1` rename feature is used
- Status badge reuses the existing `<Badge>` component

---

## agent-5 — "Watch Documentary" banner when pipeline is ready

**File:** `frontend/src/pages/WorkspacePage.tsx`

**What's broken now:**
- When `status === 'ready'`, the app switches from `<ExpeditionLog>` to `<ResearchPanel>`. But there's no clear signal to the user that the documentary is actually ready to watch. The only way to launch the player is to scroll down to a segment card and click the small "▶ Watch" button.
- The pipeline success moment has no fanfare.

**What to build:**
A slim banner that appears at the very top of the right panel when `status === 'ready'` and at least one segment is `ready`.

```
┌─────────────────────────────────────────────────────┐
│  ● Documentary ready · 4 chapters                   │
│                              [Watch Documentary →]  │
└─────────────────────────────────────────────────────┘
```

- Gold left border accent
- Clicking "Watch Documentary →" triggers `triggerIris` on the first ready segment
- Banner animate-in with `motion/react` `y: -8 → 0, opacity: 0 → 1`
- No dismiss button — it stays until user navigates to player
- If no segments are ready yet, show "Preparing your documentary…" with a pulsing dot instead of the CTA

**Rules:**
- Inline in `WorkspacePage.tsx` as a local `ReadyBanner` component
- No new files
- Reuses `usePlayerStore(s => s.triggerIris)` and `useResearchStore` — already imported in the page

---

## agent-6 — Settings popover in TopNav

**File:** `frontend/src/components/workspace/TopNav.tsx`

**What's missing:**
- No way for users to toggle reduced motion preference (the app respects `prefers-reduced-motion` via `useReducedMotion()` from Motion, but some users want to force it off even if their OS doesn't have it set)
- No persistent user preference storage

**What to build:**
A gear icon `⚙` button on the right side of TopNav (before the status badge). Clicking it opens a small `<div>` positioned absolutely below it.

Contents of the popover (3 rows max):

```
○ Reduced motion
○ Auto-watch when ready
```

- Toggle switches using a plain `<button>` that flips a boolean — styled as a pill that moves left/right.
- State stored in `localStorage` via a new tiny `useSettings` hook (one file: `frontend/src/hooks/useSettings.ts`)
- `reducedMotion` preference: when `true`, wraps the app in a CSS class `.reduced-motion` that sets `* { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }`
- `autoWatch` preference: when `true`, `WorkspacePage` auto-calls `triggerIris` when the first segment becomes ready
- Popover closes on click-outside via a `useEffect` + `mousedown` listener

**Rules:**
- One new file only: `frontend/src/hooks/useSettings.ts`
- The popover `<div>` lives inside `TopNav.tsx` — no Radix Dialog
- Toggle component is ~10 lines of JSX inline, no separate file

---

## Execution order

```
agent-1  →  agent-2  (both touch TopNav — do sequentially)
agent-3              (standalone — player only)
agent-4              (standalone — upload page + store)
agent-5              (standalone — workspace page only)
agent-6  (after agent-1, shares TopNav file)
```

agent-3, agent-4, agent-5 can run in parallel.
agent-1 must complete before agent-2 and agent-6.

---

## What we deliberately excluded

| Idea | Why excluded |
|------|--------------|
| Command palette ⌘K | Too heavy for the interaction model — this isn't a productivity app |
| Notification center | Sonner toasts are sufficient — a bell icon adds chrome without value |
| Drag-to-resize panels | The 52/48 split is intentional — resize adds complexity for no demo gain |
| Chapter strip in player | PlayerSidebar already covers this |
| Share / export | Out of scope for demo day |
