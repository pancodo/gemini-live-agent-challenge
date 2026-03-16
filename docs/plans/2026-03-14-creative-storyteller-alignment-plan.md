# Creative Storyteller Alignment Plan (Revised)

**Date:** 2026-03-14
**Risk Level:** HIGH — Single most important alignment issue for the competition
**Status:** Research complete. Focused on the ONE remaining gap.

---

## Table of Contents

1. [The One Risk](#1-the-one-risk)
2. [What's Already Implemented](#2-whats-already-implemented)
3. [What the Competition Actually Requires](#3-what-the-competition-actually-requires)
4. [The Perception Gap](#4-the-perception-gap)
5. [The Fix: Interleaved-First Architecture](#5-the-fix-interleaved-first-architecture)
6. [Implementation Plan](#6-implementation-plan)
7. [Agent Count Verification](#7-agent-count-verification)
8. [Demo Framing Strategy](#8-demo-framing-strategy)
9. [Risk Assessment](#9-risk-assessment)

---

## 1. The One Risk

**If judges perceive our architecture as "a pipeline that generates media separately and then assembles them," we fail the mandatory Creative Storyteller requirement or score poorly on the 40% Innovation criterion.**

The Creative Storyteller category states:

> **Mandatory Tech:** Must use Gemini's interleaved/mixed output capabilities. The agents are hosted on Google Cloud.

> "Build an agent that thinks and creates like a creative director, **seamlessly weaving together text, images, audio, and video in a single, fluid output stream**. Leverage Gemini's **native interleaved output** to generate rich, mixed-media responses that combine narration with visuals."

---

## 2. What's Already Implemented

### Interleaved Output Points (Both Use `response_modalities=["TEXT", "IMAGE"]`)

| Component | File | Status | Visible to Judges? |
|---|---|---|---|
| **Phase IV — Narrative Director** | `narrative_director_agent.py` | COMPLETE | Workspace storyboard — yes |
| **Beat Narration Endpoint** | `historian_api/routes/narrate.py` | COMPLETE | Documentary player — yes, but secondary |

### Frontend Beat Integration (All Complete)

| Component | File | What It Does |
|---|---|---|
| `playerStore.ts` | Beat state: `beats[]`, `currentBeatIndex`, `advanceBeat()`, `isNarrating` |
| `DocumentaryPlayer.tsx` | Effect 1: calls `startNarration()` on segment open |
| `DocumentaryPlayer.tsx` | Effect 2: sends `beat.narrationText` to Gemini Live, schedules `advanceBeat()` |
| `DocumentaryPlayer.tsx` | Effect 3: 10s fallback if no beats arrive |
| `KenBurnsStage.tsx` | Beat image overlay (100% opacity over 30% Ken Burns) |
| `useSSE.ts` | Handles `narration_beat` events (bypasses drip buffer) |
| `api.ts` | `startNarration(sessionId, segmentId)` POST call |
| `types/index.ts` | `NarrationBeat` and `NarrationBeatEvent` interfaces |

### Frontend Storyboard (All Complete)

| Component | File | What It Does |
|---|---|---|
| `researchStore.ts` | `storyboardFrames`, `addStoryboardScene`, `appendStoryboardText`, `setStoryboardImage` |
| `useSSE.ts` | Handles `storyboard_scene_start`, `storyboard_text_chunk`, `storyboard_image_ready` |
| `StoryboardStream.tsx` | Renders storyboard frames with streaming text + image reveals |
| `sse_helpers.py` | `build_narration_beat_event()` defined |

---

## 3. What the Competition Actually Requires

### Verified API Facts (March 2026)

| Capability | Models | What It Produces |
|---|---|---|
| **Native interleaved TEXT+IMAGE** | `gemini-2.5-flash-image`, `gemini-3.x-*-image-*` | Single call → alternating text/image parts |
| **Native audio** | Gemini Live API (`gemini-2.5-flash-native-audio-*`) | Audio stream + text transcription |
| **Image generation** | `imagen-3.0-fast-generate-001` | Standalone images |
| **Video generation** | `veo-2.0-generate-001` | Standalone async video |

**Critical fact:** No single model/API can produce TEXT + IMAGE + AUDIO simultaneously. The Creative Storyteller requirement is satisfied by using Gemini's native `response_modalities=["TEXT", "IMAGE"]` and having the result visibly drive the user experience.

### Competitor Intelligence

**Reelcraft** (same hackathon) uses `gemini-2.5-flash-image` with `response_modalities=["TEXT","IMAGE"]` to generate entire storyboards in a single call. Their claim: "Everything generates in a single API call using Gemini's interleaved text+image output."

---

## 4. The Perception Gap

### Current Documentary Player Flow

```
1. Pipeline runs → Phase XI generates Imagen 3 images (4 per segment) → stored in Firestore
2. Player opens segment → shows pre-gen Imagen 3 images IMMEDIATELY (Ken Burns animation)
3. Player calls POST /narrate → beat decomposition + Gemini TEXT+IMAGE per beat
4. Beats arrive 5-20s LATER → beat images cross-fade OVER pre-gen images
5. Gemini Live speaks the narration text from each beat
```

### What Judges See

1. **First visual impression:** Pre-generated Imagen 3 images (NOT interleaved output)
2. **5-20 seconds later:** Beat images fade in (interleaved output, but feels like enhancement)
3. **If beats fail (10s timeout):** Full script sent directly to historian — no interleaved output at all

### The Problem

- **Pre-gen images are PRIMARY** → Imagen 3 (separate model, separate call) defines the visual identity
- **Beat images are SECONDARY** → Native interleaved output is an overlay, not the foundation
- **Fallback exists** → The system works without interleaved output at all (Effect 3)
- **Timing gap** → 5-20s of non-interleaved visuals before beats arrive

**A judge watching the demo will see Imagen 3 images first and beat images second. The mandatory requirement feels like an afterthought, not the core.**

---

## 5. The Fix: Interleaved-First Architecture

### Core Change

**Flip the priority: Gemini TEXT+IMAGE beats become the PRIMARY visual path. Imagen 3 becomes the fallback/enhancement.**

### Before (Current)

```
Pipeline: Script → Imagen 3 (Phase XI, 4 frames/segment) → Firestore
Player opens → Shows Imagen 3 images FIRST → POST /narrate → Beats arrive LATER → Overlay
```

### After (Proposed)

```
Pipeline: Script → Beat Illustration (Phase V, Gemini TEXT+IMAGE) → Firestore
Player opens → Shows beat images FIRST → Imagen 3 arrives LATER as enhancement
```

### What Changes (3 Things)

#### Change 1: New Pipeline Agent — Beat Illustration (Phase V)

Move beat generation from the on-demand endpoint (`POST /narrate`) into the pipeline itself, as Phase V immediately after script generation.

**New file:** `backend/agent_orchestrator/agents/beat_illustration_agent.py`

A `BaseAgent` subclass that:
1. Reads `session.state["script"]` (list of SegmentScript from Phase III)
2. For each segment: calls `_decompose_beats()` → 3-4 dramatic beats
3. For each beat: calls `gemini-2.5-flash-image` with `response_modalities=["TEXT", "IMAGE"]`
4. Uploads beat images to GCS, writes to Firestore: `/sessions/{id}/segments/{segId}` (add `beats` array field)
5. Emits `narration_beat` SSE events (already defined in `sse_helpers.py`)
6. **Scene 0 beats generate first** (fast path) — then remaining scenes concurrent via `asyncio.gather` with `Semaphore(2)`

**Pipeline order (new):**
```
Phase I    — Document Analysis
Phase II   — Parallel Research + Aggregation
Phase III  — Script Generation
Phase IV   — Narrative Director (workspace storyboard — TEXT+IMAGE) [KEEP]
Phase V    — Beat Illustration (per-beat TEXT+IMAGE for player) [NEW]
Phase VII  — Fact Validation
Phase VIII — Geo Location
Phase X    — Visual Research
Phase XI   — Visual Director (Imagen 3 + Veo 2) [DEMOTED to enhancement]
```

**SSE events emitted by Phase V:**
- `pipeline_phase(phase=5, label="INTERLEAVED COMPOSITION")` — visible in Expedition Log
- `narration_beat` per beat (already handled by frontend)
- `segment_update(status="beats_ready")` per segment

**Why Phase V and not the existing on-demand endpoint:**
- Beats are ready BEFORE the player opens — no 5-20s gap
- Pipeline generates beats for all segments, not just the current one
- Expedition Log shows "INTERLEAVED COMPOSITION" as a visible phase — judges see it
- The on-demand endpoint (`narrate.py`) becomes a fallback for edge cases

**Reuse from `narrate.py`:**
- `_decompose_beats()` — copy the beat decomposition logic
- `_generate_beat()` — copy the Gemini TEXT+IMAGE call pattern
- `_BEAT_PROMPT` — copy the prompt template
- `_COMPOSITION_HINTS` — copy the composition cycle

#### Change 2: Player — Beats-First Visual Display

**Current `KenBurnsStage.tsx` behavior:**
- Pre-gen Imagen 3 images are the base layer (Ken Burns animation)
- Beat images overlay at 100% opacity, dimming Ken Burns to 30%

**New behavior:**
- Beat images are the PRIMARY visual source
- Imagen 3 images are the FALLBACK (shown only if beat has no image)
- When Imagen 3 images arrive later (Phase XI), they become the Ken Burns background atmosphere

**Image priority order (new):**
```
1. beats[currentBeatIndex]?.imageUrl   → PRIMARY (Gemini TEXT+IMAGE interleaved)
2. segment.imageUrls[activeIndex]      → FALLBACK (Imagen 3, if no beat image)
3. Placeholder gradient                → LAST RESORT
```

**Implementation in `KenBurnsStage.tsx`:**
- Change from two-layer approach (base + overlay) to single primary source
- `const primaryImage = beats[currentBeatIndex]?.imageUrl ?? segment.imageUrls?.[activeIndex] ?? null`
- Ken Burns animation continues on the primary image regardless of source
- When Imagen 3 images arrive later, they fill in as ambient background behind the active beat

#### Change 3: Remove Fallback Timer (Effect 3)

**Current:** `DocumentaryPlayer.tsx` Effect 3 waits 10s, then sends the full script to historian if no beats arrived.

**New:** Remove Effect 3 entirely. Beats are pre-generated in the pipeline (Phase V) and arrive via SSE before the player opens. The `narrate.py` endpoint remains available but is not called automatically.

**Also simplify Effect 1:** Instead of calling `startNarration()`, check if beats are already in the store (they will be, from SSE during pipeline). If beats are present, skip the API call. Only call `startNarration()` as a fallback if the store has no beats for the current segment (e.g., pipeline was interrupted).

```typescript
// Effect 1 (simplified):
useEffect(() => {
  if (!currentSegment || !sessionId) return;
  if (!currentSegment.script || currentSegment.script.length < 50) return;

  // Beats already arrived from pipeline SSE — no API call needed
  const existingBeats = usePlayerStore.getState().beats;
  if (existingBeats.length > 0 && existingBeats[0]?.segmentId === currentSegment.id) {
    setIsNarrating(true);
    return;
  }

  // Fallback: beats not in store (pipeline interrupted?) — call endpoint
  if (narrationStartedRef.current.has(currentSegment.id)) return;
  narrationStartedRef.current.add(currentSegment.id);
  setIsNarrating(true);

  const controller = new AbortController();
  startNarration(sessionId, currentSegment.id, controller.signal).catch(() => {});
  return () => controller.abort();
}, [currentSegment, sessionId, setIsNarrating]);
```

---

## 6. Implementation Plan

### Step 1: Beat Illustration Agent (Backend) — ~4h

**Create `backend/agent_orchestrator/agents/beat_illustration_agent.py`:**

```python
class BeatIllustrationAgent(BaseAgent):
    """Phase V: Generate beat-by-beat interleaved TEXT+IMAGE for each segment."""

    emitter: SSEEmitter
    gcp_project_id: str
    gcs_bucket_name: str

    model_config = ConfigDict(arbitrary_types_allowed=True)

    async def _run_async_impl(self, ctx: InvocationContext) -> AsyncGenerator:
        # 1. Emit pipeline phase
        await self.emitter.emit("pipeline_phase", {
            "phase": 5,
            "label": "INTERLEAVED COMPOSITION",
            "description": "Gemini composes narration beats with cinematic illustrations"
        })

        # 2. Read scripts from session state
        scripts = ctx.session.state.get("script", [])
        visual_bible = ctx.session.state.get("visual_bible", "")

        # 3. Scene 0 first (fast path)
        if scripts:
            await self._process_segment(ctx, scripts[0], 0, visual_bible)

        # 4. Remaining scenes concurrently
        sem = asyncio.Semaphore(2)
        async def bounded(seg, idx):
            async with sem:
                await self._process_segment(ctx, seg, idx, visual_bible)

        if len(scripts) > 1:
            await asyncio.gather(
                *[bounded(seg, i) for i, seg in enumerate(scripts[1:], start=1)]
            )

        return; yield  # AsyncGenerator protocol
```

**Key methods (reuse from `narrate.py`):**
- `_decompose_beats(script, beat_count=4)` — Gemini 2.0 Flash decomposition
- `_generate_beat(...)` — Gemini 2.5 Flash Image with `response_modalities=["TEXT", "IMAGE"]`
- `_upload_to_gcs(image_bytes, session_id, segment_id, beat_index)` → signed URL

**Emit per beat:**
```python
event = build_narration_beat_event(
    segment_id=segment_id,
    beat_index=beat_index,
    total_beats=total_beats,
    narration_text=narration_text,
    image_url=signed_url,
    direction_text=direction_text,
)
await self.emitter.emit("narration_beat", event)
```

**Write to Firestore:**
```python
# Add beats array to segment document
segment_ref = db.collection("sessions").document(session_id) \
    .collection("segments").document(segment_id)
await segment_ref.update({"beats": beats_data, "status": "beats_ready"})
```

**Factory function:**
```python
def build_beat_illustration_agent(emitter: SSEEmitter) -> BeatIllustrationAgent:
    return BeatIllustrationAgent(
        name="beat_illustration_agent",
        emitter=emitter,
        gcp_project_id=os.environ.get("GCP_PROJECT_ID", ""),
        gcs_bucket_name=os.environ.get("GCS_BUCKET_NAME", ""),
    )
```

### Step 2: Pipeline Integration (Backend) — ~1h

**`pipeline.py` — Add Phase V:**

In `build_new_pipeline()`:
```python
from .beat_illustration_agent import build_beat_illustration_agent

beat_illust = build_beat_illustration_agent(emitter)
# Insert after script_orch (Phase III), before fact_validator (Phase VII)
```

In the agent list:
```python
sub_agents=[
    document_analyzer,      # Phase I
    scene_research_orch,    # Phase II
    aggregator,             # Phase II.5
    script_orch,            # Phase III
    narrative_director,     # Phase IV (workspace storyboard)
    beat_illust,            # Phase V (player beats) ← NEW
    fact_validator,         # Phase VII
    geo_location,           # Phase VIII
    narrative_visual_planner,  # Phase IX
    visual_research_orch,   # Phase X
    visual_director_orch,   # Phase XI
]
```

Also update `build_streaming_pipeline()` if it has a different agent list.

### Step 3: Player — Beats-First Display (Frontend) — ~2h

**`KenBurnsStage.tsx`:**
- Change image source priority (beat first, then Imagen 3)
- Remove two-layer overlay approach
- Single primary image track with Ken Burns animation

**`DocumentaryPlayer.tsx`:**
- Remove Effect 3 (10s fallback timer)
- Simplify Effect 1 (check store before calling API)
- Effect 2 stays the same (send beat text to Gemini Live)

### Step 4: Beats Persistence Across Segments (Frontend) — ~1h

**`playerStore.ts`:**
- Currently `resetBeats()` is called on segment change
- New: Store beats per segment: `beatsMap: Record<string, NarrationBeat[]>`
- When segment changes, read from `beatsMap[segmentId]` instead of resetting
- SSE events populate `beatsMap` during pipeline (before player opens)

**`useSSE.ts`:**
- `narration_beat` events include `segmentId` — use it to populate `beatsMap[segmentId]`

### Step 5: Expedition Log Update (Frontend) — ~30min

- Register "INTERLEAVED COMPOSITION" as a known phase label in `ExpeditionLog.tsx`
- When Phase V starts, show: "The historian composes each moment with text and illustration together"
- Beat count in stats: "X BEATS COMPOSED" alongside existing "SOURCES FOUND" etc.

### Step 6: Verify & Test — ~2h

- Run pipeline with a test document
- Verify beats appear in SSE before player opens
- Verify player shows beat images immediately (no 5-20s gap)
- Verify Ken Burns animates beat images
- Verify Gemini Live speaks beat narration text
- Verify Imagen 3 images arrive later as enhancement

---

## 7. Agent Count Verification

The competition says "use 6-7 agent teams." After adding Phase V:

| # | Agent | Type | Model | Purpose |
|---|---|---|---|---|
| 1 | Document Analyzer | BaseAgent | Flash | OCR, chunking, summarization |
| 2 | Scene Research (×N parallel) | BaseAgent + ParallelAgent | Flash + google_search | Parallel research |
| 3 | Aggregator | ADK Agent | Flash | Merge research |
| 4 | Script Orchestrator | BaseAgent + ADK Agent | Pro | Narration scripts |
| 5 | Narrative Director | BaseAgent | **2.5 Flash Image** | Workspace storyboard (TEXT+IMAGE) |
| 6 | **Beat Illustration** | BaseAgent | **2.5 Flash Image** | **Player beats (TEXT+IMAGE)** [NEW] |
| 7 | Fact Validator | BaseAgent + ADK Agent | Flash | Hallucination firewall |
| 8 | Geo Location | BaseAgent | Flash + Maps | Geographic extraction |
| 9 | Narrative Visual Planner | BaseAgent | Pro | Visual storyboard planning |
| 10 | Visual Research | BaseAgent | Flash | 6-stage reference research |
| 11 | Visual Director | BaseAgent | Imagen 3 + Veo 2 | Image/video generation |

**11 agent teams. Exceeds the 6-7 requirement.**

Two of these (agents #5 and #6) use Gemini's native interleaved output. This is significantly stronger than a single interleaved call buried in a pipeline.

---

## 8. Demo Framing Strategy

### The 30-Second Proof

The demo video must make interleaved output unmistakable within the first 30 seconds:

| Time | What Judges See | What to Say |
|---|---|---|
| 0:00-0:10 | Documentary playing: beat image + historian narrating + captions | (no voiceover — let the product speak) |
| 0:10-0:20 | Beat transitions: image cross-fades to next beat illustration | "Each moment you're watching was composed by a single Gemini call — text and illustration together." |
| 0:20-0:30 | User interrupts. Historian stops. Answers. Resumes with next beat. | "The historian is always listening." |

### Architecture Diagram Emphasis

The architecture diagram must prominently show:

```
Script Agent → Beat Illustration Agent ──────────────────→ Player
                  │                                          │
                  │ gemini-2.5-flash-image                   │ beat images (PRIMARY)
                  │ response_modalities=["TEXT","IMAGE"]      │ beat narration → Gemini Live
                  │                                          │
                  └── NATIVE INTERLEAVED OUTPUT ──────────────┘
```

Label the Beat Illustration Agent with "Gemini TEXT+IMAGE" in the diagram. Make it the visual center.

### Storyboard Streaming Moment

Show the workspace storyboard streaming during the Expedition Log phase:
- "While the pipeline researches, you can watch Gemini's creative director composing the documentary storyboard in real-time."
- Text appears word by word. Image materializes. Both from one Gemini call.

---

## 9. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `gemini-2.5-flash-image` rate limits during pipeline | Medium | Beats fail for some segments | Semaphore(2) limits concurrency. Imagen 3 fallback still works. |
| Beat generation adds pipeline time | Low | ~30s for 4 segments × 4 beats (concurrent) | Scene 0 fast path. Remaining concurrent. Parallel with fact validation. |
| Beat images lower quality than Imagen 3 | Medium | Less cinematic visuals | Beat images are "composition sketches" — Imagen 3 enhances later. Both visible. |
| `gemini-2.5-flash-image` unavailable on Vertex AI global | Low | Cannot generate images | Fallback to Gemini API path (already used in `narrative_director_agent.py`) |
| Judges don't notice interleaved output | Low (after fix) | Miss mandatory requirement | Demo explicitly calls it out. Architecture diagram highlights it. Blog post explains it. |

### Residual Risk After Implementation

**Near zero for the mandatory requirement.** Every frame of the documentary is generated by Gemini's native interleaved TEXT+IMAGE output. The connection between "what you see" and "interleaved output" is direct and undeniable. Imagen 3 and Veo 2 enhance but don't define the experience.

---

## Summary

| What | Before | After |
|---|---|---|
| Primary player visuals | Imagen 3 (separate model) | Gemini TEXT+IMAGE beats (interleaved) |
| Beat generation timing | On-demand, 5-20s after player opens | Pre-generated in pipeline, ready before player |
| Interleaved output visibility | Secondary overlay | Primary visual path |
| Fallback | Full script to historian (no interleaving) | Imagen 3 images (still AI-generated, just not interleaved) |
| Pipeline phases using interleaved | 1 (Phase IV, workspace only) | 2 (Phase IV workspace + Phase V player) |
| Judge perception | "Assembled multimodal pipeline" | "Interleaved-first creative storytelling engine" |
