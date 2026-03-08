# CLAUDE.md — AI Historian Project Guide

## Working Philosophy

This project is treated as a **production-grade product**, not a hackathon prototype. Every component — voice interaction latency, agent log readability, documentary visual quality, error handling, code structure — is built to the highest standard possible. Do not suggest shortcuts, reduced scope, or "good enough for a hackathon" trade-offs. Do not add phrases like "for a hackathon this is fine" or "you don't need to go this deep." The team manages their own priorities and time. Focus entirely on how to build each thing correctly and beautifully.

---

## What This Project Is

**AI Historian** is a real-time multimodal research and documentary engine. A user uploads any historical document in any language. AI agents immediately begin researching it in parallel while the user reads the document. The research feeds a generative documentary pipeline — cinematic visuals, narration, and a living historian persona the user can speak to and interrupt at any moment, mid-playback.

The system is not a chatbot. It is not a video editor. It is the first system where a live AI agent persona researches, writes, narrates, and converses simultaneously — and adapts its documentary in real time based on the user's questions.

---

## The Competition

**Hackathon:** Gemini Live Agent Challenge
**Organizer:** Google LLC, administered by Devpost
**Submission Deadline:** March 16, 2026 at 5:00 PM PT
**Winners Announced:** April 22–24, 2026 at Google Cloud NEXT (Las Vegas)
**Total Prize Pool:** $80,000
**Registered Participants:** 7,590+

**Target Prizes:**
- Grand Prize: $25,000 + $3,000 cloud credits + 2× NEXT 2026 tickets + 2× $3,000 travel stipends + demo opportunity
- Best Creative Storytellers: $10,000 + $1,000 cloud credits + 2× NEXT 2026 tickets

**Submission page:** https://geminiliveagentchallenge.devpost.com/

---

## Competition Categories

Three categories exist. This project targets **Creative Storytellers** as primary, with **Live Agents** characteristics as a secondary strength.

### Creative Storytellers (Primary Category)
Agents that weave text, images, audio, and video in seamless interleaved output streams. The focus is on fluid multimodal narrative where media types flow together naturally, not sequentially.

### Live Agents (Secondary Strength)
Real-time voice interaction agents with natural conversation and interruption handling. The Historian persona is always-on, always listening, and responds without breaking the documentary experience.

### UI Navigators (Not Applicable)
Visual screen interpretation and automated action execution. Not relevant to this project.

---

## Judging Criteria

Scores are 1–5 per criterion, weighted. Bonus points (up to +1.0) are added to the final weighted score. Final range: 1.0–6.0.

### Innovation & Multimodal User Experience — 40%
The most heavily weighted criterion. Judges look for:
- Breaking the "text box" paradigm entirely
- Natural, immersive, non-chat interaction
- Seamless interleaving of text, image, audio, and video in a single coherent flow
- Distinct AI persona with live context-awareness
- For Creative Storytellers specifically: fluid media interleaving in a coherent narrative

**Every UI and UX decision should be made with this 40% weight in mind.**

### Technical Implementation & Agent Architecture — 30%
- Effective, correct use of Google GenAI SDK or ADK
- Robust Google Cloud hosting (Cloud Run, Vertex AI, Firestore)
- Sound multi-agent logic and orchestration
- Graceful error handling and edge case management
- Hallucination avoidance with grounding evidence (Google Search Grounding)

### Demo & Presentation — 30%
- Clear problem definition and solution narrative
- Legible, accurate architecture diagram
- Visual proof of Google Cloud deployment
- Actual working software demonstrated — no mockups, no slides pretending to be UI

**Tie-breaking:** Judges compare criteria scores in listed order if scores are tied. Judge decisions are final.

---

## Mandatory Requirements (Failure = Disqualification)

Every single one of these must be true at submission:

1. **Uses a Gemini model** — Gemini 2.0 Flash, Gemini 2.0 Pro, and Gemini 2.5 Flash Native Audio are all used
2. **Uses Google GenAI SDK or ADK** — raw REST API calls to Gemini are not sufficient; must use the official SDK or ADK
3. **At least one Google Cloud service** — we use Cloud Run, Firestore, GCS, Document AI, Pub/Sub, Vertex AI
4. **Backend hosted on Google Cloud** — Cloud Run is the primary hosting platform
5. **Project newly created during the contest period** (Feb 16 – Mar 16, 2026) — this project was started within this window
6. **Public code repository** — https://github.com/pancodo/gemini-live-agent-challenge must remain public with complete setup instructions in README
7. **Architecture diagram** — must clearly show: User/Frontend, Gemini model location and access method, backend logic on Google Cloud, connections between all components and external APIs
8. **Demo video** — maximum 4 minutes, publicly hosted on YouTube or Vimeo, in English (or with English subtitles), must show actual working software with problem statement and solution value pitch
9. **Proof of Google Cloud deployment** — either a screen recording showing the GCP console, or GitHub links demonstrating Google Cloud service API calls

---

## Bonus Points (All Should Be Pursued)

| Bonus | Points | Requirement |
|---|---|---|
| Published content (blog/podcast/video) about building this with Google AI/Cloud | **+0.6** | Must include `#GeminiLiveAgentChallenge` hashtag and disclosure that it was built for the hackathon |
| Automated Cloud deployment (IaC scripts in public repo) | **+0.2** | Terraform in `terraform/` directory — `terraform apply` must provision all infrastructure |
| Active Google Developer Group (GDG) membership | **+0.2** | Both team members join GDG and provide public profile links in submission |

The +0.6 blog post bonus is the single largest lever in the entire scoring system — equivalent to 12% of a 5-point base score. Both team members should write their posts while building, not after.

---

## Team

**Berkay** — Live Voice Layer & Real-Time Interaction
Owns everything that touches the Gemini Live API: the live-relay Cloud Run service (Node.js WebSocket proxy), browser audio capture (PCM encoding), audio playback pipeline, interruption handling, voice button state machine, historian persona system prompt, and session resumption.

**Efe** — Research Pipeline, Agent Visualization & Documentary Engine
Owns everything that touches document processing and content generation: Document AI OCR, ADK Scan Agent, ADK Parallel Research Pipeline, Research Activity panel, Agent Session Modal, Script Generation Agent, Visual Director Agent (Imagen 3 + Veo 2), segment streaming, and the documentary player.

**Detailed task breakdown:** See `TASKS.md`
**Technology links and documentation:** See `RESOURCES.md`

---

## Tech Stack

### AI Models
| Model | Use |
|---|---|
| `gemini-2.5-flash-native-audio-preview-12-2025` | Historian persona (Gemini Live API) |
| `gemini-live-2.5-flash-native-audio` | Historian persona (Vertex AI path) |
| `gemini-2.0-flash` | Scan Agent, Research Subagents |
| `gemini-2.0-pro` | Script Generation Agent |
| `imagen-3.0-fast-generate-001` | Scene images (200 req/min, ~5s each) |
| `veo-2.0-generate-001` | Dramatic video clips (async, 1–2 min each) |

⚠️ `gemini-2.0-flash-live-001` was **shut down December 9, 2025** — never use this model ID.

### Google Cloud Services
| Service | Role |
|---|---|
| Cloud Run | All backend services |
| Vertex AI | Imagen 3, Veo 2, Gemini model hosting |
| Firestore | Session state, agent logs, documentary graph |
| Cloud Storage (GCS) | Uploaded documents, generated images, MP4 videos |
| Document AI | Multilingual OCR (`OCR_PROCESSOR`) |
| Pub/Sub | Async agent event messaging |
| Secret Manager | API keys, service credentials |

### Agent Framework
| Package | Role |
|---|---|
| `google-adk` | Agent orchestration (ADK) |
| `google-genai` | Gemini model calls, Imagen 3, Veo 2 |
| `google-cloud-documentai` | OCR processing |

### ADK Agent Architecture
```
SequentialAgent (pipeline)
  └── scan_agent           (Agent, gemini-2.0-flash)
  └── ParallelAgent
        └── researcher_0   (Agent, google_search, gemini-2.0-flash)
        └── researcher_1   (Agent, google_search, gemini-2.0-flash)
        └── researcher_N   (Agent, google_search, gemini-2.0-flash)
  └── aggregator_agent     (Agent, reads all research_{n} state keys)
  └── script_agent         (Agent, gemini-2.0-pro)
  └── visual_director      (Agent, calls Imagen 3 + Veo 2)
```

### Critical ADK Constraints
- `google_search` tool **cannot be combined** with other tools in the same agent — research agents are search-only
- Agent results are shared via `output_key` → `session.state[key]` → referenced in downstream agent instructions via `{key}` template syntax
- `ParallelAgent` provides **no shared state during execution** — each subagent writes to its own `output_key`

### Frontend
- React + TypeScript
- `pnpm` for package management (never npm)
- `pdfjs-dist` for PDF rendering
- Web Audio API for microphone capture and audio playback
- WebSocket client for Gemini Live API connection
- CSS Ken Burns animations for documentary visuals

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Browser (React/TS)                    │
│  PDF Viewer │ Research Panel │ Documentary Player        │
│                  WebSocket ←→ live-relay                 │
└──────────┬───────────────────────────┬──────────────────┘
           │ REST + SSE                │ WebSocket
┌──────────▼──────────┐    ┌──────────▼──────────────────┐
│   historian-api      │    │   live-relay (Node.js)       │
│   Cloud Run          │    │   Cloud Run                  │
└──────────┬──────────┘    └──────────┬──────────────────┘
           │                          │
┌──────────▼──────────┐    ┌──────────▼──────────────────┐
│ agent-orchestrator   │    │   Gemini Live API            │
│ Cloud Run (ADK)      │    │   gemini-2.5-flash-native-   │
│                      │    │   audio-preview-12-2025       │
│ ┌──────────────────┐ │    └─────────────────────────────┘
│ │ Scan Agent       │ │
│ │ ParallelAgent    │ │    ┌─────────────────────────────┐
│ │  └ researcher×N  │ │    │   Vertex AI                  │
│ │ Script Agent     │─┼───▶│   Imagen 3 / Veo 2           │
│ │ Visual Director  │ │    └─────────────────────────────┘
│ └──────────────────┘ │
└──────────┬──────────┘
           │
┌──────────▼──────────────────────────────────────────────┐
│  Firestore │ Cloud Storage (GCS) │ Pub/Sub │ Document AI │
└─────────────────────────────────────────────────────────┘
```

---

## Gemini Live API — Key Technical Facts

- **WebSocket endpoint:** `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent`
- **First message** after connection MUST be `BidiGenerateContentSetup` — no content before server sends `setupComplete`
- **VAD config** lives in `realtimeInputConfig.automaticActivityDetection`
- **Interruption** is server-detected: `serverContent.interrupted = true` → client must stop audio playback immediately and clear queue
- **Audio in:** 16-bit PCM, 16,000 Hz, mono, 1024-byte chunks
- **Audio out:** 16-bit PCM, 24,000 Hz, mono
- **Session limit:** 15 minutes without compression; unlimited with `contextWindowCompression.slidingWindow`
- **Resumption:** store `sessionResumptionUpdate.handle` token; reconnect with it on `goAway` or disconnect (valid 2 hours)

---

## Firestore Schema

```
/sessions/{sessionId}
  status: "uploading" | "processing" | "ready" | "playing"
  gcsPath: string
  language: string
  visualBible: string
  createdAt: timestamp

/sessions/{sessionId}/liveSession
  resumptionToken: string
  voiceState: string
  lastConnectedAt: timestamp

/sessions/{sessionId}/agents/{agentId}
  query: string
  status: "queued" | "searching" | "done"
  logs: array<{ step, ts, data }>
  facts: array<string>
  visualPrompt: string

/sessions/{sessionId}/segments/{segmentId}
  title: string
  script: string
  imageUrls: array<string>
  videoUrl: string (optional)
  mood: string
  sources: array<string>
  graphEdges: array<string>
  createdAt: timestamp
```

---

## Cloud Run Services

| Service | Runtime | Memory | CPU | Notes |
|---|---|---|---|---|
| `historian-api` | Python 3.12 | 2Gi | 2 | API gateway, signed URL generation |
| `agent-orchestrator` | Python 3.12 | 4Gi | 4 | ADK pipeline, SSE streaming |
| `live-relay` | Node.js 20 | 1Gi | 1 | WebSocket proxy to Gemini Live API |

Deploy ADK service via: `adk deploy cloud_run --project=PROJECT --region=us-central1 --service_name=historian-agents agents/`

---

## Repository Structure

```
/
├── CLAUDE.md              ← This file
├── TASKS.md               ← Per-task breakdown for Berkay and Efe
├── RESOURCES.md           ← All documentation links
├── PRD.md                 ← Product Requirements Document
├── SRS.md                 ← Software Requirements Specification
├── prototype.html         ← Interactive UX mockup (light mode)
├── frontend/              ← React + TypeScript app
│   ├── src/
│   │   ├── components/
│   │   ├── hooks/         ← useGeminiLive, useAudioCapture, useAudioPlayback
│   │   └── pages/
│   └── package.json       ← uses pnpm
├── backend/
│   ├── historian_api/     ← FastAPI gateway service
│   ├── agent_orchestrator/ ← ADK pipeline service
│   │   └── agents/        ← scan_agent, research_agents, script_agent, visual_director
│   └── live_relay/        ← Node.js WebSocket relay
└── terraform/             ← Infrastructure as Code (bonus +0.2 pts)
    └── main.tf
```

---

## Code Standards

- **Python:** 3.12+, type hints everywhere, async/await for all I/O
- **TypeScript:** strict mode, no `any`
- **Package manager:** `pnpm` (never `npm` or `yarn`) for all Node.js projects
- **Commits:** clear, imperative present tense (`add`, `fix`, `update`) — no co-author lines
- **Secrets:** never hardcoded — always Secret Manager or environment variables
- **Error handling:** every external API call (Gemini, Imagen, Veo 2, Document AI) retried up to 3× with exponential backoff
- **No security vulnerabilities:** validate all inputs at system boundaries (file upload, user speech text)

---

## Performance Targets

| Metric | Target |
|---|---|
| First segment playable | < 45 seconds from document upload |
| Voice interruption latency | < 300ms (historian stops mid-word) |
| Historian response start | < 1.5 seconds after user speech ends |
| Research subagent completion | < 30 seconds per agent |
| Imagen 3 fast generation | ~5 seconds per image |
| Veo 2 video generation | 1–2 minutes per clip (async) |

---

## Submission Checklist

- [ ] All backend services deployed and running on Cloud Run
- [ ] `terraform/` directory with working `terraform apply`
- [ ] `README.md` with step-by-step setup instructions for judges
- [ ] Architecture diagram (Mermaid or image) embedded in README
- [ ] Screen recording of GCP console showing deployment
- [ ] Demo video ≤ 4 minutes on YouTube or Vimeo (unlisted is fine)
- [ ] Demo video shows real working software — no mockup screens
- [ ] Berkay's blog post published with `#GeminiLiveAgentChallenge` tag
- [ ] Efe's blog post published with `#GeminiLiveAgentChallenge` tag
- [ ] Both team members joined GDG with public profile links
- [ ] Repository is public: https://github.com/pancodo/gemini-live-agent-challenge
- [ ] Devpost submission form completed at: https://geminiliveagentchallenge.devpost.com/

---

## Reference Links

| Resource | URL |
|---|---|
| Competition page | https://geminiliveagentchallenge.devpost.com/ |
| Official rules | https://geminiliveagentchallenge.devpost.com/rules |
| FAQs | https://geminiliveagentchallenge.devpost.com/details/faqs |
| Resources page | https://geminiliveagentchallenge.devpost.com/resources |
| GitHub repo | https://github.com/pancodo/gemini-live-agent-challenge |
| Gemini Live API docs | https://ai.google.dev/gemini-api/docs/multimodal-live |
| ADK documentation | https://google.github.io/adk-docs/ |
| ADK bidi-streaming guide | https://google.github.io/adk-docs/streaming/dev-guide/part1/ |
| Imagen 3 guide | https://cloud.google.com/vertex-ai/generative-ai/docs/image/generate-images |
| Veo 2 guide | https://cloud.google.com/vertex-ai/generative-ai/docs/video/generate-videos-from-text |
| Document AI OCR | https://cloud.google.com/document-ai/docs/process-documents-ocr |
| Google Cloud credits form | https://forms.gle/rKNPXA1o6XADvQGb7 |
| GDG membership | https://gdg.community.dev/ |
| Official Live API sample code | https://github.com/GoogleCloudPlatform/generative-ai/tree/main/gemini/multimodal-live-api |
| ADK bidi-streaming samples | https://github.com/google/adk-samples/tree/main/python/agents/bidi-demo |
| All technology links | See RESOURCES.md |
