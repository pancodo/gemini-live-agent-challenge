# WEAK → STRONG: Alignment Gap Closure Plan

**Date:** 2026-03-14
**Goal:** Elevate every WEAK and MODERATE dimension to STRONG before submission.
**Research basis:** 5 parallel research agents analyzed the current code state for each gap.

---

## Table of Contents

1. [Issues Ranked by Impact](#1-issues-ranked-by-impact)
2. [Team 1: Auto-Narration + Caption Bridge (Frontend Player)](#2-team-1-auto-narration--caption-bridge)
3. [Team 2: Pipeline Activation + segment_playable (Backend Pipeline)](#3-team-2-pipeline-activation--segment_playable)
4. [Team 3: Visual Coherence + Style Helpers (Backend Cross-Cutting)](#4-team-3-visual-coherence--style-helpers)
5. [Team 4: Imagen 3 Reference Images + AI Frame Count (Backend Visual)](#5-team-4-imagen-3-reference-images--ai-frame-count)
6. [Team 5: Live Relay Era Context (Node.js)](#6-team-5-live-relay-era-context)
7. [File Change Map](#7-file-change-map)
8. [Build Sequence](#8-build-sequence)

---

## 1. Issues Ranked by Impact

| # | Issue | Current | Target | Team |
|---|---|---|---|---|
| 1 | **Passive player is silent** — no audio, no captions until user presses voice button | WEAK | STRONG | Team 1 |
| 2 | **Caption bridge is broken** — `voiceStore.caption` never forwarded to `playerStore.captionText`, so `CaptionTrack` always shows empty | WEAK | STRONG | Team 1 |
| 3 | **`StreamingPipelineAgent` not wired as default** — `routes/pipeline.py` still calls `build_new_pipeline()` (batch sequential) | MODERATE | STRONG | Team 2 |
| 4 | **`segment_playable` never emitted** — typed in frontend, never emitted by backend | MODERATE | STRONG | Team 2 |
| 5 | **Visual Bible never written to Firestore** — `illustrate.py` and live relay always get empty string | WEAK | STRONG | Team 3 |
| 6 | **Style incoherence** — Phase V uses 15-layer style stack; storyboard and live illustration use raw Visual Bible prose | WEAK | STRONG | Team 3 |
| 7 | **Storyboard images don't feed Imagen 3** — GCS URI embedded as text in prompt; Imagen can't see pixels | WEAK | STRONG | Team 4 |
| 8 | **Frame count hardcoded** — `_NARRATIVE_FRAME_PLAN` overrides Phase 4.0's `frame_concepts` | MODERATE | STRONG | Team 4 |
| 9 | **GCS `gs://` URLs stripped by frontend** — Veo 2 video and some image URLs never reach player | MODERATE | STRONG | Team 4 |
| 10 | **Live relay lacks era context** — historian persona has no period/era awareness for visual guidance | MODERATE | STRONG | Team 5 |

---

## 2. Team 1: Auto-Narration + Caption Bridge

### Files (zero overlap with other teams)
- `frontend/src/components/player/DocumentaryPlayer.tsx`
- `frontend/src/components/player/CaptionTrack.tsx`
- `frontend/src/hooks/useAudioPlayback.ts` (minor — expose turn timing)

### Fix 1.1: Auto-Narration on Player Mount

**The problem:** When the player opens, the user sees Ken Burns imagery but hears nothing. The historian only speaks when the user manually presses Space or clicks the voice button.

**The fix:** Add a `useEffect` in `DocumentaryPlayer.tsx` that auto-injects the segment's narration script into the Gemini Live session when the player mounts.

```typescript
// In DocumentaryPlayer.tsx
const sendTextToHistorian = useVoiceStore((s) => s.sendTextToHistorian);
const autoNarratedRef = useRef<Set<string>>(new Set());

useEffect(() => {
  if (!currentSegment?.id || !currentSegment.script) return;
  if (currentSegment.script.length < 50) return; // not ready yet
  if (autoNarratedRef.current.has(currentSegment.id)) return;
  if (!sendTextToHistorian) return;

  autoNarratedRef.current.add(currentSegment.id);

  // Small delay to let player UI settle after iris transition
  const timer = setTimeout(() => {
    const prompt = [
      'You are now narrating the documentary. Begin speaking immediately in your historian voice.',
      '',
      `Chapter: ${currentSegment.title}`,
      '',
      'Script to narrate:',
      currentSegment.script,
      '',
      'Narrate this script naturally and compellingly. Do not say "I will now narrate" — just speak as the narrator.',
      'You may use the generate_illustration tool to add visuals as you speak.',
    ].join('\n');

    sendTextToHistorian(prompt);
  }, 800);

  return () => clearTimeout(timer);
}, [currentSegment?.id, currentSegment?.script, sendTextToHistorian]);
```

**How it works:** `sendTextToHistorian` (already registered by `VoiceLayer`) auto-connects the WebSocket if idle, waits for setup (1500ms built-in), then injects text. Gemini responds with streamed audio — the same historian voice, interruptible at any moment.

**Race condition guards:**
- `autoNarratedRef` keyed by segmentId prevents double-fire on re-render
- Script length check (>50 chars) ensures we don't fire before Phase III completes
- `sendTextToHistorian` null check guards against first-render timing
- 800ms delay lets the iris transition complete before voice starts
- When navigating to next segment, the effect re-fires — historian narrates each chapter

### Fix 1.2: Caption Bridge (voiceStore → playerStore)

**The problem:** `voiceStore.caption` is set by `VoiceLayer.onCaption` but `playerStore.captionText` (read by `CaptionTrack`) is never written during live narration. The word-by-word caption animation is dead code during playback.

**The fix:** Add a bridge effect in `DocumentaryPlayer.tsx`:

```typescript
// Bridge voice captions to player captions
const voiceCaption = useVoiceStore((s) => s.caption);
const setCaption = usePlayerStore((s) => s.setCaption);

useEffect(() => {
  if (voiceCaption) {
    setCaption(voiceCaption);
  }
}, [voiceCaption, setCaption]);
```

Two lines of actual logic. `CaptionTrack` immediately starts working — words animate in with `word-appear` as the historian speaks.

### Fix 1.3: Rate-Calibrated Caption Stagger (Optional Enhancement)

**The problem:** `CaptionTrack` staggers words at fixed 80ms intervals regardless of speech pace. A 20-word sentence reveals in 1.6s even if the historian takes 5s to say it.

**The fix:** Expose audio timing from `useAudioPlayback` and use it to calibrate stagger.

In `useAudioPlayback.ts`, add:
```typescript
const turnStartTimeRef = useRef<number>(0);
const samplesEnqueuedRef = useRef<number>(0);

// Reset on stop() or new turn
// Increment samplesEnqueuedRef on each enqueue()
// Expose: getTurnElapsedMs(): number
```

In `CaptionTrack.tsx`, accept an optional `wordsPerSecond` prop. When available, compute stagger as `1000 / wps / totalWords` ms per word instead of fixed 80ms. When unavailable, fall back to 60ms (slightly faster than current 80ms for better match with typical narration pace).

The `wordsPerSecond` is estimated in the bridge effect:
```typescript
// In DocumentaryPlayer.tsx bridge
const turnStartRef = useRef(Date.now());
useEffect(() => {
  if (voiceCaption) {
    const elapsed = (Date.now() - turnStartRef.current) / 1000;
    const wordCount = voiceCaption.split(/\s+/).length;
    const wps = elapsed > 0.5 ? wordCount / elapsed : 2.5; // default 2.5 wps
    setCaption(voiceCaption);
    setCaptionWps(wps); // new playerStore field
  }
}, [voiceCaption]);
```

---

## 3. Team 2: Pipeline Activation + segment_playable

### Files (zero overlap with other teams)
- `backend/historian_api/routes/pipeline.py`
- `backend/agent_orchestrator/agents/pipeline.py`
- `backend/agent_orchestrator/agents/sse_helpers.py`

### Fix 2.1: Activate StreamingPipelineAgent as Default

**The problem:** `routes/pipeline.py` imports and calls `build_new_pipeline()` which returns `ResumablePipelineAgent` — the batch-sequential pipeline. The `StreamingPipelineAgent` with per-segment coroutines is fully implemented but never called.

**The fix:** One import change in `routes/pipeline.py`:

```python
# Change line 26 from:
from agent_orchestrator.agents.pipeline import build_new_pipeline
# To:
from agent_orchestrator.agents.pipeline import build_streaming_pipeline

# Change line 151 from:
pipeline = build_new_pipeline(emitter=emitter)
# To:
pipeline = build_streaming_pipeline(emitter=emitter)
```

**Keep `build_new_pipeline` as fallback:** Add an env var `PIPELINE_MODE` that defaults to `"streaming"`. If set to `"batch"`, use `build_new_pipeline()`. This enables safe rollback.

```python
pipeline_mode = os.environ.get("PIPELINE_MODE", "streaming")
if pipeline_mode == "streaming":
    pipeline = build_streaming_pipeline(emitter=emitter)
else:
    pipeline = build_new_pipeline(emitter=emitter)
```

### Fix 2.2: Emit segment_playable from Backend

**The problem:** `segment_playable` is typed in the frontend and handled in `useSSE.ts`, but the backend never emits it. The `StreamingPipelineAgent` has docstrings describing it but no actual `emit` call.

**The fix:**

Step 1 — Add builder to `sse_helpers.py`:
```python
def build_segment_playable_event(*, segment_id: str) -> dict[str, Any]:
    """Emitted when a segment has enough content to start playback."""
    return {
        "type": "segment_playable",
        "segmentId": segment_id,
    }
```

Step 2 — In `pipeline.py`, inside `StreamingPipelineAgent._run_segment_pipeline`, emit after Imagen 3 completes for a segment:

```python
# After _generate_images returns for this segment
await self.emitter.emit(
    "segment_playable",
    build_segment_playable_event(segment_id=segment["id"]),
)
```

The exact insertion point: after the visual director completes image generation for scene 0 (the fast path). The frontend `useSSE.ts` handler at line 137-139 already calls `researchStore.setSegment(event.segmentId, { status: 'ready' })`, which triggers `WorkspacePage`'s `firstPlayableId` auto-watch.

### Fix 2.3: Sign All GCS URLs Before SSE Emission

**The problem:** `visual_director_orchestrator.py` emits `segment_update` events with raw `gs://` URIs. The frontend's `useSSE.ts` line 84 strips these: `event.videoUrl?.startsWith('gs://') ? undefined : event.videoUrl`. Images have the same issue for any non-signed paths.

**The fix:** In `pipeline.py`'s `StreamingPipelineAgent`, after each visual phase completes per-segment, call a signing helper before emitting SSE:

```python
from datetime import timedelta
from google.cloud import storage

def _sign_gcs_url(gcs_uri: str, bucket_name: str) -> str:
    """Convert gs:// URI to 4-hour signed HTTPS URL."""
    if not gcs_uri.startswith("gs://"):
        return gcs_uri
    blob_path = gcs_uri.replace(f"gs://{bucket_name}/", "")
    client = storage.Client()
    blob = client.bucket(bucket_name).blob(blob_path)
    return blob.generate_signed_url(
        expiration=timedelta(hours=4),
        method="GET",
        version="v4",
    )
```

Apply to both `imageUrls` and `videoUrl` in `segment_update` events before emission. The `GCS_BUCKET_NAME` env var is already available in the pipeline context.

---

## 4. Team 3: Visual Coherence + Style Helpers

### Files (zero overlap with other teams)
- `backend/agent_orchestrator/agents/document_analyzer.py` (one-line Firestore write)
- `backend/agent_orchestrator/agents/prompt_style_helpers.py` (NEW — shared style module)
- `backend/historian_api/routes/illustrate.py` (use shared style helpers)
- `backend/agent_orchestrator/agents/narrative_director_agent.py` (augment storyboard prompt with style terms)

### Fix 3.1: Write Visual Bible to Firestore

**The problem:** `document_analyzer.py` writes `session.state["visual_bible"]` (in-memory ADK state) but never persists it to the Firestore root document `/sessions/{id}`. The `illustrate.py` endpoint and `live_relay/firestore-context.js` both read `visualBible` from Firestore and always get empty string.

**The fix:** After line ~1003 in `document_analyzer.py` (where `visual_bible` is written to session state), add:

```python
# Persist Visual Bible to Firestore for out-of-pipeline consumers
session_id = ctx.session.id
db = firestore.AsyncClient(project=self.project_id)
await db.collection("sessions").document(session_id).update({
    "visualBible": visual_bible,
})
```

One write. Immediately unblocks both `illustrate.py` and `live-relay` from receiving the Visual Bible.

### Fix 3.2: Extract Shared Style Helpers

**The problem:** Phase V's 15-layer style stack (`_detect_era_art_style`, `_detect_film_stock`, `_build_temporal_accuracy_prefix`, `_ERA_ART_STYLE_REFERENCES`, `HISTORICAL_PERIOD_PROFILES`, etc.) lives exclusively in `visual_director_orchestrator.py`. Neither the storyboard prompt nor the live illustration endpoint can access these functions.

**The fix:** Create `backend/agent_orchestrator/agents/prompt_style_helpers.py` extracting:

```python
# prompt_style_helpers.py — Shared visual style functions

# From visual_director_orchestrator.py, extract:
_ERA_ART_STYLE_REFERENCES: dict[str, str]  # era → painter reference
HISTORICAL_PERIOD_PROFILES: dict[str, dict]  # period → architecture/materials/palette

def detect_era_art_style(era: str) -> str: ...
def detect_film_stock(mood: str, era: str, title: str) -> str: ...
def build_temporal_accuracy_prefix(scene_brief: dict, era: str) -> str: ...
def build_atmosphere_suffix(narrative_role: str) -> str: ...
def build_style_block(
    *,
    visual_bible: str,
    era: str,
    mood: str,
    title: str,
    narrative_role: str,
    scene_brief: dict | None = None,
) -> str:
    """Build a portable style block for any image-generating prompt."""
    art_style = detect_era_art_style(era)
    film_stock = detect_film_stock(mood, era, title)
    temporal = build_temporal_accuracy_prefix(scene_brief or {}, era)
    atmosphere = build_atmosphere_suffix(narrative_role)
    return f"""STYLE TERMS (apply these exactly):
- Visual Bible: {visual_bible[:400]}
- Art style reference: {art_style}
- Film stock: {film_stock}
- Temporal accuracy: {temporal}
- Atmosphere: {atmosphere}"""
```

Then update `visual_director_orchestrator.py` to import from `prompt_style_helpers` instead of defining locally. No behavior change.

### Fix 3.3: Wire Style Helpers into illustrate.py

**The fix:** In `illustrate.py`, after reading `visualBible` and segment data from Firestore:

```python
from agent_orchestrator.agents.prompt_style_helpers import build_style_block

# Read era from the segment's scene brief (already in Firestore)
era = segment_data.get("era", "")

style_block = build_style_block(
    visual_bible=visual_bible,
    era=era,
    mood=body.mood or segment_data.get("mood", ""),
    title=segment_data.get("title", ""),
    narrative_role=segment_data.get("narrativeRole", ""),
)

# Inject style_block into ILLUSTRATION_PROMPT
```

Now live illustrations use the same film stocks, era references, and temporal accuracy as Phase V Imagen 3 images.

### Fix 3.4: Augment Storyboard Prompt with Style Terms

**The fix:** In `narrative_director_agent.py`, add a style block to `_STORYBOARD_PROMPT`:

```python
from .prompt_style_helpers import build_style_block

# In _run_async_impl, before the Gemini call for each scene:
style_terms = build_style_block(
    visual_bible=visual_bible,
    era=scene_brief.get("era", ""),
    mood=scene_brief.get("mood", ""),
    title=scene_brief.get("title", ""),
    narrative_role=scene_brief.get("narrative_role", ""),
    scene_brief=scene_brief,
)

# Append to the prompt:
prompt += f"\n\n{style_terms}\n\nMatch these style terms exactly in the illustration."
```

Now Phase 3.1 storyboard illustrations and Phase V Imagen 3 images share the same visual vocabulary.

---

## 5. Team 4: Imagen 3 Reference Images + AI Frame Count

### Files (zero overlap with other teams)
- `backend/agent_orchestrator/agents/visual_director_orchestrator.py`

### Fix 4.1: Pass Storyboard Image as Imagen 3 Reference

**The problem:** Phase 3.1 generates storyboard images and stores GCS URIs in `session.state["storyboard_images"]`. Phase V reads these URIs but only embeds them as text in the prompt — Imagen 3 cannot see the actual pixels.

**The fix:** Use `GenerateImagesConfig.reference_images` to pass the storyboard image as a style reference:

```python
from google.genai.types import RawReferenceImage, ReferenceImage

# In _generate_segment_images, before frame loop:
storyboard_uri = storyboard_images.get(scene_id, [None])[0]
reference_images = []

if storyboard_uri:
    try:
        # Download storyboard bytes from GCS
        blob_path = storyboard_uri.replace(f"gs://{self.bucket_name}/", "")
        blob = storage.Client().bucket(self.bucket_name).blob(blob_path)
        storyboard_bytes = blob.download_as_bytes()

        reference_images = [ReferenceImage(
            reference_image=RawReferenceImage(
                reference_id=1,
                reference_type="STYLE",
                image={"image_bytes": storyboard_bytes, "mime_type": "image/jpeg"},
            )
        )]
    except Exception as e:
        logger.warning(f"Could not load storyboard reference for scene {scene_id}: {e}")

# In _generate_one_frame, pass reference_images to config:
config = genai_types.GenerateImagesConfig(
    number_of_images=1,
    aspect_ratio="16:9",
    negative_prompt=negative_prompt,
    reference_images=reference_images if reference_images else None,
    # ... existing params
)
```

Now Imagen 3 generates images that match the visual style of Gemini's own storyboard illustration — closing the creative direction loop.

**Note:** The `reference_images` parameter on `imagen-3.0-fast-generate-001` may have specific availability constraints. If the API rejects it, fall back gracefully (the `try/except` handles this). The storyboard URI still flows as a text hint in the prompt as before.

### Fix 4.2: AI-Driven Frame Count

**The problem:** `_NARRATIVE_FRAME_PLAN` hardcodes frame counts per `narrative_role`. A `coda` scene gets 1 frame even if Phase 4.0 produced 4 distinct `frame_concepts`. A battle climax and a quiet conversation both get 3 frames.

**The fix:** When `frame_prompts` from the `VisualDetailManifest` are available, use their count as the frame budget. Fall back to `_NARRATIVE_FRAME_PLAN` only when no manifest exists.

```python
def _frames_for_segment(
    self,
    segment: dict,
    scene_brief: dict,
    manifest: dict | None,
) -> list[int]:
    """Determine frame indices. AI-driven when manifest available, hardcoded fallback."""
    # Priority 1: Use manifest frame_prompts count (AI-decided)
    if manifest and manifest.get("frame_prompts"):
        frame_count = len(manifest["frame_prompts"])
        # Cap at 4 to stay within API budget
        frame_count = min(frame_count, 4)
        return list(range(frame_count))

    # Priority 2: Hardcoded plan (legacy fallback)
    role = scene_brief.get("narrative_role", "")
    return _NARRATIVE_FRAME_PLAN.get(role, _DEFAULT_FRAME_PLAN)
```

Also update `_generate_segment_images` to use the new signature:
```python
frame_indices = self._frames_for_segment(segment, scene_brief, manifest)
```

This means Phase 4.0's creative decisions (expressed as `frame_concepts`) directly control how many images are generated — the AI decides, not the code.

### Fix 4.3: Sign URLs Before All SSE Emissions

**The problem:** SSE `segment_update` events contain raw `gs://` URIs for both `imageUrls` and `videoUrl`. The frontend strips these.

**The fix:** In `_run_async_impl`, after generating images/videos, sign all URLs before emitting:

```python
# After _generate_segment_images returns image_urls (list of gs:// paths):
signed_image_urls = []
for uri in image_urls:
    if uri.startswith("gs://"):
        blob_path = uri.replace(f"gs://{self.bucket_name}/", "")
        blob = storage.Client().bucket(self.bucket_name).blob(blob_path)
        signed = blob.generate_signed_url(
            expiration=timedelta(hours=4), method="GET", version="v4"
        )
        signed_image_urls.append(signed)
    else:
        signed_image_urls.append(uri)

# Use signed_image_urls in segment_update SSE events
# Same pattern for videoUrl in generate_video_background
```

Apply the same signing in `generate_video_background` for Veo 2 video URLs before the `segment_update` emission.

---

## 6. Team 5: Live Relay Era Context

### Files (zero overlap with other teams)
- `backend/live_relay/firestore-context.js`
- `backend/live_relay/prompt-builder.js`

### Fix 5.1: Include Era Per Segment in Firestore Context

**The problem:** The historian persona has no era/period awareness for visual guidance. When the historian decides to call `generate_illustration`, it provides `mood` and `composition` but not era-specific style context.

**The fix:** In `firestore-context.js`, extend the context fetch to include segment data with era:

```javascript
// After fetching session doc, also fetch current segment:
const segmentSnap = await db
  .collection('sessions').doc(sessionId)
  .collection('segments').doc(currentSegmentId)
  .get();

const segmentData = segmentSnap.exists ? segmentSnap.data() : {};

return {
  ...existingContext,
  currentEra: segmentData.era || '',
  currentMood: segmentData.mood || '',
  currentTitle: segmentData.title || '',
};
```

### Fix 5.2: Add Era to Historian System Instruction

**The fix:** In `prompt-builder.js`, add era context to the visual guidance section:

```javascript
// In buildSystemInstruction():
const eraGuidance = context.currentEra
  ? `\n\nCURRENT HISTORICAL PERIOD: ${context.currentEra}\nWhen using generate_illustration, always specify a mood and composition appropriate to this period. Reference period-correct architecture, clothing, lighting, and atmospheric elements.`
  : '';

// Append eraGuidance to the system instruction
```

Now when the historian autonomously calls `generate_illustration`, it includes era-appropriate descriptions in the `subject` parameter, which flows to `illustrate.py` where the shared style helpers (from Team 3) apply the correct film stock, art style, and temporal accuracy.

---

## 7. File Change Map

### Files to Create
| File | Team | Purpose |
|---|---|---|
| `backend/agent_orchestrator/agents/prompt_style_helpers.py` | 3 | Shared style functions extracted from visual_director_orchestrator.py |

### Files to Modify

| File | Team | Changes |
|---|---|---|
| `frontend/src/components/player/DocumentaryPlayer.tsx` | 1 | Auto-narration useEffect, caption bridge, optional wps estimation |
| `frontend/src/components/player/CaptionTrack.tsx` | 1 | Accept optional `wordsPerSecond` prop, reduce default stagger to 60ms |
| `frontend/src/hooks/useAudioPlayback.ts` | 1 | Expose `getTurnElapsedMs()` for rate calibration (optional) |
| `backend/historian_api/routes/pipeline.py` | 2 | Switch to `build_streaming_pipeline()`, add env var fallback |
| `backend/agent_orchestrator/agents/pipeline.py` | 2 | Add `segment_playable` emission in `_run_segment_pipeline`, add URL signing helper |
| `backend/agent_orchestrator/agents/sse_helpers.py` | 2 | Add `build_segment_playable_event()` builder |
| `backend/agent_orchestrator/agents/document_analyzer.py` | 3 | Write `visualBible` to Firestore root document after Phase I |
| `backend/historian_api/routes/illustrate.py` | 3 | Import shared style helpers, read era from segment, inject style block |
| `backend/agent_orchestrator/agents/narrative_director_agent.py` | 3 | Augment storyboard prompt with structured style terms |
| `backend/agent_orchestrator/agents/visual_director_orchestrator.py` | 4 | Reference images from storyboard, AI frame count, sign URLs before SSE |
| `backend/live_relay/firestore-context.js` | 5 | Fetch segment era/mood/title alongside session context |
| `backend/live_relay/prompt-builder.js` | 5 | Add era guidance to historian system instruction |

### Files Unchanged
- All frontend components except DocumentaryPlayer.tsx and CaptionTrack.tsx
- All store files except optional `playerStore.ts` (captionWps field)
- `useSSE.ts` — already handles `segment_playable`
- `VoiceLayer.tsx` — already registers `sendTextToHistorian`
- `useGeminiLive.ts` — no changes needed
- `server.js` — no changes needed (Team 5 only touches firestore-context.js and prompt-builder.js)

---

## 8. Build Sequence

### Dependency Graph

```
Team 2 (Pipeline Activation)     — can start IMMEDIATELY
Team 3 (Visual Coherence)        — can start IMMEDIATELY
Team 5 (Live Relay Era)          — can start IMMEDIATELY

Team 1 (Auto-Narration)          — can start IMMEDIATELY (no backend deps)
Team 4 (Imagen 3 References)     — starts AFTER Team 3 creates prompt_style_helpers.py
                                    (Team 4 imports from the shared module for URL signing)
```

### Parallel Execution Plan

**Wave 1 (all in parallel):**
- Team 1: Frontend player auto-narration + caption bridge
- Team 2: Pipeline activation + segment_playable + signing helper
- Team 3: Visual Bible Firestore + prompt_style_helpers.py + illustrate.py + storyboard prompt
- Team 5: Live relay era context

**Wave 2 (after Team 3 completes):**
- Team 4: Imagen 3 reference images + AI frame count + URL signing

### Expected Outcome After All Teams Complete

| Dimension | Before | After |
|---|---|---|
| Passive player | Silent, captionless | Auto-narrates immediately, captions animate word-by-word |
| Caption sync | Dead code (bridge broken) | Live captions with rate-calibrated stagger |
| Pipeline mode | Batch-sequential | Per-segment streaming with Semaphore(2) concurrency |
| First segment playable | After all phases complete | After Scene 0 images generate |
| Visual Bible propagation | Pipeline-only (in-memory) | Persisted to Firestore, available to all consumers |
| Style coherence | 3 disconnected style systems | Shared `prompt_style_helpers` module, same vocabulary everywhere |
| Storyboard → Imagen 3 | GCS URI as text (invisible) | Pixel-level style reference via `reference_images` API |
| Frame count | Hardcoded per narrative_role | AI-driven from Phase 4.0 `frame_concepts` count |
| GCS URLs in SSE | Stripped by frontend | Signed HTTPS URLs before emission |
| Live relay era context | No era awareness | Period-specific visual guidance in persona |

**After implementation, every judge touchpoint delivers simultaneous multimodal output with stylistically coherent visuals. The AI is the creative director at every stage. No silent screens. No disconnected styles. No batch waiting.**
