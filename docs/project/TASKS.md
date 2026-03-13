# AI Historian — Team Task Distribution

**Berkay** → Live Voice Layer & Real-Time Interaction
**Efe** → Research Pipeline, Agent Visualization & Documentary Engine

---

## BERKAY — Live Voice & Historian Persona

### B1 · `live-relay` Cloud Run Service
Build the Node.js WebSocket relay service that sits between the browser and Gemini Live API.
- Accept WebSocket connections from browser clients
- Forward raw audio chunks to Gemini Live API session
- Forward model audio responses back to the browser
- Handle session lifecycle: connect → setup message → bidirectional stream → goAway → reconnect
- Expose a single WebSocket endpoint: `wss://live-relay-xxx.run.app/session/{sessionId}`

### B2 · Gemini Live API Session Setup
```
Model: gemini-2.5-flash-native-audio-preview-12-2025 (Google AI)
       gemini-live-2.5-flash-native-audio             (Vertex AI GA)
```
The very first message after WebSocket handshake MUST be `BidiGenerateContentSetup`:
```json
{
  "setup": {
    "model": "gemini-2.5-flash-native-audio-preview-12-2025",
    "generationConfig": {
      "responseModalities": ["AUDIO"],
      "speechConfig": {
        "voiceConfig": {
          "prebuiltVoiceConfig": { "voiceName": "Aoede" }
        }
      }
    },
    "systemInstruction": { "parts": [{ "text": "..." }] },
    "realtimeInputConfig": {
      "automaticActivityDetection": {
        "startOfSpeechSensitivity": "START_SENSITIVITY_HIGH",
        "endOfSpeechSensitivity": "END_SENSITIVITY_HIGH",
        "prefixPaddingMs": 20,
        "silenceDurationMs": 100
      }
    },
    "contextWindowCompression": {
      "slidingWindow": { "triggerTokens": 1000 }
    }
  }
}
```
- Server replies `setupComplete` — no content exchange before this arrives
- Store session ID in Firestore `/sessions/{id}/liveSession`

### B3 · Browser Audio Capture Pipeline
Mic → PCM encoding → WebSocket send:
```
getUserMedia({ audio: true })
  → AudioContext (sampleRate: 16000)
  → AudioWorkletNode (or ScriptProcessorNode fallback)
  → Float32 → Int16Array conversion (16-bit PCM, mono)
  → chunk every 1024 bytes
  → send as binary frame over WebSocket
```
- Use `AudioWorklet` as primary (ScriptProcessor is deprecated)
- Do not apply noise suppression or echo cancellation — Gemini handles this
- Visualize input with `AnalyserNode` → `getByteTimeDomainData()` → canvas waveform

### B4 · Audio Playback Pipeline
Receive PCM 24kHz from server → smooth continuous playback:
```
WebSocket binary frame (PCM, 24000 Hz, 16-bit, mono)
  → ArrayBuffer
  → Int16Array → Float32Array (divide by 32768)
  → AudioBuffer (AudioContext at 24000 Hz)
  → schedule via AudioBufferSourceNode.start(nextPlayTime)
  → nextPlayTime += buffer.duration
```
- Queue-based scheduling: each chunk starts exactly where the last one ended
- Keep a `playbackQueue` array — drain it on interruption
- Track `currentSegmentId` and approximate `playbackOffset` for resumption offer

### B5 · Interruption Handling (Client-Side)
When `serverContent.interrupted === true` arrives from the server:
1. Call `.stop()` on all scheduled `AudioBufferSourceNode` instances immediately
2. Clear the `playbackQueue` array
3. Transition voice button to `listening` state
4. Store `{ segmentId, offset }` to Firestore for potential resumption
5. After historian finishes responding (`generationComplete: true`) → show toast: "Continue from where we left off?"

### B6 · Voice Button State Machine
Five states, each with distinct visual treatment:

| State | Trigger | Visual |
|---|---|---|
| `idle` | default | static mic icon, subtle gold border |
| `listening` | VAD detects speech / user clicks | pulsing ring animation, "Listening..." label |
| `processing` | user speech ends, waiting for response | spinner on button |
| `historian_speaking` | server audio starts playing | waveform ring animation |
| `interrupted` | `interrupted=true` from server | flash transition → listening |

- Button always visible (fixed position) in workspace and documentary player
- In documentary player: pause Ken Burns animation when `listening` or `processing`

### B7 · Historian Persona System Prompt
Craft the character injected into `BidiGenerateContentSetup.systemInstruction`:
- Name the historian (e.g., "Professor Selim Efendi") — a character with era-specific expertise
- Define speaking style: formal but captivating, like a BBC documentary narrator
- Instruct them to reference the uploaded document naturally mid-conversation
- Instruct them to cite research sources when answering questions
- Instruct them to resume narration gracefully after answering an interruption
- Instruct them to ask clarifying questions if a user question is ambiguous
- Keep total prompt under 500 tokens — it loads on every session
- The prompt receives `{document_summary}` and `{visual_bible}` injected from session state at runtime

### B8 · Session Resumption & Reconnection
- Listen for `sessionResumptionUpdate` messages from the server → extract `handle` token → store in Firestore `/sessions/{id}/resumptionToken`
- On receiving `goAway` (with `timeLeft`): log warning, prepare to reconnect
- On disconnect: attempt reconnect using stored token (valid 2 hours after session end)
- If token expired: create a new session and re-inject document context from Firestore
- Max 3 automatic reconnect attempts with exponential backoff (1s, 3s, 9s)
- After 3 failures: show user error with "Reconnect" button

---

## EFE — Research Pipeline, Agents & Documentary Engine

### E1 · Document Upload UI + GCS Storage
- Drag-and-drop upload zone (accepts PDF, PNG, JPG, TIFF, max 100MB)
- Backend generates a GCS signed URL (`PUT`, 10-minute expiry) → browser uploads directly to GCS (no proxy through server)
- On upload complete: `POST /api/session/create` → creates Firestore session document:
  ```json
  {
    "sessionId": "uuid",
    "gcsPath": "gs://historian-docs/{sessionId}/document.pdf",
    "status": "processing",
    "createdAt": "timestamp"
  }
  ```
- Immediately render PDF in viewer — user can read while AI works

### E2 · PDF Viewer
- Use `pdf.js` (`pdfjs-dist` npm package) to render GCS document URL inline
- Scrollable, page-by-page with zoom controls
- After Scan Agent completes: highlight detected entity terms in the PDF (persons, places, dates) using `pdf.js` text layer
- The viewer is always the left panel — never replaced or hidden during research

### E3 · Document AI OCR Integration
```python
from google.cloud import documentai_v1

processor_id = "OCR_PROCESSOR"  # created in Cloud Console

process_options = documentai_v1.ProcessOptions(
    ocr_config=documentai_v1.OcrConfig(
        enable_native_pdf_parsing=True,
        enable_image_quality_scores=True,
        enable_symbol=True,  # character-level — needed for Ottoman post-processing
    )
)
```
- Use `language_hints=["ar"]` for Arabic-script Ottoman documents
- Parse response: `document.text` (full text) + `pages[].detected_languages[]` (with confidence)
- Save OCR output to Firestore `/sessions/{id}/ocr` → `{ text, languages, pageCount }`
- Publish `document-scanned` to Pub/Sub to trigger Scan Agent

### E4 · Scan Agent (ADK)
```python
from google.adk.agents import Agent

scan_agent = Agent(
    name="scan_agent",
    model="gemini-2.0-flash",
    instruction="""
    You receive an OCR'd historical document text.
    Produce a JSON object with:
    {
      "summary": "3-5 sentence document summary",
      "entities": ["person/place/event/date list"],
      "visual_gaps": ["things referenced but not depicted"],
      "research_queries": ["one targeted query per entity/gap, minimum 5"],
      "visual_bible": "style reference for Imagen 3 prompts: era, region, palette, composition rules"
    }
    """,
    output_key="scan_result"
)
```
- Input: OCR text from Firestore
- Output: JSON saved to `session.state["scan_result"]`
- On completion: parse `research_queries` → spawn Research Pipeline

### E5 · Research Pipeline (ADK ParallelAgent)
```python
from google.adk.agents.parallel_agent import ParallelAgent
from google.adk.tools import google_search

# One Agent per query — google_search CANNOT be combined with other tools
research_agents = [
    Agent(
        name=f"researcher_{i}",
        model="gemini-2.0-flash",
        instruction="""
        Research query: {query_{i}}
        Document context: {document_summary}
        Visual Bible style: {visual_bible}

        1. Search the web for this query
        2. Evaluate each result: accept or reject with a one-line reason
        3. From accepted sources, extract minimum 3 key historical facts
        4. Build a detailed Imagen 3 visual prompt:
           - Start with the Visual Bible style prefix
           - Describe scene: setting, lighting, figures, mood
           - 16:9 composition, no anachronisms
        Output as JSON: { sources, accepted_sources, rejected_sources, facts, visual_prompt }
        """,
        tools=[google_search],
        output_key=f"research_{i}"
    )
    for i in range(num_queries)
]

parallel_research = ParallelAgent(
    name="parallel_research",
    sub_agents=research_agents
)
```
- Write each step to Firestore `/sessions/{id}/agents/{agentId}/logs` as it happens (for the Agent Session Modal)
- Publish `research-{i}-complete` to Pub/Sub after each subagent finishes
- Trigger Script Agent once minimum 3 subagents are done (pipeline — don't wait for all)

### E6 · Research Activity Panel (Frontend)
- Subscribe to SSE stream (`GET /session/{id}/stream`)
- For each research agent event received, show a status card:
  - **queued** → greyed out, clock icon
  - **searching** → animated pulse, "Searching: [query title]", elapsed timer
  - **done** → green checkmark, elapsed time shown
- Stagger initial card appearance (50ms delay per card) for visual progression
- Each card: click → opens Agent Session Modal (E7)

### E7 · Agent Session Modal
Click any research activity card → open a modal popup:
- Header: agent query title + final status
- Log entries displayed one by one:
  ```
  → Search initiated: "Ottoman palace architecture 17th century"
  → Source fetched: [url] — ACCEPTED (highly relevant primary source)
  → Source fetched: [url] — REJECTED (modern article, anachronistic context)
  → Key fact: "The Topkapı Palace expanded in 1665 under Sultan Mehmed IV"
  → Key fact: "Central courtyard design influenced by Persian iwan tradition"
  → Key fact: "Palace employed over 4,000 staff at peak"
  → Visual prompt built: "Aerial view of Ottoman palace courtyard, 17th century..."
  → Done ✓
  ```
- If agent is **still running**: entries appear with typewriter animation, live pace
- If agent is **done**: entries replay fast (150ms per entry) for review mode

### E8 · Script Generation Agent (ADK)
```python
from google.adk.agents import Agent

script_agent = Agent(
    name="script_agent",
    model="gemini-2.0-pro",
    instruction="""
    You receive enriched research context about a historical document.
    Context from research agents: {research_0}, {research_1}, {research_2}, ...

    Generate 5-7 documentary segments as a JSON array. Each segment:
    {
      "id": "segment_N",
      "title": "Segment title",
      "narration_script": "Full narration text, 60-120 seconds when spoken aloud",
      "visual_descriptions": [
        "Frame 1: detailed Imagen 3 prompt (starts with Visual Bible prefix)",
        "Frame 2: ...",
        "Frame 3: ...",
        "Frame 4: ..."
      ],
      "veo2_scene": "Optional: one dramatic scene description for Veo 2 video generation",
      "mood": "cinematic | reflective | dramatic | scholarly",
      "sources": ["citation 1", "citation 2"]
    }

    Order segments from broad historical context → specific document content → legacy/impact.
    """,
    output_key="segments"
)
```

### E9 · Visual Director Agent (Imagen 3 + Veo 2)
For each segment from `session.state["segments"]`:

**Imagen 3 (4 images per segment):**
```python
from google import genai
from google.genai.types import GenerateImagesConfig

response = client.models.generate_images(
    model="imagen-3.0-fast-generate-001",  # 200 req/min limit
    prompt=f"{visual_bible_prefix}\n\n{visual_description}",
    config=GenerateImagesConfig(
        number_of_images=4,
        aspect_ratio="16:9",
        person_generation="dont_allow",
        safety_filter_level="block_medium_and_above",
    )
)
# Save base64 → GCS, store URLs in Firestore segment
```

**Veo 2 (1 video for key dramatic scenes, async):**
```python
operation = client.models.generate_videos(
    model="veo-2.0-generate-001",
    prompt=f"{visual_bible_prefix}\n\n{segment['veo2_scene']}",
    config=GenerateVideosConfig(
        aspect_ratio="16:9",
        duration_seconds=8,
        output_gcs_uri=f"gs://historian-assets/{sessionId}/{segmentId}/video.mp4"
    )
)
# Poll every 15s — budget 2 minutes per video
# Veo 2 rate limit: 10 req/min — process videos serially
```

Save to Firestore `/sessions/{id}/segments/{segmentId}`:
```json
{
  "imageUrls": ["gs://...", "gs://...", "gs://...", "gs://..."],
  "videoUrl": "gs://... (optional)",
  "script": "...",
  "mood": "cinematic",
  "sources": [...]
}
```

### E10 · Segment Cards (Streaming Status)
- Listen to SSE stream for `segment-ready` events
- Each segment card starts as "Generating..." with a shimmer pulse animation
- On `segment-ready` event: flip card to ready state with title, mood tag, duration estimate
- Ready cards are clickable → launch documentary player at that segment
- First segment must be playable within 45 seconds of upload

### E11 · Documentary Player
Full-screen cinematic player — always dark regardless of app theme:

**Ken Burns effect (CSS):**
```css
@keyframes kenburns-1 {
  from { transform: scale(1.0) translate(0%, 0%); }
  to   { transform: scale(1.12) translate(-2%, -1%); }
}
/* Cycle through 4 images, 12s each, crossfade at 10s */
```
- 4 Imagen 3 images rotate with random start positions (top-left, top-right, center)
- Crossfade transition between images: `opacity` 1→0 / 0→1 over 2 seconds
- If `videoUrl` exists for segment: swap to `<video autoplay muted loop>` for that scene

**Captions:**
- Typewriter animation synced to estimated narration timing
- Word-by-word or line-by-line reveal

**Sidebar:**
- Segment list with titles
- Historian name + current speaking indicator (animated dot)
- Click segment → jump to it (send new narration instruction to Berkay's voice layer)

**On `listening` state from Berkay's voice button:**
- Pause Ken Burns animation (`animation-play-state: paused`)
- Darken overlay slightly
- Show subtle "Historian is listening..." indicator
- Resume animation when `historian_speaking` state resumes

### E12 · `agent-orchestrator` Cloud Run Service
Python 3.12 FastAPI app deployed via `adk deploy cloud_run`:
```
POST   /api/session/create          → creates Firestore session, returns signed GCS URL
POST   /api/session/{id}/process    → triggers Scan → Research → Script → Visual pipeline
GET    /api/session/{id}/stream     → SSE stream of agent events and segment readiness
GET    /api/session/{id}/status     → current session state snapshot
GET    /api/session/{id}/agent/{agentId}/logs → full agent log for modal
```

---

## SHARED — Both Together

### S1 · Firestore Schema Implementation
**Berkay owns:**
- `/sessions/{id}` root document (status, gcsPath, language, visualBible)
- `/sessions/{id}/liveSession` (resumptionToken, voiceState, lastConnectedAt)

**Efe owns:**
- `/sessions/{id}/agents/{agentId}` (query, status, logs[], facts[], visualPrompt)
- `/sessions/{id}/segments/{segmentId}` (script, imageUrls[], videoUrl, mood, sources[])

### S2 · Pub/Sub Topics
**Both set up, Efe implements publishers, Berkay subscribes where needed:**

| Topic | Publisher | Subscriber |
|---|---|---|
| `document-scanned` | Efe (E3) | Efe (E4 Scan Agent) |
| `scan-complete` | Efe (E4) | Efe (E5 Research Pipeline) |
| `research-{n}-complete` | Efe (E5) | Efe (E8 Script Agent trigger) |
| `segment-ready` | Efe (E9) | Efe (E10 frontend SSE relay) |
| `session-ended` | Berkay (B8) | Efe (cleanup) |

### S3 · Terraform IaC (`terraform/main.tf`) — qualifies for +0.2 bonus
**Berkay provisions:**
- `live-relay` Cloud Run service (`google_cloud_run_v2_service`)
- Secret Manager secret for Gemini API key (`google_secret_manager_secret`)

**Efe provisions:**
- `agent-orchestrator` Cloud Run service
- `historian-api` API gateway Cloud Run service
- Firestore database (`google_firestore_database`)
- GCS buckets: `historian-docs` (uploads) + `historian-assets` (generated images/videos)
- Pub/Sub topics and subscriptions (`google_pubsub_topic`, `google_pubsub_subscription`)

### S4 · Architecture Diagram (required submission artifact)
Use Mermaid or Excalidraw. Must clearly show:
- Browser → `live-relay` → Gemini Live API (Berkay's domain)
- Browser → `historian-api` → `agent-orchestrator` → ADK Agents → Imagen 3 / Veo 2 → GCS (Efe's domain)
- Shared: Firestore, Pub/Sub, Document AI

### S5 · Blog Posts on Medium (+0.6 bonus — largest single bonus)
Write during development, not after. Two posts:
- **Berkay writes:** "Building real-time voice interruption with Gemini Live API" — cover B2–B5, share code snippets, explain the PCM pipeline and interruption protocol
- **Efe writes:** "Orchestrating 10 parallel AI research agents with ADK" — cover E4–E8, share the ParallelAgent pattern, explain the `output_key` state sharing approach
- Both posts: include `#GeminiLiveAgentChallenge` hashtag and disclosure: *"This project was built for the Gemini Live Agent Challenge"*

### S6 · README (required submission artifact)
Must include:
- What the project does (2–3 sentences)
- Embedded architecture diagram
- Prerequisites: Google Cloud project, billing enabled, API keys (Gemini, Vertex AI)
- Setup steps:
  1. `pip install google-adk google-genai google-cloud-documentai`
  2. Set env vars (`GOOGLE_API_KEY`, `GOOGLE_CLOUD_PROJECT`, `GCS_BUCKET`)
  3. `cd terraform && terraform init && terraform apply`
  4. `adk deploy cloud_run --project=... --service_name=historian-agents agents/`
  5. `cd frontend && pnpm install && pnpm dev`

### S7 · Demo Video (4 minutes max — required submission artifact)
Follow the script in `docs/spec/PRD.md §10`. Record together. Show only real working software — no mockups or slides in the demo portion. Captions/subtitles required if any non-English speech.

### S8 · Google Developer Group Membership (+0.2 bonus)
Both Berkay and Efe join GDG. Include both public profile links in the Devpost submission form.
