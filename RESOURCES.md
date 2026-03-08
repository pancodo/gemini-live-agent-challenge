# AI Historian — Technology Resource Guide

A map of every technology in this project: what it is, why we use it, and where to read about it.

---

## 1. The Hackathon

**Gemini Live Agent Challenge — Devpost**
The competition we are building for. Read the rules, judging criteria, submission requirements, and prize breakdown here before doing anything else.
→ https://geminiliveagentchallenge.devpost.com/

**Official Rules**
Mandatory reading. Contains exact eligibility requirements, what must be in the submission, and disqualification conditions.
→ https://geminiliveagentchallenge.devpost.com/rules

---

## 2. Core AI — Gemini Models

### Gemini 2.0 Flash
Fast, cost-efficient model. Used for the Scan Agent and Research Subagents — tasks that need speed and run many times in parallel.
→ https://ai.google.dev/gemini-api/docs/models#gemini-2.0-flash

### Gemini 2.0 Pro (Experimental)
More powerful reasoning model. Used for the Script Generation Agent where the quality of the documentary narration matters most.
→ https://ai.google.dev/gemini-api/docs/models#gemini-2.0-pro-exp

### Gemini 2.5 Flash Native Audio (Live API model)
The specific model used for the Historian persona. Designed for real-time voice sessions with sub-second latency. This is not a regular chat model — it runs inside a persistent WebSocket session.
→ https://ai.google.dev/gemini-api/docs/models#gemini-2.5-flash-native-audio-preview

### All Gemini Models Reference
Full list of all available models, their IDs, context windows, and capabilities.
→ https://ai.google.dev/gemini-api/docs/models

---

## 3. Gemini Live API (Multimodal Live API)

This is the heart of the project's voice interaction. A persistent bidirectional WebSocket connection that lets the user speak to the Historian AI, interrupt it mid-sentence, and receive real-time audio responses. It has built-in Voice Activity Detection (VAD) so it knows when the user starts and stops speaking.

**Overview and concepts**
→ https://ai.google.dev/gemini-api/docs/multimodal-live

**Getting started guide**
→ https://ai.google.dev/gemini-api/docs/live

**Detailed capabilities guide** (VAD, interruptions, transcription, session resumption)
→ https://ai.google.dev/gemini-api/docs/live-guide

**Session management** (how resumption tokens work, context window compression, goAway handling)
→ https://ai.google.dev/gemini-api/docs/live-session

**Full WebSocket API reference** (every message type, field name, and value)
→ https://ai.google.dev/api/multimodal-live

**Vertex AI version** (if deploying on Google Cloud rather than Google AI Studio)
→ https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/live-api

**Sample code repository** (Google's official examples for the Live API)
→ https://github.com/GoogleCloudPlatform/generative-ai/tree/main/gemini/multimodal-live-api

---

## 4. Agent Development Kit (ADK)

ADK is Google's framework for building multi-agent AI systems in Python. We use it to orchestrate the entire research pipeline: a Scan Agent reads the document, then a ParallelAgent runs 5+ Research Subagents simultaneously, then a Script Agent synthesizes everything into documentary segments.

**Official documentation home**
→ https://google.github.io/adk-docs/

**Quickstart** (install, create first agent, run it)
→ https://google.github.io/adk-docs/get-started/quickstart/

**LLM Agents** (the base Agent / LlmAgent class)
→ https://google.github.io/adk-docs/agents/llm-agents/

**Sequential Agents** (run sub-agents one after another, passing results between them)
→ https://google.github.io/adk-docs/agents/workflow-agents/sequential-agents/

**Parallel Agents** (run sub-agents concurrently — this is how we run 5+ researchers at once)
→ https://google.github.io/adk-docs/agents/workflow-agents/parallel-agents/

**Session State** (how agents share data with each other via output_key and {variable} templates)
→ https://google.github.io/adk-docs/sessions/state/

**Streaming to frontend** (the /run_sse endpoint that pushes agent progress to the browser)
→ https://google.github.io/adk-docs/runtime/api-server/

**Deploying ADK to Cloud Run** (one command: adk deploy cloud_run)
→ https://google.github.io/adk-docs/deploy/cloud-run/

**GitHub repository** (source code, issues, examples)
→ https://github.com/google/adk-python

**PyPI package** (pip install google-adk)
→ https://pypi.org/project/google-adk/

---

## 5. Google Search Grounding

This is the built-in `google_search` tool that ADK agents can use to search the web. Each Research Subagent uses this to look up historical facts, find sources, and gather visual reference material. Important constraint: an agent using `google_search` cannot use any other tools simultaneously.

**Google Search tool in ADK**
→ https://google.github.io/adk-docs/integrations/google-search/

**Search grounding in the Gemini API** (broader context on how grounding works)
→ https://ai.google.dev/gemini-api/docs/grounding

---

## 6. Google GenAI SDK (Python)

The main Python SDK for calling Gemini models (Flash, Pro) and image/video generation (Imagen 3, Veo 2) directly. ADK is built on top of this. Used in the Visual Director Agent and for any direct model calls outside the ADK pipeline.

**GitHub and documentation**
→ https://github.com/googleapis/python-genai

**PyPI package** (pip install google-genai)
→ https://pypi.org/project/google-genai/

**API reference**
→ https://googleapis.github.io/python-genai/

---

## 7. Imagen 3 (Image Generation)

Google's image generation model on Vertex AI. Used by the Visual Director Agent to generate historical scenes, maps, portraits, and architectural visuals for each documentary segment. We generate 4 images per segment (16:9 format) and cycle through them with Ken Burns animations.

**Image generation guide** (how to generate images, all parameters)
→ https://cloud.google.com/vertex-ai/generative-ai/docs/image/generate-images

**Imagen 3 model card** (capabilities, limitations, content policies)
→ https://cloud.google.com/vertex-ai/generative-ai/docs/models/imagen/3-0-generate

**API reference** (every parameter: aspectRatio, sampleCount, personGeneration, seed, etc.)
→ https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/imagen-api

---

## 8. Veo 2 (Video Generation)

Google's video generation model on Vertex AI. Used for dramatic scenes that need actual motion — not just panning static images. Generates 5–8 second MP4 clips at 720p. The API is asynchronous: you submit a job and poll for completion (takes 1–2 minutes per video).

**Video generation guide** (text-to-video workflow)
→ https://cloud.google.com/vertex-ai/generative-ai/docs/video/generate-videos-from-text

**Veo 2 model card**
→ https://cloud.google.com/vertex-ai/generative-ai/docs/models/veo/2-0-generate

**API reference** (the predictLongRunning endpoint, all parameters)
→ https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/veo-video-generation

---

## 9. Google Document AI (OCR)

Extracts text from the uploaded historical document (PDF or image). Handles 200+ languages including Arabic script, which is the closest supported language to Ottoman Turkish. Gives us structured output: full text, per-word bounding boxes, detected language codes, and confidence scores.

**Document AI overview**
→ https://cloud.google.com/document-ai/docs/overview

**Processing documents with OCR** (the main workflow)
→ https://cloud.google.com/document-ai/docs/process-documents-ocr

**Supported languages** (check Arabic `ar` and Turkish `tr` entries)
→ https://cloud.google.com/document-ai/docs/languages

**Available processors** (we use OCR_PROCESSOR — Enterprise Document OCR)
→ https://cloud.google.com/document-ai/docs/processors-list

**Python client library** (google-cloud-documentai)
→ https://cloud.google.com/document-ai/docs/process-documents-client-libraries

---

## 10. Google Cloud Run

Serverless container platform where all backend services run. No server management — deploy a container image and it auto-scales. We have three services: the agent orchestrator (Python/ADK), the live relay (Node.js WebSocket proxy), and the main API gateway.

**Cloud Run overview**
→ https://cloud.google.com/run/docs/overview/what-is-cloud-run

**Deploying a container to Cloud Run**
→ https://cloud.google.com/run/docs/deploying

**WebSocket support on Cloud Run** (relevant for the live-relay service)
→ https://cloud.google.com/run/docs/triggering/websockets

**Pricing** (first 2M requests/month free)
→ https://cloud.google.com/run/pricing

---

## 11. Firestore

Google's serverless NoSQL document database. Stores all session state: the documentary graph, research agent logs, segment data, generated image URLs, and live session resumption tokens. The frontend reads from Firestore directly for the Agent Session Modal logs.

**Firestore overview**
→ https://cloud.google.com/firestore/docs/overview

**Data model** (documents, collections, subcollections — how we structure /sessions/{id}/agents/{agentId})
→ https://cloud.google.com/firestore/docs/data-model

**Python client library**
→ https://cloud.google.com/firestore/docs/reference/libraries

**Real-time listeners** (optional: listen to document changes from the frontend)
→ https://cloud.google.com/firestore/docs/query-data/listen

---

## 12. Cloud Storage (GCS)

Object storage for everything that isn't structured data: uploaded documents, generated images from Imagen 3, generated MP4 videos from Veo 2, and audio files. Accessed by the frontend via signed URLs (time-limited download links).

**Cloud Storage overview**
→ https://cloud.google.com/storage/docs/introduction

**Signed URLs** (how the browser uploads directly to GCS without going through our backend)
→ https://cloud.google.com/storage/docs/signed-urls

**Accessing public objects** (serving images to the documentary player)
→ https://cloud.google.com/storage/docs/access-control/making-data-public

---

## 13. Cloud Pub/Sub

Async messaging between services. When a research agent finishes, it publishes a message. The frontend SSE relay picks it up and pushes a status update to the browser. Decouples the agent pipeline from the API layer so slow Veo 2 video generation doesn't block anything.

**Pub/Sub overview**
→ https://cloud.google.com/pubsub/docs/overview

**Publisher guide**
→ https://cloud.google.com/pubsub/docs/publisher

**Subscriber guide**
→ https://cloud.google.com/pubsub/docs/subscriber

---

## 14. Vertex AI (Platform)

The Google Cloud platform that hosts Imagen 3 and Veo 2. Also the enterprise path for running Gemini models with higher quotas and SLAs. All image and video generation calls go through Vertex AI endpoints.

**Vertex AI overview**
→ https://cloud.google.com/vertex-ai/docs/start/introduction-unified-platform

**Generative AI on Vertex AI** (Gemini, Imagen, Veo all in one place)
→ https://cloud.google.com/vertex-ai/generative-ai/docs/overview

**Vertex AI model garden** (browse all available models)
→ https://cloud.google.com/vertex-ai/generative-ai/docs/model-garden/explore-models

---

## 15. Secret Manager

Stores API keys and credentials securely. Our services pull secrets at runtime (Gemini API key, service account credentials) rather than hardcoding them in environment variables or code.

**Secret Manager overview**
→ https://cloud.google.com/secret-manager/docs/overview

**Accessing secrets from Cloud Run**
→ https://cloud.google.com/run/docs/configuring/services/secrets

---

## 16. Terraform (Infrastructure as Code)

Declares all our Google Cloud resources as code: Cloud Run services, Firestore database, GCS buckets, Pub/Sub topics, Secret Manager secrets. Running `terraform apply` recreates the entire infrastructure from scratch. This also qualifies for the +0.2 bonus points on automated deployment.

**Terraform overview**
→ https://developer.hashicorp.com/terraform/intro

**Google Cloud provider for Terraform** (all the google_* resource types we use)
→ https://registry.terraform.io/providers/hashicorp/google/latest/docs

**Cloud Run resource** (google_cloud_run_v2_service)
→ https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/cloud_run_v2_service

**Firestore resource** (google_firestore_database)
→ https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/firestore_database

---

## 17. pdf.js (Frontend PDF Rendering)

Mozilla's open-source library for rendering PDF files directly in the browser without any plugins. Used for the PDF viewer panel where the user reads the document while AI research runs in parallel.

**Official site and documentation**
→ https://mozilla.github.io/pdf.js/

**npm package** (pdfjs-dist)
→ https://www.npmjs.com/package/pdfjs-dist

**Getting started guide**
→ https://mozilla.github.io/pdf.js/getting_started/

---

## 18. Web Audio API (Browser)

The browser's built-in audio processing API. Used by Berkay's voice layer to capture microphone input, encode it as PCM, visualize waveforms, and play back audio chunks received from the Gemini Live API session.

**MDN Web Audio API guide** (the definitive reference)
→ https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API

**AudioWorklet** (the modern way to process audio in a separate thread)
→ https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet

**AnalyserNode** (used for the waveform visualizer)
→ https://developer.mozilla.org/en-US/docs/Web/API/AnalyserNode

**getUserMedia** (accessing the microphone)
→ https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia

---

## 19. Google Developer Group (Bonus Points)

Joining GDG gives +0.2 bonus points on the final score. Both Berkay and Efe need to join and include their public profile links in the Devpost submission.

**Find your local GDG chapter and join**
→ https://gdg.community.dev/

---

## 20. Google AI Studio (Testing & Quotas)

The web interface for testing Gemini models, managing API keys, and checking your rate limits. Before writing any code, it's worth testing prompts here to understand model behavior. Also where you create the API key for development.

**Google AI Studio**
→ https://aistudio.google.com/

**Rate limits dashboard** (check your actual RPM/TPD limits per model)
→ https://aistudio.google.com/rate-limit

**API keys**
→ https://aistudio.google.com/apikey

---

## 21. Google Cloud Console

The main dashboard for managing all Google Cloud services: enabling APIs, creating Cloud Run services, viewing Firestore data, managing GCS buckets, and monitoring costs.

**Google Cloud Console**
→ https://console.cloud.google.com/

**Enable required APIs** (you need to enable these in your project before any service works)

| API | Enable Link |
|---|---|
| Gemini API (AI Studio) | https://console.cloud.google.com/apis/library/generativelanguage.googleapis.com |
| Vertex AI API | https://console.cloud.google.com/apis/library/aiplatform.googleapis.com |
| Document AI API | https://console.cloud.google.com/apis/library/documentai.googleapis.com |
| Cloud Run API | https://console.cloud.google.com/apis/library/run.googleapis.com |
| Firestore API | https://console.cloud.google.com/apis/library/firestore.googleapis.com |
| Cloud Storage API | https://console.cloud.google.com/apis/library/storage.googleapis.com |
| Pub/Sub API | https://console.cloud.google.com/apis/library/pubsub.googleapis.com |
| Secret Manager API | https://console.cloud.google.com/apis/library/secretmanager.googleapis.com |
