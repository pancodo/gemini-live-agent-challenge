# Interleaved Narration Engine — Implementation Plan

**Date:** 2026-03-14
**Goal:** Make Gemini's native interleaved TEXT+IMAGE output the centerpiece of the documentary player experience, upgrading the Creative Storyteller alignment from WEAK to STRONG.

## Problem

The documentary player stitches 3 independent streams (pre-gen Imagen 3 images, Gemini Live audio, forwarded captions). The one genuine `response_modalities=["TEXT","IMAGE"]` call (NarrativeDirectorAgent, Phase IV) only appears in the workspace storyboard panel. Judges watching the documentary player never see native interleaved output.

## Solution: Beat-Driven Interleaved Playback

When a segment plays, the backend decomposes its narration script into 3-4 dramatic "beats". For each beat, Gemini generates narration text + a cinematic illustration in a single TEXT+IMAGE call. The results stream to the player via SSE. The beat text is then fed to Gemini Live for audio narration. The viewer watches AI compose the documentary in real-time.

### Flow

```
Segment opens
  → Pre-gen Imagen 3 images show instantly (fallback)
  → POST /narrate triggers beat generation
  → Beat 0: Gemini TEXT+IMAGE → image cross-fades in, text → Gemini Live speaks
  → While speaking, Beats 1-3 pre-generate concurrently
  → Beat 1 arrives → image transitions, new narration text → Live speaks
  → Repeat until all beats delivered
```

### Two Interleaved Output Modes Working Together

1. **Gemini TEXT+IMAGE** (per beat) — generates what the viewer SEES and what the historian SAYS
2. **Gemini Live AUDIO+TEXT** (always-on) — narrates beat text with historian personality + captions

## File Changes

### New Files
- `backend/historian_api/routes/narrate.py` — Beat narration endpoint

### Modified Files
- `backend/historian_api/models.py` — NarrateResponse model
- `backend/historian_api/main.py` — Register narrate router
- `backend/agent_orchestrator/agents/sse_helpers.py` — `build_narration_beat_event`
- `frontend/src/types/index.ts` — NarrationBeatEvent type + SSEEvent union
- `frontend/src/store/playerStore.ts` — Beat state (beats array, currentBeatIndex)
- `frontend/src/hooks/useSSE.ts` — narration_beat handler
- `frontend/src/services/api.ts` — `startNarration()` API call
- `frontend/src/components/player/DocumentaryPlayer.tsx` — Beat-driven auto-narration
- `frontend/src/components/player/KenBurnsStage.tsx` — Beat-driven image transitions

## Implementation Teams

### Wave 1 (3 teams, parallel)

**Team 1: Backend Endpoint** — `narrate.py` + `sse_helpers.py` + `models.py` + `main.py`
**Team 2: Frontend Data Layer** — `types/index.ts` + `playerStore.ts` + `useSSE.ts` + `api.ts`
**Team 3: Plan Doc** — This file (already done)

### Wave 2 (1 team, after Wave 1)

**Team 4: Player Integration** — `DocumentaryPlayer.tsx` + `KenBurnsStage.tsx`

## Beat Narration Endpoint Design

```
POST /api/session/{session_id}/segment/{segment_id}/narrate
Response: { beats_generated: int, segment_id: str }
Side effect: Emits narration_beat SSE events
```

### Step 1: Decompose Script → Beats
- Gemini 2.0 Flash call to split script into 3-4 dramatic beats
- Each beat: `{ beat_index, narration_text, visual_moment }`
- Fallback: even sentence split if JSON parsing fails

### Step 2: Generate Beat Illustrations
- Beat 0 first (fast path for first visible content)
- Beats 1-N concurrently via asyncio.gather
- Each beat: `response_modalities=["TEXT","IMAGE"]` with `gemini-2.5-flash-image`
- Image uploaded to GCS, signed URL generated
- SSE event emitted per beat

### Progressive Enhancement
- Pre-gen Imagen 3 images are the instant fallback
- Beats arrive and cross-fade over the pre-gen images
- If beat generation fails entirely, user never notices
