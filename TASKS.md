# AI Historian — Team Task Distribution

**Deadline:** March 16, 2026 @ 5:00 PM PDT (9 days)
**Berkay** → Live Voice Layer & Real-Time Interaction
**Efe** → Research Pipeline, Agent Visualization & Documentary Engine

---

## BERKAY — Live Voice & Historian Persona

Everything that touches the real-time audio connection, voice experience, and Gemini Live API session.

### B1 · `live-relay` Cloud Run Service
Build the Node.js WebSocket relay service that sits between the browser and Gemini Live API.
- Accept WebSocket connections from browser clients
- Forward audio chunks to Gemini Live API session
- Forward model audio responses back to browser
- Handle session lifecycle: connect → setup → stream → goAway → reconnect

### B2 · Gemini Live API Session Setup
```
Model: gemini-2.5-flash-native-audio-preview-12-2025 (Google AI)
      gemini-live-2.5-flash-native-audio (Vertex AI)
```
- Send `BidiGenerateContentSetup` as the FIRST message after WebSocket handshake
- Configure: `responseModalities: ["AUDIO"]`, voice name (`Aoede` recommended for historian feel)
- Set `contextWindowCompression.slidingWindow` to allow sessions beyond 15 minutes
- Store resumption token from `sessionResumptionUpdate` messages in Firestore

### B3 · Browser Audio Capture Pipeline
Raw mic → PCM encoding → WebSocket send
```
getUserMedia({ audio: true })
  → AudioContext (16,000 Hz)
  → ScriptProcessorNode or AudioWorklet
  → Int16Array (16-bit PCM, mono)
  → chunk at 1024 bytes
  → send via WebSocket
```
- Show waveform animation using `AnalyserNode` during user speech
- Stop sending on VAD silence (server handles this — but mute the stream for UX)

### B4 · Audio Playback Pipeline
Receive PCM from server → decode → smooth playback
```
WebSocket message (audio/pcm;rate=24000)
  → ArrayBuffer
  → AudioContext.decodeAudioData or manual Float32 conversion
  → AudioBufferSourceNode queue
  → auto-play with crossfade between chunks
```
- Queue-based playback so chunks play seamlessly end-to-end
- Track playback position for resumption after interruption

### B5 · Interruption Handling (Client-Side)
When server sends `serverContent.interrupted = true`:
1. **Immediately** stop all queued audio (cancel all AudioBufferSourceNodes)
2. Clear the playback queue
3. Switch voice button to "listening" state
4. Store current segment ID + approximate playback time for resumption
5. After historian responds → offer "continue from where we left off" prompt

### B6 · Voice Button State Machine
```
idle → [user clicks / VAD triggers] → listening
listening → [VAD silence / server interrupted=true] → processing
processing → [server starts sending audio] → historian_speaking
historian_speaking → [generationComplete=true] → idle
historian_speaking → [user speaks] → listening (interruption)
```
- Animate the floating voice button at each state
- Show waveform ring animation during `historian_speaking`
- Show pulsing ring during `listening`

### B7 · Historian Persona System Prompt
Design the character injected into `BidiGenerateContentSetup.systemInstruction`:
- Give the historian a name, era expertise, speaking style (formal but engaging)
- Instruct them to reference the uploaded document naturally
- Instruct them to cite sources when answering questions
- Instruct them to pause narration gracefully when interrupted
- Keep the prompt under 500 tokens (it's injected into every session)

### B8 · Session Resumption
- On receiving `goAway` from server: extract `timeLeft`, log warning
- On disconnect: attempt reconnect with stored resumption token (valid 2 hours)
- If token expired: create new session but restore document context from Firestore
- Max 3 reconnect attempts before showing user error

---

## EFE — Research Pipeline, Agents & Documentary Engine

Everything that touches document processing, multi-agent research, visual generation, and the documentary player.

### E1 · Document Upload UI + GCS
- Drag-and-drop zone (supports PDF, PNG, JPG, TIFF)
- Upload directly to GCS via signed URL (backend generates signed URL, browser uploads)
- Create Firestore session document on upload: `{ sessionId, gcsPath, status: "processing", createdAt }`
- Show PDF immediately in viewer as soon as upload completes (zero waiting UX)

### E2 · PDF Viewer
- Use `pdf.js` to render GCS document URL inline
- Scrollable, zoomable
- Highlighted entity terms (populated after Scan Agent completes)
- Show as soon as document is uploaded — user reads while AI researches

### E3 · Document AI OCR Integration
```python
processor_type = "OCR_PROCESSOR"
language_hint = "ar"  # for Ottoman/Arabic script documents
enable_symbol = True  # character-level for Ottoman post-processing
```
- Send document bytes to Document AI
- Parse `document.text` + `pages[].detected_languages[]`
- Extract entity candidates from text (persons, places, dates, events)
- Save OCR output to Firestore session

### E4 · Scan Agent (ADK)
```python
from google.adk.agents import Agent

scan_agent = Agent(
    name="scan_agent",
    model="gemini-2.0-flash",
    instruction="""
    You receive an OCR'd historical document. Produce:
    1. Document summary (3-5 sentences)
    2. Named entities list (persons, places, events, dates)
    3. Visual gaps list (things referenced but not depicted visually)
    4. Research queries list (one per entity/gap, minimum 5)
    5. Visual Bible style (era, region, artistic tradition for Imagen prompts)
    Output as JSON.
    """,
    output_key="scan_result"
)
```
- Takes OCR text as input
- Outputs structured JSON to session state
- Triggers research pipeline via Pub/Sub on completion

### E5 · Research Pipeline (ADK ParallelAgent)
```python
from google.adk.agents.parallel_agent import ParallelAgent
from google.adk.tools import google_search

# Create one Agent per research query — each standalone (google_search only)
research_agents = [
    Agent(
        name=f"researcher_{i}",
        model="gemini-2.0-flash",
        instruction=f"""
        Research query: {{{query_key}}}
        Document context: {{document_summary}}
        Visual Bible: {{visual_bible}}

        Steps:
        1. Search the web for this query
        2. Evaluate each source (accept/reject with reason)
        3. Extract 3+ key facts from accepted sources
        4. Generate an Imagen 3 visual prompt using Visual Bible style
        Output as JSON with: sources, facts, visual_prompt
        """,
        tools=[google_search],
        output_key=f"research_{i}"
    )
    for i, query_key in enumerate(query_keys)
]

parallel_research = ParallelAgent(
    name="parallel_research",
    sub_agents=research_agents
)
```
- Write every step to Firestore agent log (for Agent Session Modal)
- Publish `research-complete` to Pub/Sub when each subagent finishes

### E6 · Research Activity Panel (Frontend)
- Subscribe to SSE stream from `/run_sse`
- For each research agent: show status card (queued → searching → done)
- Animate status transitions with staggered timing
- Show elapsed time per agent
- Each card clickable → opens Agent Session Modal

### E7 · Agent Session Modal
On click of any research activity item:
- Fetch full agent log from Firestore `/sessions/{id}/agents/{agentId}/logs`
- Display log entries one by one with animation:
  - "Search initiated: [query]"
  - "Source fetched: [url] → accepted/rejected"
  - "Key facts extracted: ..."
  - "Visual prompt built"
  - "Done"
- If agent is still running: animate each entry as it arrives (slow, live)
- If agent is done: replay all entries fast (review mode)

### E8 · Script Generation Agent
```python
script_agent = Agent(
    name="script_agent",
    model="gemini-2.0-pro",  # Pro for complex reasoning
    instruction="""
    You receive enriched research context about a historical document.
    Generate 5-7 documentary segments. Each segment has:
    - title
    - narration_script (60-120 seconds spoken)
    - visual_descriptions (4-6 key frames as detailed Imagen prompts)
    - mood (cinematic, reflective, dramatic, etc.)
    - sources (citations)
    Output as JSON array of segments.
    """,
    output_key="segments"
)
```

### E9 · Visual Director Agent (Imagen 3 + Veo 2)
For each segment:
1. Prefix every Imagen prompt with the Visual Bible
2. Call `imagen-3.0-fast-generate-001` for 4 images (16:9, `personGeneration="dont_allow"`)
3. For 1-2 key dramatic scenes: call `veo-2.0-generate-001` (async, poll, store MP4 to GCS)
4. Save all image URLs + video URL to Firestore segment

Rate limit awareness:
- Imagen 3 fast: 200 req/min — fine for parallel
- Veo 2: 10 req/min — queue and process serially

### E10 · Segment Cards (Streaming)
- Listen to Pub/Sub → SSE for `segment-ready` events
- Show each segment card as "Generating..." with pulse animation
- Flip to ready (clickable) when segment completes
- Click → opens documentary player at that segment

### E11 · Documentary Player
- Full-screen cinematic layout (dark, always — even in light mode app)
- **Ken Burns**: CSS `@keyframes` with `transform: scale(1.12) translate(-2%, -1%)` over 12s, crossfade every 10s
- **Veo 2 scenes**: `<video>` element with GCS MP4 URL, autoplay
- **Caption**: typewriter animation synced to estimated narration timing
- **Segment sidebar**: click to jump segments
- On `interrupted=true`: pause Ken Burns animation, show "Historian is listening" overlay

### E12 · `agent-orchestrator` Cloud Run Service
- Python 3.12 FastAPI app
- Routes: `POST /session/create`, `GET /session/{id}/status`, `SSE /session/{id}/stream`
- Orchestrates: Document AI → Scan Agent → Parallel Research → Script → Visual Director
- Relays agent events to frontend via SSE

---

## SHARED — Both Together

### S1 · Firestore Schema (divide)
- **Berkay**: `/sessions/{id}` root doc + live session state, resumption tokens
- **Efe**: `/sessions/{id}/agents/{agentId}`, `/sessions/{id}/segments/{segmentId}`

### S2 · Terraform IaC (divide — qualifies for +0.2 bonus)
- **Berkay**: `live-relay` Cloud Run service, Secret Manager (Gemini API key)
- **Efe**: `agent-orchestrator` Cloud Run, `historian-api` gateway, Firestore, GCS bucket, Pub/Sub topics

### S3 · Architecture Diagram (required for submission)
- Use Mermaid or draw.io
- Must show: User/Browser → live-relay → Gemini Live API
- Must show: historian-api → agent-orchestrator → ADK agents → Imagen/Veo 2 → GCS
- Must show: Firestore, Pub/Sub connections

### S4 · Blog Post on Medium — HIGHEST PRIORITY BONUS (+0.6 pts)
Write a dev diary as you build. 2-3 articles:
- "How we built a real-time AI historian with Gemini Live API" (focus: voice layer) — **Berkay writes**
- "Orchestrating 10 parallel AI research agents with ADK" (focus: research pipeline) — **Efe writes**
- Tag: `#GeminiLiveAgentChallenge` — include disclosure: "Built for Gemini Live Agent Challenge"

### S5 · README (required for submission)
Must include:
- What it does (1 paragraph)
- Architecture diagram embed
- Prerequisites (Google Cloud project, API keys)
- Step-by-step setup: `pip install google-adk`, env vars, `terraform apply`, `adk deploy cloud_run`
- How to run locally for judges to reproduce

### S6 · Demo Video (4 minutes max — required)
Record together. Follow script in PRD §10:
- 0:00 Ottoman document problem
- 0:20 Upload → workspace
- 0:45 Click a research agent → agent session modal
- 1:30 Segments streaming ready
- 2:00 Documentary player with narration
- 2:45 Voice interruption demo (speak mid-documentary)
- 3:15 Architecture diagram walkthrough
- 3:45 GitHub link

### S7 · Google Developer Group Membership (+0.2 bonus)
Both Berkay and Efe join GDG and include public profile links in submission.

---

## Timeline Suggestion (9 days)

| Days | Berkay | Efe |
|---|---|---|
| Day 1–2 (Mar 8–9) | B2 Live API session setup + B3 audio capture | E1 Upload + E2 PDF viewer + E3 Document AI |
| Day 3–4 (Mar 10–11) | B4 Audio playback + B5 interruption | E4 Scan Agent + E5 Research Pipeline |
| Day 5–6 (Mar 12–13) | B6 Voice button UI + B7 persona prompt | E6 Activity panel + E7 Agent modal + E8 Script agent |
| Day 7 (Mar 14) | B1 live-relay Cloud Run deploy | E9 Visual Director + E10 Segment cards |
| Day 8 (Mar 15) | B8 Session resumption + Terraform | E11 Documentary player + E12 Cloud Run deploy |
| Day 9 (Mar 16) | Demo video + README + submit | Demo video + README + submit |

Write blog posts as you go — don't leave for day 9.
