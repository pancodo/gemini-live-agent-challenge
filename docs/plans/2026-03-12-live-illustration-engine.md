# Live Illustration Engine — Implementation Plan

**Date:** 2026-03-12
**Goal:** Make Gemini's interleaved output capability (response_modalities=["TEXT","IMAGE"]) visible and real-time to judges. When the historian speaks during a live conversation, illustrations materialize on screen — text, images, audio, and captions flowing together in one cohesive stream.

**Category alignment:** Creative Storyteller — "seamlessly weaving together text, images, audio, and video in a single, fluid output stream."

---

## Architecture Overview

```
User speaks a question during documentary playback
         │
         ▼
┌─────────────────────────────────┐
│  live-relay (Node.js)           │
│  Receives user transcript       │
│  from Gemini Live API           │
│         │                       │
│         ├──► Gemini answers     │  (AUDIO + TEXT — already working)
│         │    with voice         │
│         │                       │
│         └──► POST /illustrate   │  (triggers illustration generation)
│              to historian-api   │
└─────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────┐
│  historian-api (FastAPI)        │
│                                 │
│  1. Retrieve RAG context        │
│     (document chunks)           │
│                                 │
│  2. Gemini interleaved call:    │
│     response_modalities=        │
│       ["TEXT", "IMAGE"]         │
│     → creative note + image     │
│                                 │
│  3. Upload image to GCS         │
│     → generate signed URL       │
│                                 │
│  4. Emit SSE segment_update     │
│     with new imageUrl           │
│                                 │
│  5. Return via WebSocket:       │
│     { type: 'live_illustration',│
│       imageUrl, caption }       │
└─────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────┐
│  Frontend (React 19)            │
│                                 │
│  KenBurnsStage receives new     │
│  image → cinematic crossfade    │
│  with "illustrating..." badge   │
│                                 │
│  CaptionTrack shows creative    │
│  direction note from Gemini     │
│                                 │
│  All happening WHILE historian  │
│  audio is still playing         │
└─────────────────────────────────┘
```

**Result the judge sees:** User asks "What did the Forum look like at its peak?" → historian's voice answers → a Gemini-generated illustration of the Roman Forum fades onto screen mid-sentence → caption shows Gemini's creative note → all four modalities flowing simultaneously.

---

## 5 Agent Teams

Each team is independently implementable. No team blocks another except Team 1 (backend endpoint) which Teams 2–4 depend on.

```
Team 1 (backend)  ──► Team 2 (live-relay)
                  ──► Team 3 (frontend)
                  ──► Team 4 (SSE + Firestore)
Team 5 (polish) waits for Teams 1–4
```

---

## Team 1: Illustration Endpoint (Backend — historian-api)

**Files to create:**
- `backend/historian_api/routes/illustrate.py`

**Files to modify:**
- `backend/historian_api/main.py` (register new router)

### What to build

A new FastAPI endpoint that receives a user question + documentary context, makes a single Gemini interleaved call (`response_modalities=["TEXT","IMAGE"]`), uploads the generated image to GCS, and returns a signed URL + the creative direction text.

### Endpoint spec

```
POST /api/session/{session_id}/illustrate
Body: {
  "query": "What did the Roman Forum look like?",
  "current_segment_id": "segment_2",
  "mood": "cinematic"
}
Response: {
  "imageUrl": "https://storage.googleapis.com/...",
  "caption": "The Forum at dawn — marble columns catching first light...",
  "generatedAt": "2026-03-12T10:30:00Z"
}
```

### Implementation details

```python
# backend/historian_api/routes/illustrate.py

# 1. Read session context from Firestore:
#    - visual_bible (style guide)
#    - current segment script + mood
#    - document language

# 2. Retrieve RAG context (reuse existing retrieve_chunks logic):
#    - Vector search for user's query
#    - Top 3 chunks as grounding context

# 3. Build illustration prompt:
ILLUSTRATION_PROMPT = """
You are the creative director of a cinematic historical documentary.
The viewer just asked: "{query}"

VISUAL BIBLE (style reference):
{visual_bible}

CURRENT SCENE:
Title: {segment_title}
Mood: {mood}
Narration: {narration_excerpt}

DOCUMENT CONTEXT:
{rag_context}

First, write a brief creative direction note (1-2 sentences) describing
what the viewer should see — composition, lighting, historical accuracy.

Then generate ONE cinematic illustration that directly answers the viewer's
question. The illustration must:
- Match the Visual Bible style exactly
- Be historically accurate to the era and region
- Use cinematic 16:9 composition
- Convey the mood: {mood}
- Contain NO modern elements or anachronisms

Generate the illustration now.
"""

# 4. Call Gemini with interleaved output:
response = await client.aio.models.generate_content(
    model="gemini-2.5-flash-image",
    contents=[prompt],
    config=genai_types.GenerateContentConfig(
        response_modalities=["TEXT", "IMAGE"],
        temperature=0.7,
    ),
)

# 5. Parse response — extract text parts and inline_data parts
# 6. Upload image bytes to GCS:
#    gs://{bucket}/sessions/{session_id}/illustrations/{uuid}.jpg
# 7. Generate signed URL (1 hour expiry)
# 8. Return { imageUrl, caption }
```

### Error handling
- If Gemini returns no image (safety filter): return `{ imageUrl: null, caption: text_only }`
- If Gemini call fails: return 503 with retry-after header
- Timeout: 15 seconds max (Gemini interleaved is typically 3-8s)

### Rate limiting
- Max 1 illustration per 10 seconds per session (debounce at endpoint level)
- Prevents rapid-fire questions from burning Gemini quota

---

## Team 2: Live-Relay Trigger (Backend — live-relay)

**Files to modify:**
- `backend/live_relay/server.js`

### What to build

Extend the existing transcript handler in live-relay to detect when the user asks a substantive question during documentary playback, and trigger the illustration endpoint in the background. The illustration result is forwarded to the frontend via a new WebSocket message type.

### Implementation details

```javascript
// In server.js, after existing RAG injection logic (around line 427):

// --- LIVE ILLUSTRATION TRIGGER ---
// After debounced transcript processing, check if question is
// substantive enough to warrant illustration.

const ILLUSTRATION_COOLDOWN_MS = 12_000; // 12s between illustrations
const lastIllustrationTime = new Map(); // sessionId → timestamp

async function maybeGenerateIllustration(sessionId, transcript, clientWs) {
  // 1. Cooldown check
  const now = Date.now();
  const lastTime = lastIllustrationTime.get(sessionId) || 0;
  if (now - lastTime < ILLUSTRATION_COOLDOWN_MS) return;

  // 2. Length heuristic: question must be >20 chars
  if (transcript.length < 20) return;

  // 3. Get current segment from Firestore (or cache)
  //    to pass mood + segment_id

  // 4. Fire-and-forget POST to historian-api
  lastIllustrationTime.set(sessionId, now);

  try {
    const res = await fetch(
      `${HISTORIAN_API_URL}/api/session/${sessionId}/illustrate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: transcript,
          current_segment_id: currentSegmentId,
          mood: currentMood || 'cinematic',
        }),
        signal: AbortSignal.timeout(15_000),
      }
    );

    if (!res.ok) return;
    const { imageUrl, caption } = await res.json();

    if (imageUrl && clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify({
        type: 'live_illustration',
        imageUrl,
        caption,
      }));
    }
  } catch (err) {
    console.warn('[live-relay] Illustration generation failed:', err.message);
    // Non-fatal: historian voice continues regardless
  }
}

// Call from transcript handler:
// maybeGenerateIllustration(sessionId, transcript, clientWs);
```

### Key design decisions
- **Fire-and-forget:** The illustration call NEVER blocks Gemini audio. The historian keeps speaking. The image arrives 3-8 seconds later as a bonus visual.
- **Cooldown:** 12 seconds between illustrations prevents spam and quota burn.
- **Non-fatal:** Any failure is silently swallowed. The documentary experience continues perfectly without the illustration.

---

## Team 3: Frontend — Live Illustration Display

**Files to modify:**
- `frontend/src/hooks/useGeminiLive.ts` — handle new message type
- `frontend/src/store/playerStore.ts` — add live illustration state
- `frontend/src/components/player/KenBurnsStage.tsx` — display live illustration with crossfade
- `frontend/src/components/player/DocumentaryPlayer.tsx` — show illustration badge
- `frontend/src/types/index.ts` — add types

### Types

```typescript
// types/index.ts — add:

export interface LiveIllustration {
  imageUrl: string;
  caption: string;
  receivedAt: number; // Date.now() for animation timing
}
```

### playerStore changes

```typescript
// playerStore.ts — add to state:
liveIllustration: LiveIllustration | null;
setLiveIllustration: (ill: LiveIllustration | null) => void;

// Auto-clear after 30 seconds (illustration is ephemeral):
// On set, start a timeout that clears it.
```

### useGeminiLive changes

```typescript
// useGeminiLive.ts — in the WebSocket message handler, add case:

case 'live_illustration': {
  const { imageUrl, caption } = msg;
  if (imageUrl) {
    playerStore.getState().setLiveIllustration({
      imageUrl,
      caption,
      receivedAt: Date.now(),
    });
  }
  break;
}
```

### KenBurnsStage changes

```typescript
// KenBurnsStage.tsx — add live illustration overlay:

// When liveIllustration is set:
// 1. Crossfade the new image ON TOP of the current Ken Burns cycle
//    (don't replace — overlay with opacity animation)
// 2. Apply Ken Burns zoom/drift to the illustration too
// 3. After 20 seconds, crossfade back to the regular cycle
// 4. The illustration appears with a subtle golden border glow
//    to distinguish it from pre-generated images

// Implementation:
// - Add a <motion.img> absolutely positioned over the cycle
// - AnimatePresence with fade-in (1s) and fade-out (1.5s)
// - Ken Burns animation applied identically
// - z-index above cycle images but below captions
```

### DocumentaryPlayer badge

```typescript
// DocumentaryPlayer.tsx — add illustration indicator:

// When liveIllustration is active, show a small badge in the top-right:
//   "✦ Illustrating..." with fade-in animation
// The badge uses the same archival-frame corner bracket style
// Disappears when liveIllustration clears

// Also: show the caption from the illustration as a secondary
// subtitle line below the main CaptionTrack, in a smaller font
// with italic style and gold color:
//   "The Forum at dawn — marble columns catching first light..."
```

### Animation sequence (what the judge sees)

```
t=0.0s  User asks: "What did the Forum look like?"
t=0.2s  Historian begins speaking (audio + captions — existing)
t=0.3s  "✦ Illustrating..." badge fades in (top-right)
t=3-8s  Gemini generates text+image (interleaved call)
t=~6s   Image arrives via WebSocket
t=~6s   Ken Burns stage: current image begins fading out (1s)
t=~7s   New illustration fully visible, Ken Burns zoom begins
t=~7s   Creative direction caption appears below main caption
t=~7s   Badge changes to "✦ Illustrated" then fades out (2s)
t=26s   Illustration fades out, regular cycle resumes
```

---

## Team 4: SSE + Firestore Persistence

**Files to modify:**
- `backend/historian_api/routes/illustrate.py` (from Team 1 — add SSE emission)
- `backend/agent_orchestrator/agents/sse_helpers.py` — add builder
- Firestore schema extension

### What to build

After the illustration is generated, persist it to Firestore and emit an SSE event so:
1. The illustration survives page refresh
2. The Expedition Log shows "Historian illustrated: [caption]"
3. The segment's image gallery includes live illustrations

### SSE helper

```python
# sse_helpers.py — add:

def build_live_illustration_event(
    *,
    segment_id: str,
    image_url: str,
    caption: str,
    query: str,
) -> dict[str, Any]:
    return {
        "type": "live_illustration",
        "segmentId": segment_id,
        "imageUrl": image_url,
        "caption": caption,
        "query": query,
    }
```

### Firestore write

```python
# In illustrate.py, after GCS upload:

# Write to Firestore subcollection:
# /sessions/{sessionId}/illustrations/{illustrationId}
#   query: str
#   caption: str
#   imageUrl: str (signed URL)
#   gcsUri: str
#   segmentId: str
#   createdAt: timestamp

# Also append imageUrl to the segment's imageUrls array:
# /sessions/{sessionId}/segments/{segmentId}
#   imageUrls: arrayUnion([signed_url])
```

### SSE emission

```python
# In illustrate.py, after Firestore write:

# Emit to the session's SSE log so reconnecting clients see it:
session_log = get_session_event_log(session_id)
if session_log:
    event = build_live_illustration_event(
        segment_id=segment_id,
        image_url=signed_url,
        caption=direction_text,
        query=query,
    )
    session_log.append(json.dumps(event))
```

### Frontend SSE handling

```typescript
// useSSE.ts — add case in processEvent:

case 'live_illustration': {
  // Update segment imageUrls in researchStore
  const seg = useResearchStore.getState().segments[event.segmentId];
  if (seg) {
    setSegment(event.segmentId, {
      imageUrls: [...seg.imageUrls, event.imageUrl],
    });
  }
  // Also update playerStore if this is the active segment
  const player = usePlayerStore.getState();
  if (player.currentSegmentId === event.segmentId) {
    player.setLiveIllustration({
      imageUrl: event.imageUrl,
      caption: event.caption,
      receivedAt: Date.now(),
    });
  }
  break;
}
```

---

## Team 5: Polish & Demo-Ready

**Files to modify:**
- `frontend/src/components/player/KenBurnsStage.tsx` — transition refinement
- `frontend/src/components/player/CaptionTrack.tsx` — illustration caption style
- `backend/live_relay/prompt-builder.js` — tell historian about illustration capability
- Various CSS

### Tasks

#### 5a. Historian awareness
Modify `prompt-builder.js` system instruction to tell the historian:

```
When a viewer asks a visual question (about places, events, people, objects),
mention that you're creating an illustration. Say something like "Let me paint
that picture for you..." or "Imagine this scene..." — this primes the viewer
to expect the illustration that will appear moments later.
```

This creates a seamless narrative bridge: the historian says "Let me show you..." → 3 seconds later, the illustration appears. The judge perceives unified intent, not separate systems.

#### 5b. Illustration caption styling
The creative direction note from Gemini appears as a secondary caption below the main CaptionTrack:

```css
/* Illustration caption — gold italic, smaller than main captions */
.illustration-caption {
  font-family: 'Cormorant Garamond', serif;
  font-weight: 300;
  font-style: italic;
  font-size: 16px;
  color: var(--gold);
  letter-spacing: 0.03em;
  opacity: 0.85;
  text-shadow: 0 1px 12px rgba(0,0,0,0.7);
}
```

#### 5c. Transition refinement
The live illustration crossfade should feel cinematic, not jarring:

```typescript
// KenBurnsStage — illustration overlay:
<AnimatePresence>
  {liveIllustration && (
    <motion.img
      key={liveIllustration.imageUrl}
      src={liveIllustration.imageUrl}
      initial={{ opacity: 0, scale: 1.0 }}
      animate={{ opacity: 1, scale: 1.08 }}
      exit={{ opacity: 0 }}
      transition={{
        opacity: { duration: 1.2, ease: 'easeInOut' },
        scale: { duration: 20, ease: 'linear' },
      }}
      className="absolute inset-0 w-full h-full object-cover"
      style={{ zIndex: 2 }}
    />
  )}
</AnimatePresence>
```

#### 5d. Loading shimmer
While the illustration is being generated (between "✦ Illustrating..." badge and image arrival), show a subtle golden shimmer pulse over the Ken Burns stage:

```css
@keyframes illustration-generating {
  0%, 100% { box-shadow: inset 0 0 60px rgba(139, 94, 26, 0); }
  50% { box-shadow: inset 0 0 60px rgba(139, 94, 26, 0.12); }
}
```

#### 5e. Demo script addition
Update `docs/demo/DEMO_SCRIPT.md` with a dedicated "Live Illustration" demo moment:
1. Start documentary playing (any historical document)
2. Wait for 2nd segment to begin
3. Press voice button, ask: "What did this place look like in its golden age?"
4. Point out: historian speaks → "Illustrating..." badge → image fades in → caption appears
5. Emphasize: "One Gemini call produced both the creative direction text and the illustration — native interleaved output, not separate API calls."

---

## Summary: File Change Matrix

| File | Team | Action |
|---|---|---|
| `backend/historian_api/routes/illustrate.py` | 1, 4 | CREATE — new endpoint |
| `backend/historian_api/main.py` | 1 | MODIFY — register router |
| `backend/live_relay/server.js` | 2 | MODIFY — add illustration trigger |
| `backend/live_relay/prompt-builder.js` | 5 | MODIFY — historian awareness |
| `backend/agent_orchestrator/agents/sse_helpers.py` | 4 | MODIFY — add builder |
| `frontend/src/types/index.ts` | 3 | MODIFY — add LiveIllustration type |
| `frontend/src/hooks/useGeminiLive.ts` | 3 | MODIFY — handle new message |
| `frontend/src/hooks/useSSE.ts` | 4 | MODIFY — handle SSE event |
| `frontend/src/store/playerStore.ts` | 3 | MODIFY — add state |
| `frontend/src/components/player/KenBurnsStage.tsx` | 3, 5 | MODIFY — overlay + transition |
| `frontend/src/components/player/DocumentaryPlayer.tsx` | 3 | MODIFY — badge |
| `frontend/src/components/player/CaptionTrack.tsx` | 5 | MODIFY — illustration caption |

---

## Execution Order

```
Team 1 (backend endpoint)          — can start immediately
Team 2 (live-relay trigger)        — can start immediately, needs Team 1 endpoint URL
Team 3 (frontend display)          — can start immediately with mock data
Team 4 (SSE + Firestore)           — starts after Team 1 endpoint exists
Team 5 (polish)                    — starts after Teams 1-4 are integrated
```

**Parallel execution:** Teams 1, 2, and 3 can all start simultaneously. Team 3 mocks the WebSocket message with a dev button until Teams 1+2 are ready.

---

## What the Judge Experiences

1. Documentary plays — cinematic visuals, historian narration, word-by-word captions
2. User presses voice button: "What did this city look like before the eruption?"
3. Historian responds with voice: "Let me paint that picture for you. Pompeii was a thriving Roman city with..."
4. Golden shimmer pulses over the current image ("✦ Illustrating...")
5. 3-5 seconds later: a Gemini-generated illustration of pre-eruption Pompeii crossfades onto screen
6. Below the captions, in gold italic: "The streets of Pompeii in morning light — merchants, fountains, Vesuvius looming peaceful in the distance"
7. The historian continues speaking over the illustration
8. After 20 seconds, the illustration fades and the regular documentary visuals resume

**Four modalities, one fluid stream:** Audio (historian voice) + Text (captions + creative note) + Image (Gemini-generated illustration) + Video (Ken Burns animation on the illustration). All triggered by a single user question, all flowing simultaneously.
