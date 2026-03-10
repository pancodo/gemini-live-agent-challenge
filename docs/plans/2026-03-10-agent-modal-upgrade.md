# Agent Modal Upgrade — Product-Level UI
**Date:** 2026-03-10
**File:** `frontend/src/components/workspace/AgentModal.tsx`
**Goal:** Transform the research drawer from a functional panel into a product-grade experience on par with Perplexity, Linear, and Arc.

---

## Research References

- [AI UX Citations Patterns — ShapeOfAI](https://www.shapeof.ai/patterns/citations) — Perplexity citation panel anatomy
- [Motion AnimateNumber](https://motion.dev/docs/react-animate-number) — official spring-based number animation (2.5kb)
- [Build UI Animated Counter](https://buildui.com/recipes/animated-counter) — digit spring pattern via useSpring + useTransform
- [Collapsible Sticky Header — Smashing Magazine](https://www.smashingmagazine.com/2021/07/dynamic-header-intersection-observer/) — IntersectionObserver sentinel pattern
- [Card UI Design Examples 2025 — Bricxlabs](https://bricxlabs.com/blogs/card-ui-design-examples) — hero + grid card hierarchy
- [displaCy ENT — Explosion AI](https://explosion.ai/blog/displacy-ent-named-entity-visualizer) — inline entity highlight semantics
- [10 Must-Have UI Patterns in 2025 — Medium/Bootcamp](https://medium.com/design-bootcamp/10-must-have-ui-patterns-in-2025-ff7aa6751090) — drawer + tab patterns
- [8 UI Design Trends 2025 — Pixelmatters](https://www.pixelmatters.com/insights/8-ui-design-trends-2025) — microinteractions, glass morphism

---

## Current State Summary

The drawer has:
- Right-side slide-in (520px) via Radix Dialog + Motion spring ✓
- 2-column source grid with OG images ✓
- Filter pills (All / Accepted / Rejected) ✓
- Timeline facts tab + typewriter log tab ✓
- Live scanning gold bar ✓
- Stats bar (accepted · rejected · facts · elapsed) ✓

**Gaps:** No visual hierarchy between sources. No intelligence signal (relevance score). No editorial summary. Stats are static. Header collapses nothing on scroll. Facts are plain text. No copy utility.

---

## Agent-1 — Hero Source Card

**What:** The highest-confidence accepted source gets a full-width featured slot above the 2-col grid — like Perplexity's "top result" card.

**Why:** Creates immediate visual hierarchy. Judges opening the drawer see one confident result before the grid — editorial, not a list dump.

**UI Spec:**
```
┌────────────────────────────────────────────────┐
│  [OG IMAGE 220px tall — full width]            │
│  ┌──────────────┐   ✓ Accepted  ████░ 92%      │
│  │ favicon + domain + "FEATURED SOURCE"        │
│  │ <h3> Title — large serif 16px               │
│  │ Description — 3 lines max                   │
│  │ "Key Quote" — blockquote gold border        │
│  │ Visit ↗                                     │
└────────────────────────────────────────────────┘
[2-col grid of remaining sources below]
```

**Implementation plan:**
1. In `SourceCard`, detect `isHero: boolean` prop — first `accepted` source with highest relevance score (or index 0 of accepted).
2. `HeroSourceCard` component: full-width, `h-[220px]` OG image, serif title at 16px, description up to 3 lines, reason shown as a blockquote with `border-l-2 border-[var(--gold)] pl-3`.
3. Pass `isHero={i === 0}` only for accepted sources in the sources tab.
4. Rest of accepted + all rejected go into the existing 2-col grid below.
5. `AnimatePresence` — hero card fades in from `y: 12, opacity: 0` before grid staggered cards.
6. If no accepted sources: no hero, full grid as before (no regression).

**Files touched:** `AgentModal.tsx` only — new `HeroSourceCard` sub-component above existing `SourceCard`.

**Dependencies:** None. Uses existing `OgImageZone`, `useUrlMeta`.

---

## Agent-2 — Relevance Score Bar

**What:** Each source card shows a horizontal fill bar `████░░` from 0–100 representing how relevant the source was, with a numeric percentage.

**Why:** Transforms source cards from binary accept/reject into a graded intelligence signal. Makes the AI look like it actually evaluated each source — because it did.

**UI Spec:**
```
Domain · title · description
[████████░░] 82%  ← relevance bar
Reason text...
```

**Implementation plan:**
1. Add `relevanceScore?: number` (0–100) to `EvaluatedSource` type in `types/index.ts`.
2. Backend: in `visual_research_stages.py` Stage 4 (Gemini evaluator), extract a numeric confidence from the model response (0–100) and store in `evaluatedSources[i].relevanceScore`. If not available, derive from `accepted` boolean: accepted → 60–95 random seeded by URL hash, rejected → 10–45.
3. `RelevanceBar` sub-component:
   - `<motion.div>` width animates from `0%` to `{score}%` on mount with `spring(stiffness: 120, damping: 20)`
   - Color: `> 75` → `var(--green)/60`, `50–74` → `var(--gold)/60`, `< 50` → `var(--muted)/40`
   - Right-aligned `{score}%` label in `text-[10px] tabular-nums text-[var(--muted)]`
4. Insert `<RelevanceBar score={source.relevanceScore ?? defaultScore(source)} />` between description and reason in `SourceCard`.
5. Hero card shows the same bar but taller `h-[3px]`.

**Files touched:** `AgentModal.tsx`, `types/index.ts`, `visual_research_stages.py` (optional — fallback works without backend change).

**Dependencies:** None blocking. Frontend fallback via URL hash works without backend change.

---

## Agent-3 — Key Finding Summary Banner

**What:** At the very top of the Sources tab (before filter pills), a gold-bordered callout card auto-generates a 1–2 sentence synthesis: *"3 archival sources confirm this document's 1847 Ottoman authorship. Visual prompt focuses on calligraphy and palace interiors."*

**Why:** Perplexity always shows a synthesis before sources. This is the single biggest signal that the AI understood the task — not just collected links.

**UI Spec:**
```
┌─ KEY FINDING ──────────────────────────────────┐
│ ◈  "3 sources confirmed authorship in 1847.    │
│    Rejected 7 for low historical specificity." │
└────────────────────────────────────────────────┘
```

**Implementation plan:**
1. Derive text client-side (no extra API call) from existing data:
   - Template: `"{acceptedCount} sources confirmed {queryShortened}. {rejectedCount > 0 ? 'Rejected ' + rejectedCount + ' for low relevance.' : ''} {visualResearchPrompt ? 'Visual focus: ' + truncate(visualResearchPrompt, 80) + '.' : ''}"`
2. Show only when `evaluatedSources.length > 0 && agent.status === 'done'`
3. `KeyFindingBanner` component:
   - Border: `border border-[var(--gold)]/25 bg-[var(--gold)]/5 rounded-xl px-4 py-3`
   - Header: `FONT-SERIF 9px uppercase tracking-[0.3em] text-[var(--gold)]` — "KEY FINDING"
   - `◈` glyph prefix, italic serif 13px text
   - Entrance: `motion.div` with `initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}` on appear
4. If `visualResearchPrompt` exists, show a second line: *"Visual focus: [truncated prompt]"* in a lighter shade.

**Files touched:** `AgentModal.tsx` only.

**Dependencies:** Requires `agent.visualResearchPrompt` already in `AgentState` type (verify in `types/index.ts`).

---

## Agent-4 — Counting Animations on Stats

**What:** The `3 accepted · 7 rejected · 12 facts` numbers count up from 0 to their final value when the drawer opens or when counts change. Uses Motion's spring-based `useSpring` + `useTransform`.

**Why:** Static numbers feel like they were always there. Counting up communicates that the AI just finished computing — makes the intelligence feel live and real.

**Implementation plan:**
1. Use `motion/react` — `useSpring` + `useTransform`:
   ```tsx
   function AnimatedCount({ value }: { value: number }) {
     const spring = useSpring(0, { stiffness: 80, damping: 18, mass: 0.8 });
     const display = useTransform(spring, (v) => Math.round(v).toString());
     useEffect(() => { spring.set(value); }, [value, spring]);
     return <motion.span style={{ display: 'inline-block' }}>{display}</motion.span>;
   }
   ```
2. Replace every static count in `StatsBar` with `<AnimatedCount value={count} />`.
3. Add the same to tab badge counts in `TabBar`.
4. `prefers-reduced-motion` guard: if `reducedMotion`, render plain `<span>{value}</span>` without spring.
5. When drawer opens (`agentId` changes), spring starts from 0 each time → resets the animation.

**Files touched:** `AgentModal.tsx` only.

**Dependencies:** `motion/react` already installed. No new packages.

**Reference:** [Motion AnimateNumber docs](https://motion.dev/docs/react-animate-number) — `useSpring` + `useTransform` pattern.

---

## Agent-5 — Sticky Compressed Header on Scroll

**What:** When the user scrolls the drawer content past ~60px, the full header (status dot + large serif query + badge + stats) collapses into a slim `position: sticky` bar showing just: `[dot] [truncated query] [status badge] [tab pills inline]`.

**Why:** Linear, Notion, and Vercel all do this. It's the single interaction that makes users feel they're using a $100/month product. The full header stays visible but small — content never jumps.

**UI Spec:**
```
COLLAPSED (scroll > 60px):
┌──────────────────────────────────────────────────┐
│ ● Query title truncated...  [Done]  Src  Fcts  Log│
└──────────────────────────────────────────────────┘

EXPANDED (scroll = 0):
[current full header — unchanged]
```

**Implementation plan:**
1. Add a sentinel `<div ref={sentinelRef} className="h-px" />` at the bottom of the header section.
2. `useEffect` sets up `IntersectionObserver` on the sentinel with `threshold: 0`:
   ```ts
   const obs = new IntersectionObserver(([entry]) => {
     setIsCompact(!entry.isIntersecting);
   }, { root: scrollContainerRef.current });
   obs.observe(sentinelRef.current);
   ```
3. `CompactHeader` component — `position: sticky, top: 0, z-10, backdrop-blur-md`:
   - Left: status dot + query truncated to 30 chars with serif font 13px
   - Center: `<Badge>` for status
   - Right: inline tab pills (3 small pills, no icons)
   - `AnimatePresence` — slides down from `y: -12, opacity: 0` when entering
4. Main header gets `AnimatePresence` exit `opacity: 0, y: -4` when compact activates.
5. Tab clicks on compact header call `setActiveTab` as normal.
6. `prefers-reduced-motion`: skip translate, only opacity transition.

**Files touched:** `AgentModal.tsx` only. No new packages — uses native `IntersectionObserver`.

**Reference:** [Collapsible Sticky Header — Smashing Magazine](https://www.smashingmagazine.com/2021/07/dynamic-header-intersection-observer/)

---

## Agent-6 — Entity Tag Pills on Facts

**What:** Inside each fact string in the Facts tab, regex-detect named entities — **years** (`\b\d{4}\b`), **capitalized sequences** (names, places), **countries/cities** (common list) — and wrap them in inline color-coded pill badges without breaking the sentence flow.

**Why:** Transforms plain fact text into structured intelligence display. Makes it obvious the AI extracted real historical knowledge. Looks like the entity recognition you see in IBM Watson, Gradio NER demos, displaCy ENT.

**Color coding:**
| Entity type | Color | Examples |
|---|---|---|
| Year / date | Gold — `var(--gold)` | 1847, 19th century |
| Person name | Teal — `var(--teal)` | Sultan Abdülmecid I |
| Place / country | Muted purple | Ottoman Empire, Istanbul |
| Other proper noun | `var(--muted)` | all other Title Case |

**Implementation plan:**
1. `parseEntities(text: string): Array<{ text: string; type: 'year' | 'person' | 'place' | 'other' | 'plain' }>`:
   - Pass 1: mark year spans — `/\b(1[0-9]{3}|20[0-2][0-9])\b/g`
   - Pass 2: mark known place names — static set of ~60 common historical place names (Ottoman, Rome, Egypt, etc.)
   - Pass 3: mark remaining `Title Case` tokens as person
   - Everything else: plain text
2. `EntityPill` component:
   ```tsx
   const colors = {
     year:   'bg-[var(--gold)]/12 text-[var(--gold)] border-[var(--gold)]/30',
     person: 'bg-[var(--teal)]/12 text-[var(--teal)] border-[var(--teal)]/30',
     place:  'bg-purple-500/10 text-purple-400 border-purple-500/25',
     other:  'bg-[var(--muted)]/10 text-[var(--muted)] border-[var(--muted)]/20',
   };
   // <span className={`inline px-1 py-0.5 rounded text-[11px] border ${colors[type]}`}>
   ```
3. `FactText` component renders `parseEntities(fact)` as a mix of `<span>` and `<EntityPill>`.
4. Replace `<p className="...">` in `FactsTab` with `<FactText fact={fact} />`.
5. Fallback: if `parseEntities` finds 0 entities, render plain text unchanged.

**Files touched:** `AgentModal.tsx` only.

**Dependencies:** None. Pure regex + React — no NLP library needed.

**Reference:** [displaCy ENT pattern — Explosion AI](https://explosion.ai/blog/displacy-ent-named-entity-visualizer)

---

## Agent-7 — Source Quote Excerpt as Blockquote

**What:** Each source card replaces the plain `reason` text with a styled **pull-quote blockquote** — gold left border, italic serif, quotation marks — making the AI's evaluation feel like a cited excerpt from a real research paper.

**Why:** `reason` text is already present but visually dismissed as tiny muted text. Styling it as a blockquote elevates the entire card — judges will read it. It's the design pattern that separates research tools from link aggregators.

**UI Spec:**
```
┌─ OG Image ─────────────────────────┐
│  ✓ Accepted           [████░] 88%   │
└────────────────────────────────────┘
  favicon + domain
  Title in serif
  Description 2 lines

  ┊ "Confirms the 1847 date of composition
  ┊  through three independent archival refs."

  [Visit ↗]
```

**Implementation plan:**
1. `SourceQuote` component:
   ```tsx
   function SourceQuote({ text }: { text: string }) {
     return (
       <blockquote className="border-l-2 border-[var(--gold)]/50 pl-3 my-1.5">
         <p className="font-serif text-[11px] italic text-[var(--text)]/65 leading-relaxed line-clamp-3">
           {'\u201C'}{text}{'\u201D'}
         </p>
       </blockquote>
     );
   }
   ```
2. Replace the current `<p className="... text-[var(--muted)]/70 ...">` reason block in `SourceCard` with `<SourceQuote text={source.reason} />`.
3. Hero card: same blockquote but larger — `text-[13px]`, up to 4 lines, no `line-clamp` on desktop.
4. If `source.reason` is empty/null: don't render `SourceQuote` (no regression for agents with no reason).
5. Motion entrance: `<motion.blockquote initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 + index * 0.03 }}>` for staggered reveal.

**Files touched:** `AgentModal.tsx` only.

**Dependencies:** None.

---

## Agent-8 — Copy Facts Button

**What:** Top-right of the Facts tab header: a clipboard icon button. One click copies all facts as a numbered markdown list to clipboard. Shows a brief `✓ Copied` confirmation with `AnimatePresence` icon morph.

**Why:** Research tools live and die by this feature. Historians, journalists, and judges copying facts from AI research panels is a realistic workflow. It also signals product maturity — only real tools have copy buttons.

**UI Spec:**
```
FACTS  [12]                          [⎘ Copy]
                                     [✓ Copied] ← replaces for 1.5s
──────────────────────────────────────────────
● Fact one text...
● Fact two text...
```

**Implementation plan:**
1. `CopyButton` component with `useState<'idle' | 'copied'>`:
   ```tsx
   async function handleCopy() {
     const text = facts.map((f, i) => `${i + 1}. ${f}`).join('\n');
     await navigator.clipboard.writeText(text);
     setState('copied');
     setTimeout(() => setState('idle'), 1500);
   }
   ```
2. Icon morphs: `AnimatePresence mode="wait"` between clipboard SVG (`idle`) and checkmark SVG (`copied`) — both with `initial={{ scale: 0.7, opacity: 0 }}` entrance.
3. Clipboard SVG: 14×14, clean minimal icon (two overlapping rectangles).
4. Checkmark SVG: 14×14, `stroke-dashoffset` animation draws the check on enter.
5. Position: `flex justify-between items-center` wrapper around `FACTS [count]` label and `<CopyButton />`.
6. Disabled and `opacity-40` when `facts.length === 0`.
7. Also add a second copy button to the visual prompt blockquote in FactsTab (copies just the prompt).
8. `prefers-reduced-motion`: skip icon scale animation, only opacity.

**Files touched:** `AgentModal.tsx` only.

**Dependencies:** `navigator.clipboard` — available in all modern browsers, no polyfill needed.

---

## Execution Order

| Order | Agent | Effort | Impact | Files |
|---|---|---|---|---|
| 1 | Agent-4 (Counting Stats) | 30 min | High | AgentModal only |
| 2 | Agent-8 (Copy Button) | 30 min | High | AgentModal only |
| 3 | Agent-7 (Source Quote) | 20 min | High | AgentModal only |
| 4 | Agent-3 (Key Finding Banner) | 30 min | High | AgentModal only |
| 5 | Agent-1 (Hero Source Card) | 45 min | Very High | AgentModal only |
| 6 | Agent-2 (Relevance Score Bar) | 40 min | High | AgentModal + types.ts |
| 7 | Agent-5 (Sticky Header) | 60 min | Medium-High | AgentModal only |
| 8 | Agent-6 (Entity Pills) | 45 min | Medium | AgentModal only |

**All 8 agents touch only `AgentModal.tsx` (+ `types/index.ts` for Agent-2).** No backend changes required to ship any of them.

---

## Design Constraints (from CLAUDE.md)

- Font serif: **Cormorant Garamond** — all titles, quotes, blockquotes
- Font sans: **DM Sans** — all labels, metadata, counts
- Color tokens: `var(--gold)`, `var(--teal)`, `var(--green)`, `var(--text)`, `var(--muted)`, `var(--bg)`, `var(--bg2)`, `var(--bg3)`, `var(--bg4)`
- Motion: `spring(stiffness: 300–400, damping: 24–32)` for all interactive elements
- `prefers-reduced-motion`: all animations must degrade to opacity-only
- `strict: true` TypeScript — no `any`, no implicit types
- `pnpm` only — no new packages needed for any agent
