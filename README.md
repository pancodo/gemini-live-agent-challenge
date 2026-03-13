<div align="center">

<img src="frontend/public/logo.png" alt="AI Historian" width="120" />

# AI Historian

**Upload any historical document. Watch it become a cinematic documentary in under 45 seconds.**

*Real-time multimodal research · Generative cinematic visuals · Always-on live voice historian*

[![Gemini Live Agent Challenge](https://img.shields.io/badge/Gemini_Live_Agent_Challenge-2026-4285F4?style=flat-square&logo=google&logoColor=white)](https://geminiliveagentchallenge.devpost.com/)
[![Google ADK](https://img.shields.io/badge/Google_ADK-latest-34A853?style=flat-square&logo=google&logoColor=white)](https://google.github.io/adk-docs/)
[![Cloud Run](https://img.shields.io/badge/Cloud_Run-deployed-4285F4?style=flat-square&logo=googlecloud&logoColor=white)](https://cloud.google.com/run)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev/)
[![Python](https://img.shields.io/badge/Python-3.12-3776AB?style=flat-square&logo=python&logoColor=white)](https://python.org/)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)

</div>

---

## What is AI Historian?

AI Historian is a real-time multimodal research and documentary engine. Drop any historical document — PDF, scanned manuscript, ancient script — and a seven-agent pipeline immediately begins researching it in parallel. Within 45 seconds the first segment is playable: cinematic imagery, AI narration, and a live historian persona you can interrupt mid-sentence.

| Dimension | What it does |
|---|---|
| **Input** | Any document — PDF, image, multilingual, including dead scripts |
| **Research** | 7-phase ADK pipeline with Google Search grounding, Wikipedia, and Gemini multimodal evaluation |
| **Output** | Self-generating documentary: Imagen 3 visuals · Veo 2 video · AI narration |
| **Voice** | Gemini 2.5 Flash Native Audio — always listening, responds in < 300ms, resumes after interruption |
| **Grounding** | Every spoken question retrieves the 4 most relevant source passages via Firestore vector search — the historian cites actual document pages, not just scripted narration |
| **Live Illustration** | User questions during the documentary trigger on-the-fly Imagen 3 illustrations with cinematic crossfade |
| **Timeline Map** | Interactive antique-style map with animated pins, routes, and fly-to transitions for each documentary segment |
| **Historian Avatar** | AI-generated oil painting portrait (Gemini image generation) with canvas-based lip sync, blinking, and era-adaptive costumes |
| **Adaptation** | Documentary branches based on your questions — no two sessions are identical |
| **Light / Dark** | Full theme support across all screens including the cinematic player with antique map styles |

---

## Demo

> *Upload an Ottoman firman → watch the Expedition Log fill in real time → speak to the historian mid-documentary*

**[▶ Watch the 4-minute demo](#)** · **[Live deployment](#)**

---

## Architecture

```mermaid
flowchart TD
    subgraph Browser["Browser — React 19 / TypeScript"]
        UI["PDF Viewer · Research Panel\nDocumentary Player · Voice Button"]
    end

    subgraph CloudRun["Google Cloud Run"]
        API["historian-api\nFastAPI · Python 3.12\n2 CPU · 2 Gi"]
        ORCH["agent-orchestrator\nResumablePipelineAgent + ADK\nPython 3.12 · 4 CPU · 4 Gi"]
        RELAY["live-relay\nNode.js 20 WebSocket proxy\n1 CPU · 1 Gi"]
    end

    subgraph Pipeline["ADK Pipeline — 7 Phases with Checkpoint Resume"]
        P1["Phase I — Document Analyzer\nDocument AI OCR → Semantic Chunker\nParallel Summarizer → Narrative Curator\n→ scene_briefs · visual_bible"]
        P2["Phase II — Scene Research\nParallelAgent: N × google_search agents\none per scene brief → research_0…N\n+ Aggregator merges all research"]
        P3["Phase III — Script Orchestrator\ngemini-2.0-pro → SegmentScript list\nFirestore WriteBatch · segment_update SSE"]
        P35["Phase III.5 — Fact Validator\ngemini-2.0-flash hallucination firewall\ncross-references narration vs research"]
        P40["Phase 4.0 — Narrative Visual Planner\ngemini-2.0-pro → VisualStoryboard\nper-scene subjects · frame concepts"]
        P4["Phase IV — Visual Research\n6-stage micro-pipeline per scene\nweb + Wikipedia + Gemini multimodal\n→ VisualDetailManifest per scene"]
        P5["Phase V — Visual Director\nImagen 3: 4 frames × N scenes concurrent\nVeo 2: async dramatic clips\nGCS singleton · Firestore batch update"]
        P1 --> P2 --> P3 --> P35 --> P40 --> P4 --> P5
    end

    subgraph GCP["Google Cloud Data and AI"]
        FS[("Firestore\nsessions · agents\nsegments · manifests\nphase checkpoints")]
        GCS[("Cloud Storage\nhistorian-docs uploads\nhistorian-assets images/videos")]
        PS["Pub/Sub\nagent events"]
        DAI["Document AI\nMultilingual OCR"]
        VAI["Vertex AI\nImagen 3 · Veo 2"]
        SM["Secret Manager"]
    end

    GEMINI["Gemini Live API\ngemini-2.5-flash-native-audio\nreal-time voice · interruption"]

    Browser -->|"REST + SSE adaptive drip"| API
    Browser <-->|"WebSocket PCM 16kHz"| RELAY
    RELAY <-->|"wss:// BidiGenerateContent"| GEMINI

    API --> ORCH
    ORCH --- Pipeline

    P1 <--> DAI
    P1 & P3 & P4 & P5 <--> FS
    ORCH <-->|"checkpoint per phase"| FS
    P1 & P5 <--> GCS
    P5 <--> VAI
    API <--> SM
    ORCH <--> SM
    API & ORCH --> PS
```

---

## Agent Pipeline — 7 Phases

<details>
<summary><strong>Phase I — Document Analyzer</strong></summary>

1. **OCR** — Google Document AI extracts multilingual text from the uploaded PDF in GCS
2. **Semantic Chunker** — rule-based splitter: page breaks → headings → topic shifts → 3,200-char fallback
3. **Parallel Summarizer** — `asyncio.gather` + `Semaphore(10)` sends every chunk to Gemini 2.0 Flash concurrently
4. **Narrative Curator** — ADK Agent (Gemini 2.0 Pro) selects 4–8 cinematically compelling scenes and produces structured `SceneBrief` objects and the Visual Bible style guide

**Outputs:** `scene_briefs`, `visual_bible`, `document_map`, `gcs_ocr_path`

5. **Background Embedding** — after chunks are written to Firestore, their summaries are batch-embedded with `gemini-embedding-2-preview` (768 dims, `RETRIEVAL_DOCUMENT` task type) as a background `asyncio.Task`. Phase II starts immediately — vectors are written concurrently without blocking the pipeline. Failures on individual chunks are skipped so a bad chunk never aborts the batch.

</details>

<details>
<summary><strong>Phase II — Scene Research + Aggregator</strong></summary>

- **`ParallelAgent`** spins up one `google_search`-only ADK Agent per scene brief (ADK constraint: `google_search` cannot be combined with other tools)
- Each agent writes `research_{i}` to session state with sources, accepted/rejected evaluation, facts, and a visual prompt
- **Aggregator Agent** merges all `research_0…N` into deduplicated unified facts, source citations, contradiction flags, and an enriched Visual Bible

**Outputs:** `research_0…N`, `aggregated_research`

</details>

<details>
<summary><strong>Phase III — Script Orchestrator</strong></summary>

- Gemini 2.0 Pro generates one `SegmentScript` per scene brief — narration (60–120s), 4 visual frame descriptions, Veo 2 scene, mood, and sources
- All segments are written to Firestore in a single **`WriteBatch`** commit (4–8 sequential round-trips → 1 atomic operation)
- Emits `segment_update(status="generating")` SSE per segment so frontend skeleton cards appear immediately

**Outputs:** `SegmentScript` list in Firestore + `session.state["script"]`

</details>

<details>
<summary><strong>Phase III.5 — Fact Validator (Hallucination Firewall)</strong></summary>

- Gemini 2.0 Flash acts as an LLM-judge, cross-referencing every narration claim against the aggregated research
- Claims are classified: `SUPPORTED` (keep) · `UNSUPPORTED_SPECIFIC` (remove + bridge sentence) · `UNSUPPORTED_PLAUSIBLE` (soften with "according to tradition") · `NON_FACTUAL` (keep, skip)
- Overwrites `session.state["script"]` in place — zero changes to downstream agents
- Latency: ~3–5s; eliminates hallucinated dates, names, and events from narration

</details>

<details>
<summary><strong>Phase 4.0 — Narrative Visual Planner</strong></summary>

- Single Gemini 2.0 Pro call produces a `VisualStoryboard` — per-scene primary subjects, objects to avoid (anachronism guards), 3–5 targeted image search queries, and 4 frame concepts with composition notes
- Feeds Phase IV with specific search targets instead of generic scene descriptions

**Output:** `visual_storyboard` (VisualStoryboard model)

</details>

<details>
<summary><strong>Phase IV — Visual Research Orchestrator</strong></summary>

6-stage micro-pipeline per scene, all direct `client.aio.models.generate_content` calls (no ADK sub-agents):

| Stage | What it does |
|---|---|
| 0 | Query generation — produces 5–7 targeted image search queries from storyboard |
| 1 | Web search with Google Search grounding — extracts `grounding_chunks[].web.uri` URLs |
| 2 | Source typing — classifies each URL as webpage / Wikipedia / PDF / image |
| 3 | Content fetch — httpx + BeautifulSoup (web) · Wikipedia REST API · Document AI inline (PDF) · Gemini multimodal FileData (image) |
| 4 | Source evaluation — accepts/rejects each source against the scene brief; emits `agent_source_evaluation` SSE |
| 5 | Detail synthesis — merges accepted sources into `VisualDetailManifest` with period-accurate Imagen prompts |

Fast path (Scene 0): 3 sources, early exit at 2 accepted — prioritizes first segment playability.

**Output:** `VisualDetailManifest` per scene in Firestore

</details>

<details>
<summary><strong>Phase V — Visual Director</strong></summary>

- **Imagen 3** (`imagen-3.0-fast-generate-001`): 4 frames per scene, all scenes concurrent via `asyncio.gather`. Priority: enriched manifest → script visual_descriptions → generic fallback. Prompts include era markers as negative prompts.
- **Veo 2** (`veo-2.0-generate-001`): one dramatic clip per scene, fired async after all Imagen generation completes. Polled with `loop.run_in_executor(None, client.operations.get, op)` (sync-only API).
- **GCS uploads** use a module-level `storage.Client()` singleton and cached `Bucket` reference — eliminates per-upload HTTP connection pool creation.
- Updates Firestore with `imageUrls[]` and `videoUrl` per segment and emits `segment_update(status="complete")` SSE.

**Progressive delivery:** Scene 0 generates images first (before remaining scenes start) to hit the < 45s first-segment target.

</details>

<details>
<summary><strong>Checkpoint Resume — ResumablePipelineAgent</strong></summary>

Every completed phase is checkpointed to Firestore (`/sessions/{id}/checkpoints/pipeline`). On restart after crash or timeout, completed phases are skipped and `session.state` is restored from the snapshot. The pipeline resumes from the first incomplete phase — no reprocessing of OCR, research, or scripts.

</details>

---

## Live Historian Grounding (RAG)

The live historian persona has semantic access to the actual source document — not just the scripted narration — via a lightweight RAG layer that runs entirely on the voice hot path.

**How it works:**

```
User speaks → Gemini Live → inputTranscript event
                                    ↓
                         live-relay intercepts (>15 chars)
                                    ↓
                    POST /api/session/{id}/retrieve  (1.5s timeout)
                                    ↓
               historian-api embeds query (gemini-embedding-2-preview)
               Firestore find_nearest() → top-4 chunks by cosine distance
                                    ↓
              live-relay injects passages as clientContent turn
              before the historian's audio response arrives
```

**Best-effort at every step — nothing can break the voice session:**

| Layer | Failure mode | Behavior |
|---|---|---|
| Background embed task | Exception in `_embed_and_write_background` | Caught and logged — Phase II unaffected |
| Individual chunk | `embed_content` API error | Chunk `embedding` stays `None`, skipped |
| Retrieve endpoint | Any exception | Returns `{"chunks": []}` — never HTTP 500 |
| live-relay injection | Timeout (>1.5s) or network error | `retrieveContext` returns `""` — injection skipped |
| Historian response | No context injected | Answers from existing session context as before |

**Firestore vector index** (one-time setup, 5–15 min to provision):

```bash
gcloud firestore indexes composite create \
  --collection-group=chunks \
  --query-scope=COLLECTION \
  --field-config field-path=embedding,vector-config='{"dimension":"768","flat":"{}"}' \
  --database="(default)" \
  --project=$GCP_PROJECT_ID
```

---

## Tech Stack

### AI Models

| Model | Role |
|---|---|
| `gemini-2.5-flash-native-audio-preview-12-2025` | Historian persona — Gemini Live API |
| `gemini-2.0-pro` | Script generation, Visual Planner, Narrative Curator |
| `gemini-2.0-flash` | Scan Agent, Research Subagents, Fact Validator, Visual Research |
| `gemini-embedding-2-preview` | Chunk summary embeddings (768 dims) + query embedding for RAG retrieval |
| `imagen-3.0-fast-generate-001` | Scene images (4 frames per segment, ~5s each) |
| `veo-2.0-generate-001` | Dramatic video clips (async, 1–2 min each) |

### Google Cloud Services

| Service | Role |
|---|---|
| **Cloud Run** | All three backend services — historian-api, agent-orchestrator, live-relay |
| **Vertex AI** | Imagen 3, Veo 2, Gemini model hosting |
| **Gemini Live API** | Real-time bidirectional voice with interruption and resumption |
| **Firestore** | Session state, agent logs, segments, manifests, phase checkpoints; chunk `Vector(768)` fields for RAG vector search |
| **Cloud Storage** | Uploaded documents, generated images, MP4 videos |
| **Document AI** | Multilingual OCR (`OCR_PROCESSOR`) |
| **Pub/Sub** | Async agent event messaging |
| **Secret Manager** | API keys and service credentials |
| **Artifact Registry** | Docker images for Cloud Run |

### Frontend

| Package | Version | Role |
|---|---|---|
| React | 19 | UI framework — concurrent rendering, `startTransition` for SSE |
| Vite | 6 | Build tool — ESBuild transforms, instant HMR |
| TypeScript | 5.x strict | Full type safety, no `any` |
| Tailwind CSS | v4 | CSS-first config, Lightning CSS engine |
| Zustand | 5 | Client state — `useShallow` selectors, sessionStorage persistence |
| Motion | 12 | All animations — springs, `AnimatePresence`, `layoutId` |
| TanStack Query | v5 | Server state — REST polling, SSE stream management |
| MapLibre GL | 5.x | Interactive antique-style timeline map with animated pins and routes |
| Canvas API | native | Living Portrait avatar — layered canvas compositing with lip sync |
| Radix UI | latest | Accessible headless components — Dialog, Tooltip, Collapsible |
| react-resizable-panels | 4.x | Draggable split layout for PDF viewer + research panel |
| Sonner | 2.x | Toast notifications — `toast.promise()` for async agent operations |
| pdfjs-dist | latest | PDF rendering with text layer extraction |

---

## Performance

| Layer | Optimization | Impact |
|---|---|---|
| Frontend | `React.memo` on AgentCard + SegmentCard; `useShallow` Zustand selectors; `useMemo` for agent grouping | No cascading re-renders on agent status updates |
| Frontend | SSE adaptive drip — 1 / 3 / 8 events per 150ms tick, single `startTransition` per batch | 50-event burst: 7.5s → ~1s catch-up |
| Frontend | Canvas resize guard in Waveform — conditional `width`/`height` assignment | Eliminates 60 GPU context flushes/second during audio |
| Frontend | All pages lazy-loaded via `React.lazy` + `Suspense` | Smaller initial bundle — only UploadPage parsed on first load |
| Frontend | CSS containment (`contain: layout style paint`) + GPU hints (`will-change`) on player and map | Isolates repaint scope; prevents layout thrashing |
| Frontend | ResearchStore persisted to `sessionStorage` via Zustand persist middleware | State survives page refreshes without re-fetching |
| Backend | Firestore `WriteBatch` for segment writes | 4–8 sequential round-trips → 1 atomic commit |
| Backend | `GlobalRateLimiter.locked()` + Retry-After header extraction | Correct backoff without hitting 429 cascades |
| Backend | GCS `storage.Client()` singleton + `Bucket` cache | Eliminates per-upload connection pool creation under concurrent Imagen 3 |
| Backend | Test mode: 6-chunk limit + 1 frame/segment + no Veo 2 | Fast iteration without burning Imagen/Veo quota |

### Performance Targets

| Metric | Target |
|---|---|
| First segment playable | < 45 seconds from document upload |
| Voice interruption latency | < 300ms (historian stops mid-word) |
| Historian response start | < 1.5 seconds after user speech ends |
| Research subagent completion | < 30 seconds per agent |
| Imagen 3 fast generation | ~5 seconds per image |
| Frontend initial bundle | < 200KB gzipped |
| Animation frame budget | 60fps maintained |

---

## Setup

### Prerequisites

- Google Cloud project with billing enabled
- `gcloud` CLI authenticated: `gcloud auth application-default login`
- Terraform ≥ 1.6
- Docker
- Node.js 20, Python 3.12, `pnpm`

### 1. Clone and configure

```bash
git clone https://github.com/pancodo/gemini-live-agent-challenge
cd gemini-live-agent-challenge
cp backend/.env.example backend/.env
# Fill in: GCP_PROJECT_ID, GCS_BUCKET_NAME, DOCUMENT_AI_PROCESSOR_NAME
```

### 2. Provision infrastructure

```bash
cd terraform
terraform init
terraform apply \
  -var="project_id=YOUR_PROJECT_ID" \
  -var="gemini_api_key=YOUR_GEMINI_API_KEY"
```

Provisions: Firestore, GCS buckets (docs + assets), Pub/Sub, Secret Manager, Artifact Registry, 3 Cloud Run services, service account with all IAM roles.

### 3. Build and push images

```bash
PROJECT_ID=YOUR_PROJECT_ID
REGION=us-central1
REGISTRY=${REGION}-docker.pkg.dev/${PROJECT_ID}/historian

gcloud auth configure-docker ${REGION}-docker.pkg.dev

docker build -t ${REGISTRY}/historian-api:latest     backend/historian_api/    && docker push ${REGISTRY}/historian-api:latest
docker build -t ${REGISTRY}/agent-orchestrator:latest backend/agent_orchestrator/ && docker push ${REGISTRY}/agent-orchestrator:latest
docker build -t ${REGISTRY}/live-relay:latest         backend/live_relay/        && docker push ${REGISTRY}/live-relay:latest
```

### 4. Configure secrets and frontend

```bash
# Set Document AI processor
echo -n "projects/YOUR_PROJECT/locations/us/processors/YOUR_PROCESSOR_ID" | \
  gcloud secrets versions add document-ai-processor-name --data-file=-

# Get service URLs
terraform output historian_api_url   # → VITE_API_BASE_URL
terraform output live_relay_url      # → VITE_RELAY_URL

# Run frontend
cd frontend
pnpm install
echo "VITE_API_BASE_URL=https://YOUR_API_URL" > .env.local
pnpm dev
```

### Local development (no Docker)

```bash
# Backend
cd backend
pip install google-adk google-genai google-cloud-documentai \
            google-cloud-firestore google-cloud-storage fastapi uvicorn pydantic
./start.sh --reload

# Frontend (separate terminal)
cd frontend && pnpm install && pnpm dev
```

---

## Project Structure

```
/
├── terraform/
│   └── main.tf                         18 resource types — full GCP provisioning
│
├── frontend/
│   └── src/
│       ├── components/
│       │   ├── upload/                 DropZone, FormatBadge, PersonaSelector
│       │   ├── workspace/              WorkspaceLayout, PDFViewer, ResearchPanel,
│       │   │                           HistorianPanel, AgentModal, SegmentCard,
│       │   │                           ExpeditionLog, TopNav
│       │   ├── player/                 DocumentaryPlayer, KenBurnsStage, TimelineMap,
│       │   │                           CaptionTrack, PlayerSidebar, IrisOverlay,
│       │   │                           SourcePanel, ShareButton, BranchTree
│       │   ├── voice/                  VoiceButton, Waveform, VoiceLayer, LiveToast,
│       │   │                           LivingPortrait (canvas)
│       │   └── ui/                     Button, InkButton, Badge, Spinner, Modal
│       ├── hooks/
│       │   ├── useSSE.ts               Adaptive drip SSE — 1/3/8 events per 150ms tick
│       │   ├── useGeminiLive.ts        WebSocket session lifecycle + text messages
│       │   ├── useAudioCapture.ts      Mic → 16kHz PCM via AudioWorklet
│       │   ├── useAudioPlayback.ts     PCM chunk queue → Web Audio API
│       │   ├── useAudioVisualSync.ts   AnalyserNode → CSS custom properties
│       │   ├── useSegmentGeo.ts        Geo extraction via Gemini Flash for timeline map
│       │   ├── usePortraitRenderer.ts   Canvas compositing engine for Living Portrait
│       │   ├── useLipSync.ts           AnalyserNode frequency → mouth energy computation
│       │   ├── useTextScramble.ts      Cipher/decode title reveal animation
│       │   └── useVoiceState.ts        Voice button state machine with auto-reconnect
│       ├── store/                      sessionStore · researchStore (sessionStorage) · voiceStore · playerStore
│       ├── services/                   api.ts · upload.ts (GCS signed URL)
│       ├── styles/                     map-style.json · map-style-light.json · timeline-map.css
│       └── pages/                      LandingPage · UploadPage · WorkspacePage · PlayerPage (lazy-loaded)
│
├── backend/
│   ├── historian_api/
│   │   └── routes/
│   │       ├── session.py              Session lifecycle, SSE stream, signed URL refresh
│   │       ├── pipeline.py             Pipeline trigger, segment endpoints
│   │       ├── retrieve.py             POST /api/session/{id}/retrieve — RAG vector search
│   │       └── illustrate.py           POST /api/session/{id}/illustrate — live Imagen 3 on user questions
│   ├── agent_orchestrator/
│   │   └── agents/
│   │       ├── pipeline.py             ResumablePipelineAgent — checkpoint-aware orchestrator
│   │       ├── document_analyzer.py    Phase I — OCR, chunking, summarization, curation
│   │       ├── scene_research_agent.py Phase II — ParallelAgent scene research
│   │       ├── script_agent_orchestrator.py  Phase III — script gen + WriteBatch
│   │       ├── fact_validator_agent.py Phase III.5 — hallucination firewall
│   │       ├── narrative_visual_planner.py   Phase 4.0 — VisualStoryboard
│   │       ├── visual_research_orchestrator.py Phase IV — 6-stage visual research
│   │       ├── visual_director_orchestrator.py Phase V — Imagen 3 + Veo 2 + GCS
│   │       ├── narrative_director_agent.py   Phase 3.1 — TEXT+IMAGE interleaved storyboard
│   │       ├── branch_pipeline.py      Branching documentary graph from user questions
│   │       ├── entity_extractor.py     Named entity extraction for PDF highlights
│   │       ├── research_deduplicator.py Source deduplication across scenes
│   │       ├── checkpoint_helpers.py   Phase checkpoint load/save (Firestore)
│   │       ├── rate_limiter.py         GlobalRateLimiter + Retry-After backoff
│   │       ├── sse_helpers.py          SSE event builders
│   │       ├── chunk_types.py          ChunkRecord · SceneBrief · DocumentMap
│   │       ├── script_types.py         SegmentScript
│   │       ├── storyboard_types.py     VisualStoryboard
│   │       └── visual_detail_types.py  VisualDetailManifest
│   └── live_relay/                     Node.js 20 WebSocket proxy → Gemini Live API
│                                       + RAG injection · transcript forwarding · Firestore context
│
└── docs/
    ├── spec/                            Product specs (PRD, SRS, FRONTEND_PLAN, RESOURCES)
    ├── project/                         Tasks, UI improvements, feature backlog
    ├── architecture/                    Diagrams and generator script
    │   ├── architecture-diagram.md      Full + compact Mermaid diagrams
    │   └── architecture-diagram.png     Generated PNG
    ├── demo/                            Demo script and interactive prototype
    │   └── DEMO_SCRIPT.md              7-shot demo video shot list with timing
    ├── blog/                            Blog drafts and posting strategy
    └── plans/                           Dated engineering design documents
```

---

## Team

**Berkay** — Live Voice Layer & Real-Time Interaction
`live-relay` · Gemini Live API · browser audio pipeline (PCM encoding) · interruption handling · voice button state machine · session resumption · RAG context injection · transcript forwarding

**Efe** — Research Pipeline, Agent Visualization & Documentary Engine
ADK 7-phase agent pipeline · Document AI OCR · FastAPI gateway · SSE streaming · documentary player · Research Activity panel · Agent Modal · Timeline Map · Living Portrait avatar · live illustration engine · light/dark theme

---

<div align="center">

<img src="frontend/public/logo.png" alt="AI Historian" width="48" />

Built for the **[Gemini Live Agent Challenge](https://geminiliveagentchallenge.devpost.com/)** by Google · `#GeminiLiveAgentChallenge`

</div>
