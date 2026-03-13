# Product Requirements Document (PRD)
## AI Historian — Living Documentary Engine

**Version:** 1.0
**Date:** March 7, 2026
**Hackathon:** Gemini Live Agent Challenge (Deadline: March 16, 2026)
**Prize Target:** Grand Prize ($25,000) + Creative Storyteller Category ($10,000)

---

## 1. Product Vision

**AI Historian** is a real-time multimodal research and documentary engine that transforms any historical document — in any language — into a living, interactive documentary you can hold a conversation with mid-playback.

> Upload a document. Watch AI agents research it in real time. The documentary generates while you read. Then watch and talk to it.

This is not a chatbot. It is not a video editor. It is the first system where a **live AI agent persona** researches, writes, narrates, and converses simultaneously — making the historian itself an interactive entity that adapts to questions mid-stream.

---

## 2. Problem Statement

Historians, researchers, educators, and curious people encounter ancient documents every day that are:

- Written in dead or foreign scripts (Ottoman Turkish, Classical Arabic, Latin, Old Persian)
- Locked inside static PDF scans with no context
- Disconnected from the rich visual and historical world around them
- Impossible to explore conversationally without deep domain expertise

Existing solutions either translate passively (Google Translate), generate static summaries (ChatGPT), or require expensive production pipelines (documentary film). None of them are **live**, **interactive**, or **multimodal** in real time.

---

## 3. Target Users

### Primary: Academic Researchers & Historians
- Work with primary sources in multiple languages
- Need rapid contextual enrichment of documents
- Value accuracy and source attribution

### Secondary: Educators & Students
- Teaching history with primary sources
- Need engaging multimedia to hold student attention
- Want to explore documents interactively in class

### Tertiary: Journalists & Cultural Institutions
- Archivists processing historical collections
- Journalists investigating historical context of current events
- Museums wanting interactive exhibits from document collections

---

## 4. Core Value Proposition

| Old Way | AI Historian |
|---|---|
| Upload → wait for translation → read static text | Upload → read PDF immediately while AI researches in parallel |
| Watch a pre-produced documentary | Watch a documentary generate in real time, segment by segment |
| Pause documentary to Google a question | Speak your question mid-playback, historian answers without stopping |
| Linear, fixed narrative | Branching documentary graph that adapts to your conversation |
| One language, one context | Any language, multilingual OCR, cross-cultural research |

---

## 5. Feature Requirements

### F1 — Document Ingestion (Priority: P0)
- Drag-and-drop upload for PDF, image (JPG/PNG/TIFF), and text files
- Support for: Arabic script, Ottoman Turkish, Latin, Persian, Greek, Hebrew, Cyrillic
- Immediate PDF viewer display on upload (no waiting)
- Document AI OCR with confidence scoring per text block
- Visual gap detection: identify regions that need visual enrichment

### F2 — Parallel Research Pipeline (Priority: P0)
- Scan Agent: reads document structure, identifies entities, gaps, and research targets
- Minimum 5 parallel Research Subagents spawned via ADK
- Each subagent: Google Search Grounding → source evaluation → fact extraction → visual prompt building
- Research activity panel showing live subagent status (queued → searching → done)
- Clickable research items: open agent session popup showing full step-by-step agent log
- Research completes while user reads — zero forced waiting

### F3 — Documentary Generation (Priority: P0)
- Script Agent generates narration scripts per segment from enriched research context
- Visual Director Agent builds Imagen 3 / Veo 2 prompts with Visual Bible for consistency
- Segments stream into UI as they complete (generating → ready states)
- Ken Burns CSS animation for static images (pan/zoom with parallax layers)
- Veo 2 integration for key dramatic scenes requiring motion
- Segment cards clickable to launch documentary player

### F4 — Gemini Live Agent Persona (Priority: P0 — Core Differentiator)
- Persistent bidirectional WebSocket session via Gemini Live API
- Historian persona with consistent voice and speaking style
- Always-on listening (VAD) — user can speak at any moment
- Mid-stream interruption: user speech pauses historian narration
- Historian processes question in context, responds, then resumes documentary
- Floating voice button accessible from workspace and documentary player
- Live audio waveform visualization during historian speech

### F5 — Interactive Documentary Player (Priority: P0)
- Full-screen cinematic player with layered visual compositions
- Caption display with typewriter animation synced to audio
- Segment navigation sidebar
- Historian sidebar with live transcript during playback
- Mid-playback Q&A without leaving player
- Back navigation to workspace for further research

### F6 — Dynamic Documentary Graph (Priority: P1)
- Documentary is not linear — structured as a traversable node graph
- User questions during playback can redirect the narrative
- New segments generated on-demand for unexplored branches
- Graph state persisted in Firestore per session

### F7 — Multilingual Support (Priority: P1)
- Document AI handles OCR for all supported scripts
- Gemini 2.0 Flash performs cross-lingual document analysis
- Research agents search in the document's original cultural context
- Historian narration in user's preferred language (independent of document language)

### F8 — Session Persistence (Priority: P2)
- Sessions saved to Firestore with full documentary graph
- Resume from any segment
- Share documentary links

---

## 6. Success Metrics

### Hackathon Judging Alignment
| Criterion | Weight | Our Approach |
|---|---|---|
| Innovation & Multimodal UX | 40% | Live agent persona + real-time gen + mid-stream voice Q&A |
| Technical Implementation | 30% | ADK multi-agent, Gemini Live API, Cloud Run, Firestore, GCS |
| Demo & Presentation | 30% | 4-min video showing full pipeline end to end |

### Product Metrics (Post-Hackathon)
- Time from upload to first playable segment: < 45 seconds
- Research subagent accuracy (source quality): > 80% accepted sources
- Voice interruption latency (speak → historian responds): < 1.5 seconds
- Documentary visual consistency score (human eval): > 4/5

---

## 7. Technical Stack Summary

### AI & Agents
- **Gemini 2.0 Flash** — fast document scan, OCR analysis, entity extraction
- **Gemini 2.0 Pro** — complex reasoning, script generation, multi-turn conversation
- **Gemini Live API** — persistent audio WebSocket, VAD, interruption handling
- **ADK (Agent Development Kit)** — multi-agent orchestration, parallel subagents
- **Google Search Grounding** — factual web research with citations
- **Imagen 3** (`imagen-3.0-generate-002` / `imagen-3.0-fast-generate-001`) — visual generation for scenes, maps, portraits
- **Veo 2** (`veo-2.0-generate-001`, GA) — async video generation for dramatic scenes (720p, 5–8s clips, 1–2 min generation time)

### Google Cloud Infrastructure
- **Cloud Run** — backend API + agent orchestration services
- **Firestore** — documentary graph state, session data, agent logs
- **Cloud Storage (GCS)** — uploaded documents, generated images, audio files
- **Document AI** — multilingual OCR, layout analysis
- **Pub/Sub** — async agent messaging and event streaming
- **Vertex AI** — model hosting for Imagen 3, Veo 2

### Frontend
- **React + TypeScript** — main application
- **WebSocket** — Gemini Live API real-time connection
- **Web Audio API** — microphone capture, waveform visualization
- **CSS Ken Burns animations** — pan/zoom visual effects

---

## 8. Hackathon Category Fit

**Primary: Creative Storyteller** — multimodal output combining text (research), images (Imagen 3), audio/video (Veo 2 + Gemini Live narration), and real-time generation in a seamless flow.

**Secondary: Live Agents** — real-time audio interaction with the historian persona, natural conversation with interruption handling, always-on listening via Gemini Live API.

This dual-category positioning maximizes prize eligibility.

---

## 9. Bonus Points Strategy (Critical — Max +1.0 to Final Score)

| Bonus | Points | Action Required |
|---|---|---|
| Published content (blog/video about how we built it) | **+0.6** | Publish on Medium/YouTube during dev; include #GeminiLiveAgentChallenge + disclosure |
| Automated Cloud deployment (Terraform/IaC) | **+0.2** | Add `terraform/` folder with Cloud Run + Firestore + GCS definitions |
| Google Developer Group membership | **+0.2** | Both team members join GDG and include profile link in submission |

**+0.6 is the largest individual bonus — equivalent to 12% of a 5-point base score.** This should be prioritized during development. Write a build blog post on Medium while coding, not after.

### Disqualification Risks to Avoid
- ❌ Backend NOT on Google Cloud → immediate fail
- ❌ Using raw REST instead of GenAI SDK or ADK → likely fails gate
- ❌ Demo video > 4 minutes → hard disqualification
- ❌ Demo shows mockups instead of working software → zero on demo criterion
- ❌ Private repo or missing README setup instructions → fail
- ❌ Missing architecture diagram → fail the submission gate
- ❌ Pre-existing project (must be new since Feb 16, 2026)

### Competition Scale
- **7,300+ registered participants** — highly competitive
- **9 days remaining** (as of March 7, 2026)
- A project can only win **one prize** maximum
- Grand Prize ($25K) goes to overall highest scorer regardless of category

## 10. Demo Script (4-Minute Video Plan)

| Timestamp | Scene | What It Shows |
|---|---|---|
| 0:00–0:20 | Problem intro (voiceover) | Ancient Ottoman document, nobody can read it |
| 0:20–0:45 | Upload + workspace appears | PDF renders immediately, research agents spawn |
| 0:45–1:30 | Research activity live | Click a subagent item → see agent session log animate |
| 1:30–2:00 | Segments completing | Generating → ready cards, segments streaming |
| 2:00–2:45 | Documentary player | Cinematic visual, historian narrating, captions |
| 2:45–3:15 | Voice interruption demo | User speaks mid-documentary, historian responds |
| 3:15–3:45 | Architecture diagram | Cloud Run, ADK, Gemini Live, Firestore explained |
| 3:45–4:00 | Call to action | Prize category, GitHub link, team |

---

## 11. Out of Scope (v1 Hackathon)

- User accounts and authentication (single anonymous session)
- Document editing or annotation
- Multi-user collaborative documentary
- Export to downloadable video file
- Mobile native app (responsive web only)
- Real-time collaborative research with other users
