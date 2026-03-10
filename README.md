# AI Historian

AI Historian turns any historical document into a self-generating cinematic documentary. Upload a PDF or scanned manuscript — AI agents research it in parallel while you read, then produce narrated video segments with cinematic visuals. A live historian persona is always on, always listening, and responds to questions mid-documentary without breaking the experience.

Built for the **[Gemini Live Agent Challenge](https://geminiliveagentchallenge.devpost.com/)** — targeting Grand Prize + Best Creative Storytellers.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Browser (React 19 / TypeScript)           │
│                                                              │
│  ┌──────────┐  ┌─────────────────┐  ┌────────────────────┐  │
│  │ PDF      │  │ Research Panel  │  │ Documentary Player │  │
│  │ Viewer   │  │ Agent Cards     │  │ Ken Burns + Veo 2  │  │
│  └──────────┘  └─────────────────┘  └────────────────────┘  │
│                                                              │
│  WebSocket (voice) ←──────────────────────────────────┐     │
│  SSE (agent events) ←─────────────────────────────┐   │     │
└───────────────────────────────────────────────────│───│─────┘
                                                    │   │
              REST + SSE                            │   │ WebSocket
┌─────────────────────────┐         ┌───────────────┘   │
│   historian-api          │         │  live-relay        │
│   FastAPI · Cloud Run    │         │  Node.js 20        │
│   2 CPU · 2Gi            │         │  Cloud Run · 1Gi   │
└────────────┬────────────┘         └──────────┬─────────┘
             │                                 │
             │ in-process (Python)             │ wss://
┌────────────▼────────────┐       ┌────────────▼──────────────┐
│  agent-orchestrator      │       │  Gemini Live API           │
│  Python 3.12 · ADK       │       │  gemini-2.5-flash-native-  │
│  4 CPU · 4Gi · Cloud Run │       │  audio-preview-12-2025     │
│                          │       └───────────────────────────┘
│  Phase I   Document AI OCR → Semantic Chunker → Curator      │
│  Phase II  ParallelAgent — N × google_search researchers     │
│  Phase III Script Agent (gemini-2.0-pro) → 5–7 segments     │
│  Phase IV  Visual Research Orchestrator — web/wiki sources   │
│  Phase V   Visual Director → Imagen 3 + Veo 2 clips         │
└────────────┬────────────────────────────────────────────────┘
             │
┌────────────▼─────────────────────────────────────────────────┐
│  Google Cloud Data Layer                                      │
│                                                               │
│  Firestore        Session state · agent logs · segments       │
│  Cloud Storage    historian-docs (uploads)                    │
│                   historian-assets (images + videos)          │
│  Pub/Sub          document-scanned → scan-complete →          │
│                   segment-ready → session-ended               │
│  Document AI      Multilingual OCR (OCR_PROCESSOR)           │
│  Vertex AI        Imagen 3 (imagen-3.0-fast-generate-001)    │
│                   Veo 2   (veo-2.0-generate-001)             │
│  Secret Manager   Gemini API key · Document AI processor name │
│  Artifact Registry  Docker images for all Cloud Run services  │
└──────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 19, TypeScript, Vite 6, Tailwind CSS v4, Zustand 5, Motion 12, TanStack Query v5 |
| **Backend gateway** | Python 3.12, FastAPI, Cloud Run |
| **Agent pipeline** | Google ADK (`google-adk`), SequentialAgent + ParallelAgent |
| **AI models** | Gemini 2.0 Flash (agents), Gemini 2.0 Pro (script), Gemini 2.5 Flash Native Audio (voice) |
| **Generative media** | Imagen 3 (4 frames per segment), Veo 2 (cinematic video clips) |
| **Voice relay** | Node.js 20, WebSocket, Cloud Run |
| **Storage** | Firestore, Cloud Storage, Pub/Sub, Document AI |
| **IaC** | Terraform — `terraform apply` provisions all infrastructure |

---

## Prerequisites

- Google Cloud project with billing enabled
- `gcloud` CLI authenticated: `gcloud auth application-default login`
- Terraform ≥ 1.6
- Docker (for building and pushing images)
- Node.js 20, Python 3.12, `pnpm`

---

## Setup

### 1. Clone and configure

```bash
git clone https://github.com/pancodo/gemini-live-agent-challenge
cd gemini-live-agent-challenge

cp backend/.env.example backend/.env
# Edit backend/.env — fill in GCP_PROJECT_ID, GCS_BUCKET_NAME, DOCUMENT_AI_PROCESSOR_NAME
```

### 2. Provision infrastructure with Terraform

```bash
cd terraform
terraform init
terraform apply \
  -var="project_id=YOUR_PROJECT_ID" \
  -var="gemini_api_key=YOUR_GEMINI_API_KEY"
```

Provisions: Firestore, GCS buckets, Pub/Sub, Secret Manager, Artifact Registry, Cloud Run services (historian-api, agent-orchestrator, live-relay), service account with all required IAM roles.

### 3. Build and push Docker images

```bash
PROJECT_ID=YOUR_PROJECT_ID
REGION=us-central1
REGISTRY=${REGION}-docker.pkg.dev/${PROJECT_ID}/historian

gcloud auth configure-docker ${REGION}-docker.pkg.dev

# historian-api
docker build -t ${REGISTRY}/historian-api:latest backend/historian_api/
docker push ${REGISTRY}/historian-api:latest

# agent-orchestrator (ADK pipeline)
docker build -t ${REGISTRY}/agent-orchestrator:latest backend/historian_api/
docker push ${REGISTRY}/agent-orchestrator:latest

# live-relay (Node.js WebSocket proxy)
docker build -t ${REGISTRY}/live-relay:latest backend/live_relay/
docker push ${REGISTRY}/live-relay:latest
```

### 4. Set Document AI processor secret

```bash
echo -n "projects/YOUR_PROJECT/locations/us/processors/YOUR_PROCESSOR_ID" | \
  gcloud secrets versions add document-ai-processor-name --data-file=-
```

### 5. Get service URLs

```bash
terraform output historian_api_url    # → set as VITE_API_BASE_URL in frontend
terraform output live_relay_url       # → set as VITE_RELAY_URL in frontend
```

### 6. Run frontend

```bash
cd frontend
pnpm install
echo "VITE_API_BASE_URL=https://YOUR_HISTORIAN_API_URL" > .env.local
pnpm dev
# Open http://localhost:5173
```

---

## Local Development (no Docker)

```bash
# Backend
cd backend
pip install google-adk google-genai google-cloud-documentai \
            google-cloud-firestore google-cloud-storage \
            fastapi uvicorn pydantic
./start.sh --reload

# Frontend
cd frontend
pnpm install
pnpm dev
```

---

## Agent Pipeline

```
Document upload → GCS
  Phase I   Document AI OCR → Semantic Chunker → Parallel Summarizer → Narrative Curator
            → scene_briefs, visual_bible, document_map

  Phase II  ParallelAgent: N google_search researchers (one per scene brief)
            → research_0 … research_N (facts, sources, visual_prompt per scene)

  Phase III Script Agent (gemini-2.0-pro) → 5–7 SegmentScript objects
            → narration_script, visual_descriptions, veo2_scene, mood, sources

  Phase IV  Visual Research Orchestrator — web scraping, Wikipedia REST API,
            Document AI inline OCR, Gemini multimodal evaluation
            → visual_research_manifest (enriched per-scene visual detail)

  Phase V   Visual Director
            → Imagen 3: 4 frames × N scenes (concurrent, ~5s each)
            → Veo 2: dramatic clips async, polled until done (~60–120s each)
            → Firestore segments updated with imageUrls[], videoUrl
```

Frontend subscribes to `GET /api/session/{id}/stream` (SSE) throughout — research cards and segment cards update in real time as each phase completes.

---

## Project Structure

```
/
├── terraform/              Infrastructure as Code (terraform apply provisions everything)
│   └── main.tf
├── frontend/               React 19 + Vite 6 + Tailwind v4
│   └── src/
│       ├── components/     upload/ workspace/ player/ voice/ ui/
│       ├── hooks/          useSSE, useGeminiLive, useAudioCapture, useAudioPlayback, ...
│       ├── store/          sessionStore (localStorage persisted), researchStore, voiceStore
│       ├── services/       api.ts, upload.ts
│       └── pages/          UploadPage, WorkspacePage, PlayerPage
├── backend/
│   ├── historian_api/      FastAPI gateway — session, SSE stream, status, segments
│   ├── agent_orchestrator/
│   │   └── agents/         document_analyzer, scene_research_agent,
│   │                       script_agent_orchestrator, visual_research_orchestrator,
│   │                       visual_director_orchestrator, pipeline
│   └── live_relay/         Node.js WebSocket proxy → Gemini Live API
├── CLAUDE.md               Full project specification (single source of truth)
└── TASKS.md                Per-task breakdown by team member
```

---

## Google Cloud Services Used

| Service | Role |
|---|---|
| **Cloud Run** | historian-api, agent-orchestrator, live-relay |
| **Vertex AI** | Imagen 3 image generation, Veo 2 video generation |
| **Gemini Live API** | Real-time voice historian persona |
| **Firestore** | Session state, agent logs, generated segments |
| **Cloud Storage** | Document uploads, generated images and videos |
| **Document AI** | Multilingual OCR for historical documents |
| **Pub/Sub** | Async agent event messaging |
| **Secret Manager** | API keys and processor names |
| **Artifact Registry** | Docker images for Cloud Run services |

---

## Team

**Berkay** — Live Voice Layer & Real-Time Interaction (`live-relay`, Gemini Live API, audio pipeline, voice UI)

**Efe** — Research Pipeline, Agent Visualization & Documentary Engine (ADK agents, FastAPI, documentary player, frontend)

---

*Built for the [Gemini Live Agent Challenge](https://geminiliveagentchallenge.devpost.com/) · #GeminiLiveAgentChallenge*
