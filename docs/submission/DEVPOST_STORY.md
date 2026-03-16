## Inspiration

Historical documents are humanity's memory, but for most people they're inaccessible. A cuneiform tablet is indecipherable. A medieval Latin charter is dense. A Qing dynasty edict needs specialized context. We asked: what if AI could do what documentary filmmakers do — research a primary source and bring it to life — but in real time, for any document, in any language, while letting you steer the story?

## What it does

Upload any historical document — a scanned manuscript, a treaty, a tablet photograph — in any language. Historia reads it, researches every claim in parallel with Google Search grounding, and starts narrating a cinematic documentary with generated visuals and voice while you watch. Interrupt mid-sentence to ask a question. It stops, answers, resumes. The documentary branches based on what you ask.

**Upload any document.** PDFs and images in 200+ languages, including dead scripts. Document AI handles OCR.

**Watch research happen live.** The Expedition Log narrates the AI's process as a journal — translating, dispatching research agents, cross-referencing sources, composing. Each agent appears as a living card with state transitions.

**Documentary begins before research finishes.** Scene 0 becomes playable in under 45 seconds. Remaining segments generate in the background.

**Self-generating film.** Imagen 3 photorealistic frames + Veo 2 video clips + Gemini-generated storyboard illustrations, Ken Burns animation that reacts to the narrator's voice, word-by-word caption reveals. An antique-styled map tracks locations as the story unfolds.

**Talk to the historian anytime.** The historian stops within 300ms, answers with grounded evidence, resumes the documentary. Ask a follow-up and the documentary branches — a mini-pipeline researches and scripts a new segment with fresh visuals generated mid-conversation.

**Choose a persona.** Three historians with different voices and styles. Each has an AI-generated portrait with canvas-based lip sync driven by audio energy analysis.

## How we built it

### 11-Phase ADK Pipeline

The core is a `SequentialAgent` on Google's Agent Development Kit:

| Phase | Agent | What it does |
|---|---|---|
| I | document_analyzer | Document AI OCR + semantic chunking + narrative curation |
| II | scene_research | ParallelAgent spawns N google_search agents + aggregator |
| III | script_generation | Gemini 2.0 Pro writes narration + visual descriptions |
| IV | narrative_director | Gemini TEXT+IMAGE generates storyboard illustrations |
| V | beat_illustration | Gemini TEXT+IMAGE generates player beat images |
| VI | visual_interleave | Assigns visual_type per beat (illustration/cinematic/video) |
| VII | fact_validator | LLM-judge hallucination firewall |
| VIII | geo_location | Geographic extraction + Google Maps grounding |
| IX | visual_planner | Gemini 2.0 Pro plans visual storyboard per scene |
| X | visual_research | 6-stage historical visual enrichment pipeline |
| XI | visual_director | Imagen 3 (4 frames/segment) + Veo 2 (async video) |

Scene 0 runs a fast path for first playback. Remaining scenes stagger with `asyncio.Semaphore(2)`.

### Gemini's Interleaved TEXT+IMAGE Output

Phases IV–VI use `response_modalities=["TEXT", "IMAGE"]` — Gemini generates both a creative direction note and a storyboard illustration in one call. This is distinct from calling Imagen 3 separately: Gemini reasons about narrative and visual together. Phase XI's Imagen 3 then uses these storyboards as reference for final frames.

### Fact Validation

Phase VII classifies every narration sentence against research evidence: SUPPORTED (keep), UNSUPPORTED SPECIFIC (remove + bridge), UNSUPPORTED PLAUSIBLE (soften), NON-FACTUAL (keep — rhetoric/atmosphere). The script is only overwritten if segment count matches the original.

### Visual Research (6 Stages)

Phase X enriches visual prompts with real historical details before image generation: Google Search grounding discovers sources → classifies them → fetches content (httpx, Wikipedia API, Document AI) → Gemini evaluates for accuracy → merges into a visual detail manifest with era markers, color palettes, and negative prompts. Imagen 3 generates from historically-grounded descriptions, not generic guesses.

### Voice System

Gemini 2.5 Flash Native Audio runs via a Cloud Run WebSocket relay. Browser captures mic at 16kHz PCM through AudioWorkletNode, streams over WebSocket, plays responses at 24kHz. Interruption is server-detected — sub-300ms. Context window compression enables unlimited session length. A retrieval endpoint searches the document's embeddings and injects relevant chunks into Gemini's context before each response.

### Frontend

The frontend signals "cinema, not chatbot":
- **Iris reveal** — CSS `@property`-animated radial-gradient mask for workspace-to-player transition
- **Expedition Log** — Pipeline narrated as a journal with typewriter text, not a spinner
- **Audio-reactive visuals** — AnalyserNode drives Ken Burns speed, glow opacity, vignette spread
- **Living Portrait** — Multi-layer canvas: portrait, audio-driven lip sync, natural blinks, candlelight flicker
- **Ambient color** — Each image's dominant color becomes the player's background glow
- **SSE drip buffer** — Parallel agent events released at 150ms intervals for smooth visual flow

## Challenges we ran into

- **ADK's `google_search` tool can't combine with other tools** — forced single-purpose research agents with ParallelAgent orchestration
- **Veo 2 takes 1-2 minutes per clip** — progressive delivery: Imagen 3 makes segments playable in ~5 seconds, Veo 2 overlays asynchronously
- **11 phases with real-time SSE** — parallel agent events arriving simultaneously needed drip buffering and careful event choreography
- **Gemini TEXT+IMAGE isn't deterministic** — graceful degradation: if no image returned, scene falls back to Imagen 3 in Phase XI
- **First-segment latency** — Scene 0 gets fewer research sources, early exits, and priority scheduling to hit <45s

## Accomplishments that we're proud of

- First segment plays in under 45 seconds from document upload
- The Expedition Log turns loading into the first act of the documentary
- The fact validator catches real hallucinations — unsupported claims get removed or softened automatically
- Sub-300ms voice interruption — you can talk to a documentary mid-sentence and it responds with grounded evidence
- Live illustration during voice conversation via Gemini's non-blocking function calling

## What we learned

- Gemini's interleaved TEXT+IMAGE output produces more coherent storyboards than separate text-then-image pipelines — the model reasons about both simultaneously
- Progressive delivery changes perceived speed — the documentary feels instant even though full generation takes minutes
- ADK's SequentialAgent + ParallelAgent pattern enables genuine multi-stage AI workflows with clean separation
- Audio-reactive visuals create an unconscious bond between voice and imagery that makes the experience feel alive

## What's next for Historia

- **Multi-document cross-referencing** — upload opposing accounts of the same event, the historian presents both perspectives
- **Collaborative viewing** — multiple users watch and steer the same documentary simultaneously
- **Export as video** — render segments into a distributable documentary with captions and credits

## Built With

`google-adk` `google-genai` `gemini-2.5-flash-native-audio` `gemini-2.5-flash-image` `gemini-2.0-flash` `gemini-2.0-pro` `imagen-3` `veo-2` `cloud-run` `firestore` `cloud-storage` `document-ai` `vertex-ai` `pub-sub` `secret-manager` `terraform` `react` `typescript` `vite` `tailwind-css` `motion` `zustand` `web-audio-api` `maplibre` `fastapi` `python` `node.js` `websocket`
