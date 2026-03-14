# Creative Storyteller Alignment Plan

**Date:** 2026-03-14
**Goal:** Transform AI Historian from a batch-then-play documentary generator into a streaming, interleaved multimodal creative storytelling engine that fully aligns with the Creative Storyteller hackathon category.
**Research basis:** 7 parallel research agents analyzed the codebase, Gemini APIs, competition strategy, and frontend/backend architecture gaps.

---

## Table of Contents

1. [The Alignment Gap](#1-the-alignment-gap)
2. [Strategy Overview](#2-strategy-overview)
3. [Workstream A: Visible Interleaved Output (Storyboard Stream)](#3-workstream-a-visible-interleaved-output)
4. [Workstream B: Stream-and-Play Pipeline](#4-workstream-b-stream-and-play-pipeline)
5. [Workstream C: Live Creative Director (NON_BLOCKING Illustration)](#5-workstream-c-live-creative-director)
6. [Workstream D: Progressive Player Experience](#6-workstream-d-progressive-player-experience)
7. [Workstream E: Demo & Submission Strategy](#7-workstream-e-demo--submission-strategy)
8. [Implementation Sequence](#8-implementation-sequence)
9. [Risk Assessment](#9-risk-assessment)
10. [File Change Map](#10-file-change-map)

---

## 1. The Alignment Gap

### What the Category Requires

> "Build an agent that thinks and creates like a creative director, seamlessly weaving together text, images, audio, and video in a single, fluid output stream. Leverage Gemini's native interleaved output."

### Where We Fall Short

| Criterion | Required | Current State | Gap |
|---|---|---|---|
| **Single fluid output stream** | Modalities woven together in real-time | Sequential pipeline: all scripts → all images → then playback | **Critical** |
| **Gemini's native interleaved output** | TEXT+IMAGE in user-facing flow | Phase 3.1 uses TEXT+IMAGE but output is invisible to user | **Critical** |
| **Creative director AI** | Gemini decides visual composition live | Code orchestrates separate phases; Gemini writes text OR generates images, never both visibly | **Critical** |
| **Real-time generation** | User sees content emerging | All media pre-generated before player opens | **High** |
| **Seamless interleaving** | No seams between modalities | Clear "wait → watch" boundary between workspace and player | **High** |

### Where We're Already Strong

| Strength | Status |
|---|---|
| Live voice with interruption (<300ms) | Production-ready |
| ADK pipeline with 10 custom agents | Production-ready |
| 8 Google Cloud services | Production-ready |
| Cinematic UI (iris reveal, Ken Burns, captions, film grain) | Production-ready |
| RAG-grounded historian persona | Production-ready |

### Competitor Intelligence

**Reelcraft** (same hackathon) uses `gemini-2.5-flash-image` with `response_modalities=["TEXT","IMAGE"]` to generate entire storyboards in a single call. Their claim: "Everything generates in a single API call using Gemini's interleaved text+image output." We must match or exceed this while adding our live voice and documentary experience on top.

---

## 2. Strategy Overview

### The Three-Pillar Fix

```
PILLAR 1: Make interleaved output VISIBLE
  Phase 3.1 (NarrativeDirector) becomes a live storyboard the user watches
  Gemini's TEXT+IMAGE output streams to the frontend in real-time

PILLAR 2: Stream-and-play pipeline
  Break the waterfall: per-segment generation with overlapping playback
  User starts watching segment 0 while segment 1 generates

PILLAR 3: Live creative director during voice
  NON_BLOCKING function calling: historian autonomously generates illustrations
  while speaking, making the AI a true creative director in real-time
```

### How This Scores 5/5 on Innovation (40%)

After these changes, the user experience becomes:

1. **Upload** → Expedition Log begins (research as narrative)
2. **Storyboard emerges** → User watches Gemini generate text + illustrations together in real-time (visible interleaved output)
3. **Documentary starts playing** → First segment auto-plays as soon as it has audio + one image (stream-and-play)
4. **Remaining segments generate behind the narration** → Progressive image arrival, Ken Burns updates live
5. **User interrupts** → Historian stops, answers with context, autonomously generates a scene illustration mid-conversation (NON_BLOCKING creative director)
6. **Documentary resumes** → Seamless return to narration

At every phase, multiple modalities are active simultaneously. No waiting. No seams.

---

## 3. Workstream A: Visible Interleaved Output

### Goal
Make Phase 3.1's Gemini TEXT+IMAGE interleaved output the centrepiece of the workspace experience — the user watches Gemini creating narration text alongside storyboard illustrations in real-time.

### Technical Facts
- Model: `gemini-2.5-flash-image` with `response_modalities=["TEXT","IMAGE"]`
- Streaming: **NOT supported on Vertex AI**; supported on Gemini API via `generate_content_stream`
- Image delivery: arrives as a complete `inline_data` part (not progressive); text streams in small chunks
- Current location: `narrative_director_agent.py` — uses non-streaming `generate_content`, output stored in `session.state` only

### Backend Changes

#### A1. `sse_helpers.py` — Three new SSE event builders

```python
def build_storyboard_scene_start_event(
    *, scene_id: str, segment_id: str, title: str, mood: str
) -> dict[str, Any]:
    """Emitted when creative director begins working on a scene."""
    return {
        "type": "storyboard_scene_start",
        "sceneId": scene_id,
        "segmentId": segment_id,
        "title": title,
        "mood": mood,
    }

def build_storyboard_text_chunk_event(
    *, scene_id: str, text: str
) -> dict[str, Any]:
    """Emitted as creative direction text streams from Gemini."""
    return {
        "type": "storyboard_text_chunk",
        "sceneId": scene_id,
        "text": text,
    }

def build_storyboard_image_ready_event(
    *, scene_id: str, segment_id: str, image_url: str, caption: str
) -> dict[str, Any]:
    """Emitted when interleaved image is ready (uploaded to GCS, signed URL)."""
    return {
        "type": "storyboard_image_ready",
        "sceneId": scene_id,
        "segmentId": segment_id,
        "imageUrl": image_url,
        "caption": caption,
    }
```

#### A2. `narrative_director_agent.py` — Switch to streaming + emit new events

**Key changes:**
1. Before each scene's Gemini call, emit `storyboard_scene_start`
2. Switch from `client.aio.models.generate_content()` to streaming (if using Gemini API path) or keep non-streaming but emit events immediately after each part is parsed
3. For each text part: emit `storyboard_text_chunk` immediately
4. For each inline_data part: upload to GCS, generate a 4-hour signed HTTPS URL, emit `storyboard_image_ready`
5. Continue writing `storyboard_images` to `session.state` for Phase V compatibility

**Streaming vs non-streaming decision:**
- On **Vertex AI**: streaming not supported for image models. Use non-streaming but emit events after each call completes (per-scene, not per-batch). This still gives progressive per-scene delivery.
- On **Gemini API**: use `generate_content_stream` for true token-by-token text streaming. Switch client config based on env var.

**Signed URL generation** (replace `gs://` URIs with browser-loadable URLs):
```python
from datetime import timedelta

signed_url = blob.generate_signed_url(
    expiration=timedelta(hours=4),
    method="GET",
    version="v4",
)
```

### Frontend Changes

#### A3. `types/index.ts` — New event types

Add to `SSEEventType` union:
```typescript
| 'storyboard_scene_start'
| 'storyboard_text_chunk'
| 'storyboard_image_ready'
```

Add three new event interfaces: `StoryboardSceneStartEvent`, `StoryboardTextChunkEvent`, `StoryboardImageReadyEvent`.

Add `'storyboard_ready'` to `SegmentStatus` union.

#### A4. `researchStore.ts` — Storyboard state slice

```typescript
interface StoryboardFrame {
  sceneId: string;
  segmentId: string;
  title: string;
  mood: string;
  textChunks: string[];       // accumulates as chunks arrive
  imageUrl: string | null;    // set when image is ready
  imageCaption: string;
  completedAt: number | null;
}

// New state keys:
storyboardFrames: Record<string, StoryboardFrame>;

// New actions:
addStoryboardScene(sceneId, segmentId, title, mood): void;
appendStoryboardText(sceneId, text): void;
setStoryboardImage(sceneId, imageUrl, caption): void;
```

Add to `reset()` and `partialize`.

#### A5. `useSSE.ts` — Handle new events + drip bypass

Three new `case` blocks in `processEvent`.

**Critical:** `storyboard_text_chunk` events must bypass the 150ms drip buffer. In the `es.onmessage` handler, check event type before pushing to `pendingRef` — if it's a text chunk, call `processEventRef.current(event)` directly.

#### A6. New component: `StoryboardStream.tsx`

Location: `frontend/src/components/workspace/StoryboardStream.tsx`

**Visual spec:**
- Vertically scrolling feed of `StoryboardFrameCard` components
- Auto-scrolls to keep the active scene in view
- Each card has:
  - Header: scene title (Cormorant Garamond, 18px) + mood badge (Badge component)
  - Left column: creative direction text streaming with word-by-word blur-in (reuse `word-appear` keyframe)
  - Right column: image slot with shimmer skeleton → spring-in image reveal
  - Gold border activates on completion (opacity 0 → 0.3)
- `aria-live="polite"` on scrolling container

#### A7. `WorkspacePage.tsx` — Phase-aware layout

Replace `{status === 'processing' && <ExpeditionLog />}` with:

```tsx
{status === 'processing' && (
  hasStoryboardFrames
    ? <StoryboardStreamLayout />  // ExpeditionLog (38%) + StoryboardStream (62%)
    : <ExpeditionLog />           // unchanged until Phase 3.1 starts
)}
```

Transition: `AnimatePresence mode="wait"` — ExpeditionLog fades from full width, then both panels fade in together (0.35s ease-in-out).

---

## 4. Workstream B: Stream-and-Play Pipeline

### Goal
Break the waterfall pipeline so the user starts watching the documentary while generation continues. First segment plays within ~50 seconds of document upload, not 3-5 minutes.

### Architecture: Per-Segment Pipeline

```
Phase I → Phase II → Aggregator (GLOBAL — must complete for all scenes)
                         ↓
         scene_briefs + aggregated_research ready
                         ↓
    ┌── Per-segment coroutine (overlapping) ──────────────────────┐
    │                                                               │
    │  Scene 0:  Script → Storyboard → FactCheck → Geo             │
    │            → VisualResearch → Imagen3 → [Veo2 background]    │
    │            → emit segment_playable → PLAYER OPENS            │
    │                                                               │
    │  Scene 1:  (starts when Scene 0's storyboard is done)        │
    │            Script → Storyboard → FactCheck → Geo             │
    │            → VisualResearch → Imagen3 → [Veo2 background]    │
    │            → emit segment_playable                            │
    │                                                               │
    │  Scene 2+: (continues overlapping...)                        │
    └───────────────────────────────────────────────────────────────┘
```

### Backend Changes

#### B1. `script_agent_orchestrator.py` — Per-segment script generation

**Current blocker:** Single LLM call produces ALL scripts atomically. Nothing reaches Firestore until all scripts are parsed.

**Options (pick one):**

**Option A — Per-scene Gemini calls (recommended):**
- Replace single `_INNER_SCRIPT_AGENT.run_async(ctx)` with N sequential `client.aio.models.generate_content()` calls
- Each call receives `scene_briefs[i]` + `aggregated_research` and produces one `SegmentScript`
- Write each segment to Firestore and emit `segment_update("generating")` immediately
- Advantage: progressive delivery, each segment available within ~10s
- Disadvantage: N separate LLM calls instead of 1 (higher total token cost, but better latency)

**Option B — Streaming JSON parse (fragile, not recommended):**
- Keep single call but use `stream=True`
- Parse JSON array elements as they complete from partial output
- Fragile: partial JSON parsing is error-prone

#### B2. `pipeline.py` — Per-segment orchestration

**Replace the sequential `_PHASE_AGENT_MAP` loop with a per-segment coroutine model:**

```python
async def _run_segment_pipeline(
    self, ctx, scene_index: int, scene_brief: dict, research: str
):
    """Per-segment pipeline: script → storyboard → validate → geo → visual research → imagen3"""
    # 1. Generate script for this segment
    segment = await self._generate_script(ctx, scene_index, scene_brief, research)

    # 2. Generate storyboard (Gemini TEXT+IMAGE interleaved)
    await self._generate_storyboard(ctx, scene_index, segment)

    # 3. Fact validation for this segment
    await self._validate_facts(ctx, scene_index, segment)

    # 4. Geo extraction for this segment
    await self._extract_geo(ctx, scene_index, segment)

    # 5. Visual research for this segment
    manifest = await self._visual_research(ctx, scene_index, segment)

    # 6. Imagen 3 generation for this segment
    image_urls = await self._generate_images(ctx, scene_index, segment, manifest)

    # 7. Emit segment_playable
    await self.emitter.emit("segment_playable", {"segmentId": segment["id"]})

    # 8. Fire-and-forget Veo 2
    asyncio.create_task(self._generate_video(ctx, scene_index, segment))
```

**Overlap strategy:**
- Scene 0 runs first (no overlap — fastest path to first playable segment)
- Scenes 1-N start with a stagger: Scene 1 begins when Scene 0's storyboard is emitted
- Use `asyncio.Semaphore` to limit concurrent scenes (e.g., 2 scenes max) to avoid API quota exhaustion

#### B3. Session status — Early `ready` signal

**Current:** `status="ready"` set only after ALL phases complete.

**New:** Emit a new SSE event `segment_playable` when segment 0 has images. The frontend uses this to trigger the player, not `status="ready"`.

Alternatively, set `status="ready"` when segment 0 is complete, and add `pipelineComplete: boolean` to session state for when ALL segments are done.

#### B4. Phases III.5, 3.8, 4.0 — Per-segment adaptation

| Phase | Current | Per-Segment Adaptation |
|---|---|---|
| III.5 (FactValidator) | Validates all scripts at once | Validate each segment's script individually as it's generated |
| 3.8 (GeoLocation) | Processes all segments together | Extract geo for each segment individually |
| 4.0 (VisualPlanner) | Global visual composition across all scenes | **Keep global BUT run after all storyboards complete** — this is a cross-scene planning step; the storyboard images serve as interim visuals while it runs |

#### B5. Veo 2 — Background polling

**Current:** All Veo 2 operations polled in a batch after all Imagen 3 finishes.

**New:** Each segment's Veo 2 operation fires as `asyncio.create_task` after its Imagen 3 completes. A shared polling loop runs in the background:
- Collects all pending Veo 2 operations
- Polls every 20 seconds
- Updates Firestore and emits `segment_update(complete, videoUrl=...)` when each video finishes
- Does NOT block the per-segment pipeline

#### B6. Checkpoint adaptation

**Current:** Checkpoint saves per-phase (e.g., "phase_3_done").

**New:** Checkpoint saves per-segment-per-stage (e.g., "seg_0_script", "seg_0_images"). The `ResumablePipelineAgent` needs segment-level granularity for crash recovery.

---

## 5. Workstream C: Live Creative Director (NON_BLOCKING Illustration)

### Goal
Transform the historian from a voice-only persona into a true creative director that autonomously generates illustrations while speaking, using Gemini Live API's NON_BLOCKING function calling.

### Technical Facts
- Gemini Live API supports function calling with `behavior: "NON_BLOCKING"`
- Three scheduling modes: `SILENT` (absorb result without interrupting speech), `WHEN_IDLE` (process after current thought), `INTERRUPT` (stop and react)
- The historian can call a `generate_illustration` tool and **keep speaking** while the image generates
- Current implementation uses a server-side heuristic hack (`maybeGenerateIllustration`) that fires based on transcript length and cooldown timer

### Backend Changes

#### C1. `server.js` — Add tool declaration to setup message

Add to `buildSetupMessage()`:

```javascript
tools: [{
  functionDeclarations: [{
    name: 'generate_illustration',
    description: 'Generate a cinematic historical illustration to show the viewer while you continue narrating. Call this when describing a vivid scene, important location, key figure, or dramatic moment that would benefit from visual accompaniment. Do not pause your narration — keep speaking while the image generates.',
    parameters: {
      type: 'OBJECT',
      properties: {
        subject: {
          type: 'STRING',
          description: 'What to illustrate — the specific scene, person, building, or moment'
        },
        mood: {
          type: 'STRING',
          description: 'Cinematic mood: dramatic, intimate, epic, mysterious, solemn'
        },
        composition: {
          type: 'STRING',
          description: 'Camera angle and framing: wide establishing shot, close-up portrait, aerial view, ground-level'
        }
      },
      required: ['subject', 'mood']
    }
  }]
}],
toolConfig: {
  functionCallingConfig: {
    behavior: 'NON_BLOCKING'
  }
}
```

#### C2. `server.js` — Handle toolCall from Gemini

In `attachGeminiHandlers`, add handler for `serverContent.modelTurn.parts[].functionCall`:

```javascript
// When Gemini decides to generate an illustration
if (part.functionCall && part.functionCall.name === 'generate_illustration') {
  const { subject, mood, composition } = part.functionCall.args;
  const callId = part.functionCall.id;

  // Fire-and-forget illustration generation
  generateIllustrationAsync(sessionId, subject, mood, composition, callId)
    .catch(err => console.error('Illustration failed:', err));
}

async function generateIllustrationAsync(sessionId, subject, mood, composition, callId) {
  // Call historian-api /illustrate endpoint
  const res = await fetch(`${HISTORIAN_API_URL}/api/session/${sessionId}/illustrate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: subject, mood, composition }),
  });
  const data = await res.json();

  // Send image to browser
  clientWs.send(JSON.stringify({
    type: 'live_illustration',
    imageUrl: data.imageUrl,
    caption: data.caption || subject,
  }));

  // Send FunctionResponse back to Gemini with SILENT scheduling
  // so it doesn't interrupt current narration
  geminiWs.send(JSON.stringify({
    toolResponse: {
      functionResponses: [{
        id: callId,
        name: 'generate_illustration',
        response: {
          result: { success: true, description: `Illustration of ${subject} is now visible to the viewer.` }
        }
      }]
    },
    clientContent: {
      turnComplete: false
    }
  }));
}
```

#### C3. `server.js` — Remove heuristic illustration trigger

Remove the `maybeGenerateIllustration()` call and associated debounce/cooldown logic. Gemini now decides when to illustrate based on narrative context, not transcript length.

Keep the 10-second rate limit in `illustrate.py` as a safety net.

#### C4. `illustrate.py` — Accept mood and composition parameters

Extend the endpoint to accept `mood` and `composition` from the function call args and incorporate them into the Gemini 2.5 Flash Image prompt. Currently uses raw user transcript as the query — now uses Gemini's own structured description.

### Frontend Changes

#### C5. `useGeminiLive.ts` — Already handles `live_illustration`

The `case 'live_illustration'` handler at line 180-189 already calls `playerStore.setLiveIllustration()`. No changes needed here.

#### C6. `DocumentaryPlayer.tsx` — Enhanced illustration display

The `liveIllustration` overlay in `KenBurnsStage.tsx` already exists (lines 228-257). Enhance:
- Extend auto-dismiss from 25s to 35s (illustrations should persist longer when AI-initiated)
- Add a subtle "AI Illustrated" label with the `caption` text below the image
- Crossfade animation: `opacity: 0 → 1` over 1.2s with `scale(1.04) → scale(1)` spring

#### C7. Demo framing

In the demo video, explicitly show the historian deciding to illustrate:
- Historian is narrating about a palace
- Without any user action, an illustration of the palace materializes on screen
- Historian continues speaking without interruption
- The caption reads the subject Gemini chose to illustrate

This demonstrates "agent that thinks and creates like a creative director" — the AI decides what to visualize.

---

## 6. Workstream D: Progressive Player Experience

### Goal
Transform the player from "open when everything is ready" to "open as soon as the first segment is playable, continue updating as more content arrives."

### Frontend Changes

#### D1. `WorkspacePage.tsx` — Auto-open player on first playable segment

Replace the `autoWatch` effect that waits for `status === 'ready'` with:

```typescript
// Watch for first segment with images (not session-level status)
useEffect(() => {
  if (autoPlayFired.current) return;
  const segments = Object.values(researchStore.segments);
  const firstPlayable = segments.find(
    s => (s.status === 'ready' || s.status === 'complete') && s.imageUrls?.length > 0
  );
  if (firstPlayable) {
    autoPlayFired.current = true;
    triggerIris(`/player/${firstPlayable.id}`);
  }
}, [researchStore.segments]);
```

This fires during `status === 'processing'`, not after `status === 'ready'`.

#### D2. `playerStore.ts` — Add `pipelineComplete` flag

```typescript
pipelineComplete: boolean;
setPipelineComplete: (complete: boolean) => void;
```

Set to `true` when `sessionStore.status` becomes `'ready'`. Used by:
- Player sidebar: show "More segments generating..." indicator when `false`
- Navigation: `hasNext` returns `true` even if next segment isn't ready yet (shows loading state)
- Research PiP panel: visible only when `false`

#### D3. `KenBurnsStage.tsx` — Progressive image arrival

Already handles empty images gracefully (pulse ring placeholder). Additional enhancement:
- When first image arrives for a segment that was showing the placeholder, crossfade with `filter: blur(20px) → blur(0)` over 1.5s
- As additional images arrive, add them to the Ken Burns rotation cycle
- Existing code at line 130-168 needs minimal changes — just animate the transition from placeholder to first real image

#### D4. `DocumentaryPlayer.tsx` — Research PiP panel

New overlay panel (bottom-left, `z-index: 15`) visible while `pipelineComplete === false`:
- Shows current phase name + active agent count
- Condensed stats bar (sources / segments)
- Collapsible via a small toggle button
- Auto-hides with the chrome `isIdle` system
- Fades out with `AnimatePresence` when pipeline completes

#### D5. `useSSE.ts` — Handle `segment_playable` event

New case:
```typescript
case 'segment_playable':
  // Mark segment as playable in researchStore
  researchStore.setSegment(event.segmentId, { status: 'ready' });
  break;
```

#### D6. SSE image URLs — Signed URLs in events

**Current:** SSE `segment_update` events may contain `gs://` URIs that the frontend can't load.

**Required:** Backend must emit signed HTTPS URLs in all SSE events that contain image URLs. Apply the same `generate_signed_url(expiration=4h)` pattern used in `session.py` route responses.

---

## 7. Workstream E: Demo & Submission Strategy

### Demo Video Structure (3:55 target)

| Time | Shot | Content | Judging Target |
|---|---|---|---|
| 0:00-0:15 | **COLD OPEN** | Documentary player running: Ken Burns visuals, historian narrating, captions revealing word-by-word. No introduction. | First impression (Innovation 40%) |
| 0:15-0:25 | **INTERRUPTION** | User presses mic mid-sentence. Historian stops. "Who was the sultan you just mentioned?" Historian answers with grounded sources, resumes narration. | Core differentiator |
| 0:25-0:40 | **LIVE ILLUSTRATION** | During the historian's answer, an illustration materializes on screen — AI-initiated, not user-requested. Caption: "The Grand Vizier's chambers, 1453." | Creative Director proof |
| 0:40-0:55 | **PROBLEM** | "Historical documents sit behind museum glass. Dead artifacts in dead languages. What if an AI could bring them to life?" | Problem definition |
| 0:55-1:15 | **UPLOAD** | Ottoman firman (Arabic script) uploaded. Format badge, language detected, persona selected. | Input universality |
| 1:15-2:15 | **EXPEDITION LOG → STORYBOARD** | Expedition Log types research entries. Then — the layout splits. On the right, Gemini's creative direction text streams in, followed by storyboard illustrations materializing. "You're watching Gemini think and illustrate simultaneously." | **Interleaved output proof** (Category requirement) |
| 2:15-2:50 | **AUTO-PLAY** | Iris transition. Documentary begins playing automatically with first segment. Remaining segments' images arrive progressively (visible in sidebar as "generating..."). | Stream-and-play proof |
| 2:50-3:20 | **AGENT MODAL** | Click an agent card. Show evaluated sources (accepted/rejected), extracted facts, visual prompt. "Complete research transparency." | Technical depth (30%) |
| 3:20-3:45 | **ARCHITECTURE** | Clean diagram: User → FastAPI → ADK Pipeline (10 agents) → Gemini Live → Vertex AI. Name every Google Cloud service. 3-second GCP console flash. | Mandatory requirement |
| 3:45-3:55 | **CLOSE** | Return to documentary player. Historian's voice fading. "Every document has a story. AI Historian tells it." | Memorable ending |

### Key Demo Rules
1. **Start with the product, not with yourself.** First frame = documentary playing.
2. **The interruption moment is the single most important shot.** Do 5+ takes.
3. **Show the storyboard streaming.** This is the Creative Storyteller proof. Narrate: "You're watching Gemini generate text and illustrations together in a single call."
4. **Never show code.** Architecture diagram only. Code is in the repo.
5. **External microphone.** Audio quality is explicitly evaluated by judges.
6. **Never speed up video.** If it doesn't fit in 4 minutes, cut content.

### Blog Posts (+0.6 bonus = 12% score boost)

**Efe's post:** "From Ottoman Manuscript to AI Documentary: How Gemini's Interleaved Output Creates Living Storyboards"
- Focus on the storyboard streaming feature (TEXT+IMAGE interleaved output)
- Show the code: `response_modalities=["TEXT","IMAGE"]` → SSE → frontend
- Include the architecture diagram
- Tag: `#GeminiLiveAgentChallenge`
- Platform: Dev.to (primary) + Medium (cross-post with canonical URL)

**Berkay's post:** "Building a Real-Time Voice Historian: Interruption, Illustration, and NON_BLOCKING Function Calling"
- Focus on the Live API voice + autonomous illustration
- Show the function calling setup and `SILENT` scheduling
- Tag: `#GeminiLiveAgentChallenge`

### GDG Membership (+0.2 bonus)
Both team members join GDG at https://gdg.community.dev/ and save public profile URLs.

### Terraform Verification (+0.2 bonus)
Run `terraform apply` in a test project. Verify all resources provision correctly.

---

## 8. Implementation Sequence

### Priority Order (by judge impact)

```
WAVE 1 — Maximum judge impact, directly fixes category alignment
├── A: Visible Interleaved Output (Storyboard Stream)
│   ├── A1: sse_helpers.py — 3 new event builders
│   ├── A2: narrative_director_agent.py — emit storyboard events
│   ├── A3: types/index.ts — new event types
│   ├── A4: researchStore.ts — storyboard slice
│   ├── A5: useSSE.ts — handle new events + drip bypass
│   ├── A6: StoryboardStream.tsx — new component
│   └── A7: WorkspacePage.tsx — phase-aware layout

WAVE 2 — Stream-and-play pipeline (transforms the UX)
├── B: Stream-and-Play
│   ├── B1: script_agent_orchestrator.py — per-segment generation
│   ├── B2: pipeline.py — per-segment orchestration
│   ├── B3: Session status — early ready signal
│   ├── B4: fact_validator + geo — per-segment adaptation
│   ├── B5: visual_director — background Veo 2 polling
│   └── B6: Checkpoint adaptation

WAVE 3 — Live creative director (wow factor for demo)
├── C: NON_BLOCKING Illustration
│   ├── C1: server.js — tool declaration in setup
│   ├── C2: server.js — toolCall handler
│   ├── C3: server.js — remove heuristic trigger
│   ├── C4: illustrate.py — accept mood/composition params
│   └── C5-C7: Frontend polish + demo prep

WAVE 4 — Progressive player (seamless experience)
├── D: Progressive Player
│   ├── D1: WorkspacePage.tsx — auto-open on first playable
│   ├── D2: playerStore.ts — pipelineComplete flag
│   ├── D3: KenBurnsStage.tsx — progressive image arrival
│   ├── D4: DocumentaryPlayer.tsx — research PiP panel
│   ├── D5: useSSE.ts — segment_playable event
│   └── D6: Backend — signed URLs in SSE events

WAVE 5 — Submission
├── E: Demo & Submission
│   ├── Blog posts (both team members)
│   ├── Demo video recording
│   ├── GDG membership
│   ├── Terraform verification
│   └── Devpost form submission
```

### Parallel Execution Plan

Waves can overlap. Recommended team assignment:

| Wave | Can Start After | Estimated Effort | Parallelizable? |
|---|---|---|---|
| A (Storyboard) | Immediately | 6-8h | Backend (A1-A2) + Frontend (A3-A7) in parallel |
| B (Stream-and-play) | After A2 (backend events working) | 8-12h | B1-B2 (pipeline) + B4 (per-segment agents) in parallel |
| C (Live Creative Director) | Independently | 4-6h | Fully parallel with A and B |
| D (Progressive Player) | After B3 (segment_playable events) | 4-6h | D1-D2 immediately, D3-D4 after B completes |
| E (Submission) | After A, B, C working | 8-10h | Blog writing parallel with demo recording |

---

## 9. Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| `gemini-2.5-flash-image` streaming not available on Vertex AI | Cannot stream text chunks, only per-scene delivery | **Confirmed** | Use Gemini API path for Phase 3.1 only; OR accept per-scene (non-streaming) delivery with fast SSE emission per scene |
| Per-segment script generation increases API costs | Higher token usage from N calls vs 1 | Medium | Each call is smaller; total tokens similar. Monitor quota. |
| Per-segment pipeline complexity causes bugs | Segment ordering, race conditions | Medium | Thorough testing with a 2-scene document. Use Semaphore to limit concurrency. |
| NON_BLOCKING function calling has known bugs | Gemini may generate speculative audio before tool result | **Confirmed** (GitHub issue #1894) | Use `SILENT` scheduling. Add system instruction: "Do not describe the illustration until the viewer can see it." |
| Illustration rate limiting | Too many tool calls overwhelm the API | Low | Keep the 10-second rate limit in `illustrate.py`. Add instruction: "Generate at most one illustration per 30 seconds of narration." |
| Demo video timing | 4-minute limit is tight with new features | Medium | Practice the demo script. Use cold open technique. Cut architecture section if needed. |

---

## 10. File Change Map

### Files to Create
| File | Workstream | Purpose |
|---|---|---|
| `frontend/src/components/workspace/StoryboardStream.tsx` | A6 | Visible interleaved output component |

### Files to Modify

| File | Workstream | Changes |
|---|---|---|
| `backend/agent_orchestrator/agents/sse_helpers.py` | A1 | 3 new event builder functions |
| `backend/agent_orchestrator/agents/narrative_director_agent.py` | A2 | Emit storyboard events, signed URLs |
| `backend/agent_orchestrator/agents/script_agent_orchestrator.py` | B1 | Per-segment script generation |
| `backend/agent_orchestrator/agents/pipeline.py` | B2, B3 | Per-segment orchestration, early ready signal |
| `backend/agent_orchestrator/agents/fact_validator_agent.py` | B4 | Per-segment validation |
| `backend/agent_orchestrator/agents/geo_location_agent.py` | B4 | Per-segment geo extraction |
| `backend/agent_orchestrator/agents/visual_director_orchestrator.py` | B5 | Background Veo 2 polling |
| `backend/live_relay/server.js` | C1, C2, C3 | Tool declaration, toolCall handler, remove heuristic |
| `backend/historian_api/routes/illustrate.py` | C4 | Accept mood/composition params |
| `frontend/src/types/index.ts` | A3, D5 | New event types, segment_playable |
| `frontend/src/store/researchStore.ts` | A4 | Storyboard state slice |
| `frontend/src/store/playerStore.ts` | D2 | pipelineComplete flag |
| `frontend/src/hooks/useSSE.ts` | A5, D5 | New event handlers, drip bypass |
| `frontend/src/pages/WorkspacePage.tsx` | A7, D1 | Phase-aware layout, auto-open player |
| `frontend/src/components/player/DocumentaryPlayer.tsx` | C6, D4 | Enhanced illustration display, research PiP |
| `frontend/src/components/player/KenBurnsStage.tsx` | D3 | Progressive image arrival animation |
| `frontend/src/components/workspace/ExpeditionLog.tsx` | A (minor) | Phase 3.1 registration |
| `frontend/src/components/workspace/ResearchPanel.tsx` | A (minor) | Phase 3.1 in phase labels |
| `CLAUDE.md` | All | Update frontend section with new components |

### Files Unchanged
- `frontend/src/hooks/useGeminiLive.ts` — already handles `live_illustration`
- `frontend/src/components/player/CaptionTrack.tsx` — no changes needed
- `frontend/src/components/voice/` — all voice components unchanged
- `backend/agent_orchestrator/agents/document_analyzer.py` — Phase I unchanged
- `backend/agent_orchestrator/agents/scene_research_agent.py` — Phase II unchanged
- `terraform/main.tf` — infrastructure unchanged

---

## Summary

This plan transforms AI Historian from a **batch-then-play documentary generator** into a **streaming, interleaved, creative storytelling engine** that directly addresses every weak point identified in the alignment analysis:

| Gap | Fix | Workstream |
|---|---|---|
| Interleaved output invisible to user | Storyboard Stream shows TEXT+IMAGE emerging live | A |
| Sequential pipeline (wait → watch) | Per-segment generation with overlapping playback | B |
| Code orchestrates, not AI | Historian autonomously generates illustrations via NON_BLOCKING tools | C |
| All media pre-generated | Player opens on first playable segment, images arrive progressively | D |
| Demo doesn't prove interleaving | Cold open + storyboard streaming + live illustration in demo video | E |

After implementation, at every moment of the user experience, multiple modalities are active simultaneously. The AI is the creative director. The output is seamlessly interleaved. This is what the Creative Storyteller category demands.
