# Software Requirements Specification (SRS)
## AI Historian — Living Documentary Engine

**Version:** 1.0
**Date:** March 7, 2026
**Hackathon:** Gemini Live Agent Challenge
**Document Status:** Draft

---

## 1. Introduction

### 1.1 Purpose
This SRS defines the complete functional and non-functional requirements for the AI Historian system — a real-time multimodal documentary generation platform built on Google Cloud and the Gemini ecosystem.

### 1.2 Scope
AI Historian accepts any historical document (PDF, image), processes it through a multi-agent research pipeline, generates cinematic documentary segments in real time, and enables live voice conversation with an AI historian persona during documentary playback.

### 1.3 Definitions
| Term | Definition |
|---|---|
| Historian Persona | The Gemini Live API-powered AI voice entity that narrates and converses |
| Research Subagent | An ADK-orchestrated agent instance that handles one research thread |
| Documentary Graph | A directed acyclic graph of documentary segments — not a linear script |
| Segment | One standalone documentary unit: script + visuals + narration audio |
| Visual Bible | A style reference document prepended to every image generation prompt |
| VAD | Voice Activity Detection — detects when user is speaking |
| Visual Gap | A document region where source text references something not visually depicted |

---

## 2. Overall System Description

### 2.1 System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENT (React/TS)                         │
│  ┌──────────┐  ┌──────────────┐  ┌────────────────────────────┐ │
│  │ PDF View │  │  Research    │  │   Documentary Player        │ │
│  │ (scroll) │  │  Activity    │  │   (Ken Burns + Veo 2)       │ │
│  └──────────┘  └──────────────┘  └────────────────────────────┘ │
│                        WebSocket (Gemini Live)                   │
└───────────────┬─────────────────────────────────────────────────┘
                │ REST + WebSocket
┌───────────────▼─────────────────────────────────────────────────┐
│                   Cloud Run — Orchestrator API                    │
│                                                                   │
│  ┌─────────────┐   ┌──────────────────┐   ┌──────────────────┐  │
│  │  Scan Agent │   │  ADK Research    │   │  Script +        │  │
│  │  (Flash)    │──▶│  Subagents (x5+) │──▶│  Visual Director │  │
│  └─────────────┘   └──────────────────┘   └──────────────────┘  │
│         │                                         │              │
│         ▼                                         ▼              │
│  ┌─────────────┐                       ┌──────────────────────┐  │
│  │ Document AI │                       │  Imagen 3 / Veo 2    │  │
│  │ (OCR)       │                       │  (Vertex AI)         │  │
│  └─────────────┘                       └──────────────────────┘  │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  Gemini Live API — Persistent WebSocket Session          │    │
│  │  (historian persona, VAD, interruption, multi-turn)      │    │
│  └──────────────────────────────────────────────────────────┘    │
└───────────┬─────────────────────────────┬────────────────────────┘
            │                             │
   ┌────────▼──────┐           ┌──────────▼─────────┐
   │   Firestore   │           │  Cloud Storage GCS  │
   │  (graph state)│           │  (docs, images, mp3)│
   └───────────────┘           └────────────────────┘
            │
   ┌────────▼──────┐
   │   Pub/Sub     │
   │ (async events)│
   └───────────────┘
```

### 2.2 Constraints
- All backend services must be hosted on Google Cloud
- Must use Gemini model (Flash or Pro) for all AI reasoning
- Must use Google GenAI SDK or ADK
- Demo video must be under 4 minutes
- Submission deadline: March 16, 2026

---

## 3. Functional Requirements

### 3.1 Document Ingestion Module

#### FR-1.1 File Upload
- System SHALL accept PDF, PNG, JPG, TIFF files up to 100MB via drag-and-drop
- System SHALL immediately render the uploaded document in the PDF viewer without waiting for processing
- System SHALL display document in an inline scrollable viewer with zoom controls

#### FR-1.2 OCR & Language Detection
- System SHALL send document to Google Document AI for layout-aware OCR
- System SHALL detect document script/language: Arabic, Ottoman Turkish, Latin, Persian, Greek, Hebrew, Cyrillic, Chinese
- System SHALL return confidence score per detected text block (min acceptable: 0.65)
- System SHALL extract: paragraph blocks, margin annotations, headings, dates, named entities

#### FR-1.3 Scan Agent Initialization
- System SHALL spawn a Scan Agent (Gemini 2.0 Flash) upon OCR completion
- Scan Agent SHALL read the full OCR output and produce:
  - Document summary (3–5 sentences)
  - List of named entities (persons, places, events, dates)
  - List of visual gaps (things referenced but not depicted)
  - List of research queries (one per entity/gap, minimum 5)
  - Recommended Visual Bible style (era, region, artistic tradition)
- Scan Agent SHALL complete within 15 seconds

### 3.2 Multi-Agent Research Pipeline

#### FR-2.1 Agent Spawning
- System SHALL spawn N parallel Research Subagents via ADK `ParallelAgent` (N = number of research queries, minimum 5)
- Each subagent is an `Agent` with `tools=[google_search]` (search-only; cannot mix with other tools)
- Each subagent SHALL operate independently — `ParallelAgent` provides no shared state during execution
- Each subagent MUST have a unique `output_key` (e.g., `"research_0"`, `"research_1"`) to write results to session state
- A downstream `SequentialAgent` aggregator reads all `output_key` state values to build the unified Context Store
- System SHALL maintain a research queue for ordered spawning if N > 10

#### FR-2.2 Research Subagent Behavior
Each Research Subagent SHALL:
1. Receive: one research query + document context + Visual Bible
2. Execute Google Search Grounding with the query
3. Evaluate each returned source (accept/reject with reason)
4. Extract key facts from accepted sources (minimum 3 facts)
5. Generate a detailed visual prompt (for Imagen 3/Veo 2) based on facts + Visual Bible
6. Write all steps to Firestore agent log (for UI display)
7. Publish completion event to Pub/Sub

#### FR-2.3 Research Activity UI
- System SHALL stream subagent status updates to client via Server-Sent Events or WebSocket
- Client SHALL display each subagent as a Research Activity item showing: status (queued/searching/done), title, elapsed time
- User SHALL be able to click any research item to open Agent Session Modal
- Agent Session Modal SHALL display all log entries for that agent, animated sequentially if still running

#### FR-2.4 Research Completion
- System SHALL trigger Script Generation when minimum 3 subagents complete (pipeline — does not wait for all)
- System SHALL aggregate all accepted facts into a Context Store per segment

### 3.3 Documentary Generation Pipeline

#### FR-3.1 Script Generation
- Script Agent (Gemini 2.0 Pro) SHALL receive: document summary + enriched context store + Visual Bible
- Script Agent SHALL produce documentary segments, each containing:
  - Segment title
  - Narration script (60–120 seconds when spoken)
  - Visual description (4–6 key frames)
  - Mood/tone tags
  - Source citations
- Script Agent SHALL generate segments in priority order (most central themes first)

#### FR-3.2 Visual Generation
- Visual Director Agent SHALL receive: visual descriptions + Visual Bible style reference
- For standard scenes: Visual Director SHALL call Imagen 3 API with full prompt including Visual Bible prefix
- For dramatic motion scenes: Visual Director SHALL call Veo 2 API (Vertex AI)
- Visual Director SHALL generate 3–5 Imagen 3 images per segment for Ken Burns cycling
- All Imagen 3 prompts SHALL include the Visual Bible as prefix to maintain consistency

#### FR-3.3 Ken Burns Animation
- Client SHALL animate static images using CSS:
  - Random start keyframe (top-left, top-right, center)
  - Slow zoom-in (scale 1.0 → 1.12 over 12s) or zoom-out
  - Simultaneous pan (translateX/Y ±3%)
  - Crossfade between images every 10–15 seconds

#### FR-3.4 Segment Streaming
- System SHALL stream segment readiness to client as each segment completes generation
- Client SHALL display segment cards transitioning from "Generating..." to ready (clickable)
- System SHALL make first segment playable within 45 seconds of document upload

### 3.4 Gemini Live API — Historian Persona

#### FR-4.1 Session Initialization
- System SHALL establish a Gemini Live API WebSocket connection when user enters workspace
- Model: `gemini-2.5-flash-native-audio-preview-12-2025` (Google AI) or `gemini-live-2.5-flash-native-audio` (Vertex AI)
- Connection SHALL persist for the full session duration using context window compression to exceed 15-minute base limit
- First WebSocket message MUST be `BidiGenerateContentSetup` containing:
  - Model ID
  - `generationConfig.responseModalities: ["AUDIO"]`
  - `generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName` (e.g., "Aoede")
  - `systemInstruction` establishing historian persona with document context
  - `realtimeInputConfig.automaticActivityDetection` VAD config
  - `contextWindowCompression.slidingWindow` for long sessions
- System prompt SHALL establish historian persona: name, expertise, speaking style, knowledge of the current document

#### FR-4.2 Narration
- Historian SHALL narrate documentary segments via Gemini Live audio output
- Narration SHALL be streamed audio, not pre-generated TTS
- Historian MAY add impromptu observations beyond the script (encouraged by system prompt)

#### FR-4.3 Voice Activity Detection
- System SHALL enable automatic VAD (`realtimeInputConfig.automaticActivityDetection.disabled: false`)
- VAD sensitivity: `START_SENSITIVITY_HIGH`, `END_SENSITIVITY_HIGH`, `prefixPaddingMs: 20`, `silenceDurationMs: 100`
- System SHALL stream microphone audio as raw 16-bit PCM 16kHz mono in 1024-byte chunks
- System SHALL visualize incoming audio with a waveform animation
- When VAD detects user speech, system SHALL:
  1. Show listening state on voice button (animated ring)
  2. Pause documentary playback if in player (triggered by `interrupted=true` from server)

#### FR-4.4 Interruption Handling
- Interruption is server-detected and server-signaled: when VAD detects user speech mid-narration, server cancels generation
- Server sends `BidiGenerateContentServerContent` with `interrupted: true`
- Client SHALL stop audio playback immediately and clear audio queue on receiving `interrupted: true`
- Any pending function calls are cancelled; server sends `toolCallCancellation` with cancelled call IDs
- System SHALL track narration position at segment level — resumption point stored client-side
- After historian responds to user question, system SHALL offer to continue from pause point

#### FR-4.5 Conversational Q&A
- Historian SHALL answer questions with full document and research context
- Historian SHALL cite sources from the research context when answering
- Historian SHALL ask clarifying questions if user query is ambiguous
- Multi-turn conversation SHALL be supported within the same Live session

### 3.5 Documentary Player

#### FR-5.1 Playback
- Player SHALL display full-screen visual composition (generated images + Ken Burns)
- Player SHALL display synchronized captions with typewriter animation
- Player SHALL show historian audio waveform during narration
- Player SHALL show segment progress in sidebar

#### FR-5.2 Navigation
- User SHALL be able to jump to any completed segment via sidebar
- User SHALL be able to return to workspace from player
- Player SHALL pause/resume with spacebar

#### FR-5.3 Mid-Playback Interaction
- Floating voice button SHALL be visible at all times during playback
- User speaking SHALL trigger FR-4.3 and FR-4.4
- Text input fallback SHALL be available for voice-off environments

### 3.6 Dynamic Documentary Graph

#### FR-6.1 Graph Structure
- Documentary SHALL be represented as a directed graph in Firestore:
  - Nodes: segments (title, script, visuals, audio_url, metadata)
  - Edges: narrative connections (primary flow, alternative branches)
- Initial graph: linear chain of 5–7 segments generated by Script Agent

#### FR-6.2 Branch Generation
- When user asks a question that implies a new topic, system SHALL:
  1. Detect topic divergence (Gemini classifies question intent)
  2. Spawn a Branch Agent to generate a new segment on the topic
  3. Add the new segment as a graph node connected from current position
  4. Present the new segment as "exploring your question" content

#### FR-6.3 Graph Persistence
- Full graph state SHALL be persisted to Firestore after every segment completion
- Session ID SHALL be stable and shareable

---

## 4. Non-Functional Requirements

### 4.1 Performance
| Metric | Requirement |
|---|---|
| First segment ready | < 45 seconds from upload |
| Voice interruption latency | < 300ms (historian stops speaking) |
| Historian response start | < 1.5 seconds from user speech end |
| Research subagent completion | < 30 seconds per agent |
| Image generation (Imagen 3 standard) | ~10 seconds per image |
| Image generation (Imagen 3 fast) | ~5 seconds per image |
| Video generation (Veo 2) | 1–2 minutes per clip (async) |
| WebSocket reconnect | < 3 seconds |

### 4.2 Reliability
- System SHALL handle Cloud Run cold starts without user-visible errors
- System SHALL retry failed Imagen 3 / Veo 2 calls up to 3 times with exponential backoff
- System SHALL queue Pub/Sub messages with at-least-once delivery
- Firestore writes SHALL be transactional for graph state updates

### 4.3 Scalability
- Architecture SHALL support up to 50 concurrent documentary sessions
- ADK SHALL scale research subagent pools per session independently
- Cloud Run SHALL auto-scale to 10 instances minimum

### 4.4 Security
- All uploaded documents SHALL be stored in GCS with session-scoped access only
- No document content SHALL be logged to Cloud Logging
- API keys (Gemini, Vertex AI) SHALL be stored in Secret Manager
- CORS SHALL be restricted to the application domain

### 4.5 Usability
- First meaningful interaction SHALL be achievable without any tutorial
- PDF viewer SHALL be immediately usable on document load (zero wait)
- Voice interaction SHALL work without configuration on Chrome (WebRTC)

---

## 5. External Interface Requirements

### 5.1 Gemini Live API
- Protocol: WebSocket (wss://)
- **Model ID (Google AI):** `gemini-2.5-flash-native-audio-preview-12-2025`
  - ⚠️ `gemini-2.0-flash-live-001` was SHUT DOWN Dec 9, 2025 — do not use
- **Model ID (Vertex AI GA):** `gemini-live-2.5-flash-native-audio`
- **WebSocket endpoint (Google AI):**
  `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent`
- **First message** after WebSocket handshake MUST be `BidiGenerateContentSetup`; server replies `setupComplete` before any content exchange
- **VAD config** (in `realtimeInputConfig.automaticActivityDetection`):
  - `startOfSpeechSensitivity`: `START_SENSITIVITY_HIGH`
  - `endOfSpeechSensitivity`: `END_SENSITIVITY_HIGH`
  - `prefixPaddingMs`: 20
  - `silenceDurationMs`: 100
- **Audio format:**
  - Input: 16-bit PCM, 16,000 Hz, mono (`audio/pcm;rate=16000`)
  - Output: 16-bit PCM, 24,000 Hz, mono (`audio/pcm;rate=24000`)
  - Chunk size: 1024 bytes
- **Interruption protocol:** Server-detected, server-signaled. When VAD detects user speech mid-generation, server cancels generation and sends `serverContent.interrupted=true`. Client MUST stop audio playback and clear buffer. Any pending tool calls get a `toolCallCancellation` message.
- **Turn taking:** `turnComplete: true` on `BidiGenerateContentClientContent` triggers model response. Server sends `generationComplete: true` when done.
- **System instruction:** Set in `BidiGenerateContentSetup.systemInstruction.parts[].text` — persists for full session; cannot change mid-session without reconnecting
- **Voice names:** Puck (default), Charon, Kore, Fenrir, Aoede, Leda, Orus, Zephyr
- **Session duration:** 15 min (audio-only) without compression; unlimited with `contextWindowCompression.slidingWindow`
- **Session resumption:** Server sends `goAway` before disconnect; client reconnects with resumption token (valid 2 hours)
- **Concurrent sessions (Vertex AI):** up to 1,000 per project
- **SDK:** `client.aio.live.connect(model=MODEL, config=CONFIG)` — Python async context manager

### 5.2 ADK (Agent Development Kit)
- **Package:** `google-adk` — install: `pip install google-adk`
- **Core agent class:** `from google.adk.agents import Agent` (alias for `LlmAgent`)
- **Orchestration classes:**
  - `from google.adk.agents.sequential_agent import SequentialAgent` — pipeline (Scan → Script → Visual Director)
  - `from google.adk.agents.parallel_agent import ParallelAgent` — concurrent research subagents
  - `from google.adk.agents.loop_agent import LoopAgent` — retry/enrichment loops
- **Google Search tool:** `from google.adk.tools import google_search`
  - ⚠️ CRITICAL: `google_search` CANNOT be combined with other tools in the same agent's `tools` list — search agents must be standalone
  - Requires Gemini 2+ models
- **Agent result sharing:** Set `output_key="state_key_name"` on each agent → response auto-saved to `session.state`. Downstream agents read via `{state_key_name}` template in their `instruction` string
- **ParallelAgent pattern:** Each subagent runs independently (no shared state during execution). Each writes to its own `output_key`. A downstream `SequentialAgent` aggregator reads all keys.
- **Streaming to frontend:** ADK API server exposes `/run_sse` endpoint (Server-Sent Events). Call with `"streaming": true` for token-level streaming of agent progress.
- **Cloud Run deployment:** `adk deploy cloud_run --project=... --region=... --service_name=... agents/`
  - Exposes `/run`, `/run_sse`, and dev UI (with `--with_ui` flag)
- **Agent instructions support dynamic state:** `instruction="Analyze this document: {document_summary}"` — `{document_summary}` resolved from `session.state` at runtime
- **Runner API:**
  ```python
  from google.adk.runners import InMemoryRunner
  from google.adk.apps import App
  app = App(name="historian", root_agent=root_agent)
  runner = InMemoryRunner(app=app)
  async for event in runner.run_async(user_id, session_id, new_message):
      if event.is_final_response(): ...
  ```

### 5.3 Imagen 3 API (Vertex AI)
- Model: `imagen-3.0-generate-002` (GA) or `imagen-3.0-fast-generate-001` for speed
- Endpoint: `POST https://{REGION}-aiplatform.googleapis.com/v1/projects/{PROJECT}/locations/{REGION}/publishers/google/models/imagen-3.0-generate-002:predict`
- Parameters: `aspectRatio="16:9"`, `sampleCount=1–4`, `personGeneration="dont_allow"`, `addWatermark=false` (to enable seed), `seed` for determinism
- Output: base64-encoded PNG returned in response, or written to GCS if `storageUri` set
- Rate limit: 20 req/min (standard), 200 req/min (fast variant)
- Realistic latency: ~10s/image (standard), ~5s/image (fast)
- All prompts prefixed with Visual Bible (style, era, palette, composition rules)
- SDK: `google-genai` Python package — `client.models.generate_images(...)`

### 5.4 Veo 2 API (Vertex AI)
- Model: `veo-2.0-generate-001` (GA — no waitlist required)
- Endpoint: `:predictLongRunning` (async job, NOT synchronous `:predict`)
- Input: text prompt required; optional image for start-frame or style reference (base64 or GCS URI)
- Output: async operation — poll until done; result is MP4 in GCS (`storageUri` required) or base64
- Video specs: 5–8 seconds (`durationSeconds`), 720p, 24 FPS, aspect ratios: `16:9` / `9:16`
- Rate limit: 10 req/min per region
- Realistic latency: 1–2 minutes per video clip (budget 2 minutes for SRS planning)
- Note: audio generation NOT supported in Veo 2 (Veo 3+ only)
- SDK: `client.models.generate_videos(...)` with polling loop

### 5.5 Google Document AI
- Processor type: `OCR_PROCESSOR` (Enterprise Document OCR — 200+ languages, printed + handwritten)
- Input: PDF or image bytes (base64 in `RawDocument.content`), MIME type required
- Output: `document.text` (full text), `document.pages[].tokens[]` (word-level boxes), `pages[].paragraphs[]`, `pages[].detected_languages[]` with confidence scores
- Ottoman Turkish note: NOT explicitly listed as a language; use Arabic (`ar`) language hint for Arabic-script Ottoman texts + `enable_symbol=True` for character-level output for post-processing
- Arabic support: `ar` (printed only — no handwriting support in Document AI)
- Modern Turkish (`tr`): full support including handwriting
- SDK: `google-cloud-documentai` — `DocumentProcessorServiceClient`

### 5.6 Firestore Schema

```
/sessions/{sessionId}
  - documentUrl: string (GCS path)
  - language: string
  - visualBible: string
  - createdAt: timestamp
  - status: "processing" | "ready" | "playing"

/sessions/{sessionId}/agents/{agentId}
  - query: string
  - status: "queued" | "searching" | "done"
  - logs: array<{step: string, ts: timestamp, data: any}>
  - facts: array<string>
  - visualPrompt: string

/sessions/{sessionId}/segments/{segmentId}
  - title: string
  - script: string
  - imageUrls: array<string>
  - videoUrl: string (optional, Veo 2)
  - audioUrl: string
  - sources: array<{url, title, accepted}>
  - graphEdges: array<string> (next segment IDs)
  - createdAt: timestamp
```

### 5.7 Pub/Sub Topics
| Topic | Publisher | Subscriber | Payload |
|---|---|---|---|
| `document-uploaded` | API | Scan Agent | `{sessionId, gcsPath}` |
| `scan-complete` | Scan Agent | Research Orchestrator | `{sessionId, queries[]}` |
| `research-complete` | Research Subagent | Script Agent trigger | `{sessionId, agentId}` |
| `segment-ready` | Script+Visual Pipeline | Client SSE relay | `{sessionId, segmentId}` |

---

## 6. System Deployment

### 6.1 Cloud Run Services
| Service | Runtime | Memory | CPU |
|---|---|---|---|
| `historian-api` | Python 3.12 | 2Gi | 2 |
| `agent-orchestrator` | Python 3.12 | 4Gi | 4 |
| `live-relay` | Node.js 20 | 1Gi | 1 |

### 6.2 Infrastructure as Code
- ADK agent service deployed via: `adk deploy cloud_run --project=PROJECT --region=us-central1 --service_name=historian-agents agents/`
- Remaining services (Firestore, GCS, Pub/Sub, Secret Manager) deployed via Terraform (`terraform/main.tf`)
- Cloud Run services defined as `google_cloud_run_v2_service` resources
- Firestore database and GCS bucket provisioned in same Terraform plan
- Secret Manager secrets referenced via `google_secret_manager_secret_version`
- Terraform + ADK deploy script = qualifies for **+0.2 bonus points** on automated deployment

### 6.3 CI/CD
- GitHub Actions on push to `main`:
  1. Run linting + unit tests
  2. Build Docker images
  3. Push to Artifact Registry
  4. Deploy to Cloud Run via `gcloud run deploy`

---

## 7. Acceptance Criteria

### MVP (Hackathon Submission)
- [ ] Document upload renders PDF immediately
- [ ] 5+ research subagents spawn and complete in parallel
- [ ] Agent session modal shows live log
- [ ] At least 3 documentary segments generate and are playable
- [ ] Gemini Live API session established with historian persona
- [ ] Voice button triggers listening and historian responds
- [ ] Mid-playback interruption works (historian stops, answers, resumes)
- [ ] All services deployed on Cloud Run
- [ ] Architecture diagram produced
- [ ] Demo video recorded (< 4 minutes)

### Stretch Goals
- [ ] Veo 2 integration for at least one scene
- [ ] Dynamic documentary graph with branch generation on user questions
- [ ] Session sharing via URL
- [ ] Terraform IaC deployment
