# Document Analysis & Visual Research Orchestrator — Design Document

**Date:** 2026-03-08
**Status:** Approved for implementation
**Owner:** Efe
**Scope:** Full pipeline from document upload through segment creation and visual prompt enrichment

---

## Problem Statement

Three compounding problems exist in the original pipeline design:

1. **Long document ingestion** — A historical PDF may contain 50,000–200,000 tokens. Feeding the full text to any single agent collapses fine-grained details into generic summaries. The model reads everything and remembers little.
2. **Arbitrary segment structure** — The original design creates segments from research output, not from the document itself. The result is generic thematic segments, not scenes grounded in what the document actually says.
3. **Visual prompt shallowness** — The Visual Director receives a single synthesized description and calls Imagen 3 with no external grounding. Without period-accurate visual references, generations trend toward AI-generic imagery rather than historically specific scenes.

The solution addresses all three in sequence: first understand the document properly, then curate scenes from it, then deeply research each scene's visual context.

---

## Design Goals

| Goal | Constraint |
|---|---|
| Handle arbitrarily long PDFs without context collapse | MapReduce pattern: chunk → summarize in parallel → map → curate |
| Segments emerge from the document, not from generic research | Narrative Curator reads the document map, selects 4–8 cinematically compelling moments |
| Per-scene research grounded in the document's own claims | Each segment's research agents receive their specific source chunks as context |
| Zero information loss per external source | Each external source gets its own isolated Gemini call at every stage |
| First segment playable in < 45 seconds | Progressive delivery: Segment 1 uses a fast path, others run in background |
| Full ADK visibility for competition judges | Custom `BaseAgent` subclass for the orchestrator — not hidden inside tools |
| Rich SSE streaming throughout | One event per meaningful state change across all phases |

---

## Full Pipeline Overview

```
USER UPLOADS PDF
      │
      ▼
══════════════════════════════════════════
  PHASE I — DOCUMENT ANALYSIS
══════════════════════════════════════════
      │
      ├── [1] OCR Agent
      │         Document AI extracts full text, preserving layout
      │         Stores raw text in GCS (not passed forward directly)
      │
      ├── [2] Semantic Chunker
      │         Splits full text into logical sections
      │         Each chunk stored in Firestore as a ChunkRecord
      │         No AI call — rule-based (headings, blank lines, page markers)
      │
      ├── [3] Chunk Summarizer  ← ParallelAgent, one sub-call per chunk
      │         Gemini 2.0 Flash × N (one per chunk, isolated contexts)
      │         Each call: "Summarise this section in 3–5 sentences. Preserve
      │                     names, dates, places, and specific events exactly."
      │         Output: ChunkSummary per chunk → stored in Firestore
      │
      └── [4] Narrative Curator
                Gemini 2.0 Pro reads the full Document Map (all summaries combined)
                Selects 4–8 cinematically compelling moments or turning points
                For each: writes a Scene Brief referencing the source chunk IDs
                Output: session.state["scene_briefs"]  → list of SceneBrief
                Stores scene_briefs in Firestore for traceability

══════════════════════════════════════════
  PHASE II — SCENE RESEARCH
══════════════════════════════════════════
      │
      └── [5] ParallelAgent [SceneResearchAgent × N scenes]
                Each agent receives: SceneBrief + its source ChunkRecords (from Firestore)
                Uses google_search to find external corroboration of the specific
                claims, people, and events described in that scene's chunks
                Output: per-scene research facts → session.state["research_{n}"]

══════════════════════════════════════════
  PHASE III — SCRIPT
══════════════════════════════════════════
      │
      └── [6] Script Agent
                Reads all scene research + all scene briefs
                Writes narration, mood, visual description per scene
                Output: session.state["script"]  → list of SegmentScript

══════════════════════════════════════════
  PHASE IV — VISUAL RESEARCH
══════════════════════════════════════════
      │
      └── [7] VisualResearchOrchestrator  ← custom BaseAgent subclass
                For each segment: runs per-source micro-pipeline
                Produces VisualDetailManifest per segment
                Output: session.state["visual_research_manifest"]

══════════════════════════════════════════
  PHASE V — GENERATION
══════════════════════════════════════════
      │
      └── [8] Visual Director
                Reads manifests → calls Imagen 3 / Veo 2 per segment
```

---

## Phase I — Document Analysis (Detailed)

### Step 1 — OCR Agent

- Calls Document AI `OCR_PROCESSOR` on the uploaded GCS file
- Preserves: paragraph boundaries, heading markers, page numbers, table structure
- Stores raw extracted text in GCS as `{sessionId}/ocr_raw.txt`
- Does NOT pass raw text forward in session state — too large
- Writes only: `session.state["gcs_ocr_path"]` and `session.state["total_pages"]`

### Step 2 — Semantic Chunker

This step is **not** an AI call. It is a deterministic Python function that splits the OCR text into logical sections using rule-based heuristics:

**Split signals (in priority order):**
1. Detected headings (all-caps line, or line followed by blank line, or numbered section)
2. Major topic shifts (blank line + new paragraph starting with a proper noun or date)
3. Page break markers from Document AI output
4. Hard fallback: every 800 tokens if no structural signal found

**Output per chunk:**
```
ChunkRecord {
  chunk_id:     string          (e.g., "chunk_003")
  session_id:   string
  sequence:     int             (order in document)
  page_start:   int
  page_end:     int
  raw_text:     string          (the actual content)
  char_count:   int
  heading:      string | null   (detected section heading, if any)
}
```

Each ChunkRecord is written to Firestore at `/sessions/{sessionId}/chunks/{chunkId}`.
No chunk is passed through session state — only chunk IDs are.

**Why rule-based, not AI-based:** Speed and determinism. The chunker runs in milliseconds and produces consistent splits. An AI chunker would add 2–5 seconds and introduce non-determinism with no quality benefit at this stage.

### Step 3 — Chunk Summarizer

A `ParallelAgent` with one sub-call per chunk. Each call is independent:

- **Model:** Gemini 2.0 Flash
- **Input:** `chunk.raw_text` only (no other chunks in context — strict isolation)
- **Instruction:** "Summarise this section in 3–5 sentences. Preserve all proper names, dates, place names, and specific events exactly as written. Do not interpret or add context. If the section contains a list or table, describe its contents concisely."
- **Output:** Plain text summary (100–200 tokens)
- **Written to:** Firestore `/sessions/{sessionId}/chunks/{chunkId}` — adds `summary` field

After all parallel calls complete, the orchestrator reads all summaries from Firestore and concatenates them (in sequence order) into the **Document Map** — a structured outline of the full document that fits in a single Gemini context window regardless of the original document length.

The Document Map is stored in `session.state["document_map"]`.

### Step 4 — Narrative Curator

- **Model:** Gemini 2.0 Pro
- **Input:** Full Document Map + Visual Bible (language, tone, style preferences from session)
- **Task:** "You are a documentary director. Read this document map and select 4–8 moments that would make compelling, visually distinct documentary scenes. Prioritise: narrative turning points, moments of high contrast (before/after, conflict/resolution), scenes with strong visual specificity, and moments that a general audience would find emotionally resonant. For each selected scene, write a Scene Brief."

**Scene Brief structure:**
```
SceneBrief {
  scene_id:          string        (e.g., "scene_002")
  title:             string        (working title for the scene)
  document_excerpt:  string        (the key passage from the document, verbatim)
  source_chunk_ids:  string[]      (which ChunkRecords contain the relevant material)
  era:               string        (time period, as specific as possible)
  location:          string        (geographic setting)
  key_entities:      string[]      (people, objects, events central to this scene)
  narrative_role:    string        (opening | rising_action | climax | resolution | coda)
  cinematic_hook:    string        (one sentence: why this scene works visually)
  mood:              string        (the emotional register: tense, elegiac, triumphant, etc.)
}
```

Stored in `session.state["scene_briefs"]` and in Firestore `/sessions/{sessionId}/sceneSelections`.

**Why Gemini 2.0 Pro here:** The curation step is the single most consequential editorial decision in the pipeline. The quality of every downstream scene depends on what is selected here. Pro's superior reasoning justifies the extra latency (3–6 seconds) at this step.

---

## Phase II — Scene Research (Detailed)

Each `SceneResearchAgent` receives:
- Its `SceneBrief`
- The full text of its `source_chunk_ids` chunks (fetched from Firestore — this is the specific section of the original document the scene is based on)
- The Document Map (for cross-document context)

The agent uses `google_search` to find **external corroboration** of claims in the scene's chunks. It is not doing general era research — it is verifying and expanding the specific claims, people, and events in that scene's actual text.

**Example:** If Chunk 3 mentions "the Ottoman governor Halil Pasha signed a trade agreement in Thessaloniki in 1762," the research agent searches for "Halil Pasha Ottoman governor 1762" and "Thessaloniki trade agreements 18th century" — not for general Ottoman history.

Output follows the existing `research_{n}` pattern. No changes to downstream aggregator or script agent required.

---

## Phase IV — Visual Research Orchestrator (Detailed)

This is the custom `BaseAgent` subclass introduced in the original design doc, now updated to consume `SceneBrief` data in addition to `SegmentScript` data.

### Progressive Delivery

Two tracks run simultaneously:

**Track 1 — Fast Path (Scene 1 only)**
- Cap: 3 sources, webpages only (no PDF fetching, no Document AI)
- Target: manifest written within 35 seconds of Phase IV starting
- Exits early: as soon as 2 sources pass both evaluations, extraction begins

**Track 2 — Deep Path (Scenes 2–N)**
- 8–10 sources per scene, including PDFs and image archives
- Runs concurrently in background while user watches Scene 1
- Each scene's manifest written to state as it completes

### Per-Scene Micro-Pipeline

For each scene, the orchestrator runs this sequence. All sources within a stage run via `asyncio.gather`.

```
Scene Brief + Source Chunks (from Phase I)
     │
     ▼
[Stage 0] Query Generation
     │  Model: Gemini 2.0 Flash
     │  Input: scene brief (era, location, key_entities, mood, cinematic_hook)
     │         + verbatim document_excerpt from SceneBrief
     │  Output: 4–6 targeted visual reference search queries
     │  Queries are specific: "Ottoman bazaar 1750 archival photograph"
     │                        "18th century Thessaloniki market woodcut illustration"
     │                        NOT: "Ottoman Empire history"
     │
     ▼
[Stage 1] Source Discovery
     │  Calls google_search for each query (ADK google_search tool)
     │  Deduplicates by domain, caps at 10 URLs (3 for fast path)
     │  Output: list of { url, title, snippet }
     │
     ▼
[Stage 2] Type Detection  ← per source, parallel
     │  Model: Gemini 2.0 Flash (one call per URL, isolated)
     │  Classifies: webpage | pdf | image | wikipedia | dataset | unknown
     │  Output: typed source list
     │
     ▼
[Stage 3] Content Fetch  ← per source, parallel, type-routed
     │  webpage    → httpx GET → BeautifulSoup text extraction
     │  pdf        → Document AI OCR (async) — full text, layout preserved
     │               NOTE: large PDFs are chunked before evaluation (see below)
     │  image      → Vertex AI Vision API → structured visual description
     │  wikipedia  → Wikipedia REST API → structured JSON (no extraction needed)
     │  unknown    → httpx GET → plain text
     │  Output: { url, type, content }
     │
     │  PDF CHUNKING (for fetched PDFs only):
     │  If fetched PDF text > 4,000 tokens:
     │    Split into sections using the same rule-based chunker from Phase I
     │    Each section gets its own evaluation call in Stage 4
     │    Accept/reject decision is per-section, not per-document
     │    Only relevant sections proceed to extraction
     │
     ▼
[Stage 4] Dual Evaluation  ← per source (or per PDF section), parallel
     │
     │  Call A — Quality Evaluation
     │    Model: Gemini 2.0 Flash
     │    Input: source content ONLY (no other sources in context)
     │    Scores (1–10 each):
     │      authority      — institutional, primary source, peer-reviewed?
     │      detail_density — specific visual language vs. generic overview?
     │      era_accuracy   — contemporary to the depicted period?
     │    Reject threshold: any score < 5
     │    Emit: agent_source_evaluation SSE event (quality scores, accept/reject)
     │
     │  Call B — Relevance Evaluation (accepted sources only)
     │    Model: Gemini 2.0 Flash
     │    Input: source content + full SceneBrief (title, era, location,
     │           key_entities, cinematic_hook, document_excerpt)
     │    Output:
     │      relevance_score     int (1–10)
     │      relevant_passages   string[]  (verbatim quotes — NOT summaries)
     │    Reject threshold: relevance_score < 7
     │    Emit: agent_source_evaluation SSE event (relevance scores, final decision)
     │
     ▼
[Stage 5] Targeted Detail Extraction  ← per accepted source/section, parallel
     │  Model: Gemini 2.0 Flash
     │  Input: relevant_passages from Stage 4 (not full source) + SceneBrief
     │  NOTE: Only relevant_passages are passed — never the full source text.
     │        This enforces zero information loss without context overload.
     │  Output: VisualDetailFragment
     │    lighting:       string[]   ("side-lit by oil lamp", "golden afternoon haze")
     │    materials:      string[]   ("worn oak floorboards", "brass filigree detail")
     │    color_palette:  string[]   ("burnt sienna", "verdigris patina", "deep ochre")
     │    architecture:   string[]   ("low vaulted ceiling", "pointed archway")
     │    clothing:       string[]   ("embroidered kaftan collar", "rough-spun linen")
     │    atmosphere:     string[]   ("dusty, market noise implied by visual density")
     │    era_markers:    string[]   ("oil lanterns only", "no mechanical clocks visible")
     │
     ▼
[Stage 6] Manifest Synthesis  ← one call per scene
     │  Model: Gemini 2.0 Pro
     │  Input: all VisualDetailFragments merged and deduplicated
     │         + SceneBrief (for context and coherence)
     │  Output: VisualDetailManifest
     │    scene_id:           string
     │    enriched_prompt:    string   (200–400 word Imagen 3 prompt)
     │    detail_fields:      merged VisualDetailFragment
     │    sources_accepted:   int
     │    sources_rejected:   int
     │    reference_sources:  EvaluatedSource[]
     │
     └── Written to session.state["visual_research_manifest"][scene_id]
         Stored in Firestore /sessions/{sessionId}/visualManifests/{sceneId}
         Emits: segment_update SSE event → frontend shows scene as ready
```

---

## Data Structures

### ChunkRecord (Firestore)
```
chunk_id:        string
session_id:      string
sequence:        int
page_start:      int
page_end:        int
raw_text:        string
char_count:      int
heading:         string | null
summary:         string          (added by Chunk Summarizer)
```

### SceneBrief (session.state + Firestore)
```
scene_id:          string
title:             string
document_excerpt:  string          (verbatim passage from the document)
source_chunk_ids:  string[]
era:               string
location:          string
key_entities:      string[]
narrative_role:    opening | rising_action | climax | resolution | coda
cinematic_hook:    string
mood:              string
```

### VisualDetailFragment (in-memory, not persisted)
```
lighting:       string[]
materials:      string[]
color_palette:  string[]
architecture:   string[]
clothing:       string[]
atmosphere:     string[]
era_markers:    string[]
```

### VisualDetailManifest (Firestore + session.state)
```
scene_id:            string
enriched_prompt:     string
detail_fields:       VisualDetailFragment
sources_accepted:    int
sources_rejected:    int
reference_sources:   EvaluatedSource[]
  url:               string
  title:             string
  type:              webpage | pdf | image | wikipedia | dataset
  accepted:          bool
  quality_scores:    { authority, detail_density, era_accuracy }
  relevance_score:   int
  reason:            string
```

---

## Firestore Schema Additions

```
/sessions/{sessionId}/chunks/{chunkId}         ← ChunkRecord
/sessions/{sessionId}/sceneSelections          ← SceneBrief[]
/sessions/{sessionId}/visualManifests/{sceneId} ← VisualDetailManifest
```

---

## SSE Event Flow

| Event | Phase | Frontend effect |
|---|---|---|
| `pipeline_phase` — TRANSLATION & SCAN | Phase I starts | Expedition Log: Phase I |
| `pipeline_phase` — FIELD RESEARCH | Phase II starts | Expedition Log: Phase II |
| `pipeline_phase` — SYNTHESIS | Phase III starts | Expedition Log: Phase III |
| `pipeline_phase` — VISUAL COMPOSITION | Phase IV starts | Expedition Log: Phase IV |
| `agent_status` — searching | Each scene's Stage 1 begins | AgentCard dot turns teal |
| `agent_source_evaluation` | Each Stage 4 evaluation | AgentModal Sources Dispatched updates live |
| `agent_status` — evaluating | Each scene's Stage 5 begins | AgentCard dot turns gold |
| `agent_status` — done | Manifest written for scene | AgentCard dot turns green |
| `segment_update` — ready | Manifest written | SegmentCard reveals content |
| `stats_update` | Per accepted/rejected source | Stats bar counters flash gold |

---

## Visual Director Integration

The Visual Director reads `session.state["visual_research_manifest"]` for each scene:

1. **Enriched prompt exists** → use `enriched_prompt` + Visual Bible prefix as Imagen 3 prompt
2. **No manifest** (error or timeout) → fall back to `visual_description` from Script Agent output
3. **Era markers** → appended as "Exclude from image: ..." clauses to prevent anachronisms

The fallback ensures no scene ever blocks, even if the orchestrator fails for that scene.

---

## Files to Create / Modify

### New Files
| File | Purpose |
|---|---|
| `backend/agent_orchestrator/agents/document_analyzer.py` | Steps 1–4: OCR, chunker, summarizer, narrative curator |
| `backend/agent_orchestrator/agents/chunk_types.py` | Pydantic v2: `ChunkRecord`, `SceneBrief`, `DocumentMap` |
| `backend/agent_orchestrator/agents/visual_research_orchestrator.py` | Custom `BaseAgent` — full visual research orchestrator |
| `backend/agent_orchestrator/agents/visual_research_stages.py` | Stage functions: query gen, fetch, evaluate, extract, synthesize |
| `backend/agent_orchestrator/agents/visual_detail_types.py` | Pydantic v2: `VisualDetailFragment`, `VisualDetailManifest`, `EvaluatedSource` |

### Modified Files
| File | Change |
|---|---|
| `backend/agent_orchestrator/agents/pipeline.py` | Replace current scan_agent with document_analyzer; insert visual_research_orchestrator before visual_director |
| `backend/agent_orchestrator/agents/visual_director.py` | Read from manifest; use enriched_prompt; apply era_markers |
| `backend/agent_orchestrator/agents/visual_research_agent.py` | Superseded by visual_research_orchestrator — remove or merge |

### Already Done (no changes needed)
| File | Status |
|---|---|
| `frontend/src/types/index.ts` | `EvaluatedSource`, `AgentSourceEvaluationEvent`, new `AgentState` fields already added |
| `frontend/src/components/workspace/AgentModal.tsx` | Sources Dispatched + Field Log + Visual Prompt sections already built |
| `frontend/src/store/researchStore.ts` | `addEvaluatedSource()` already added |
| `frontend/src/hooks/useSSE.ts` | `agent_source_evaluation` handler already wired |

---

## Open Questions (resolve during implementation)

1. **Document AI async client** — Confirm the Python async client (`document_ai_v1.DocumentProcessorServiceAsyncClient`) supports `await process_document()` without blocking the event loop.

2. **google_search result format** — The ADK `google_search` tool returns a fixed number of snippets. Confirm whether result URLs are included in the response (needed for Stage 3 fetch), or if only text snippets are returned.

3. **Narrative Curator scene count** — Is 4–8 scenes a hard limit or a soft target? If the document has very rich content, should the curator be allowed to produce 10? Decision affects `SegmentCard` scroll area sizing.

4. **Imagen 3 negative prompt support** — Confirm `imagen-3.0-fast-generate-001` `GenerateImagesConfig` accepts a `negative_prompt` field. If not, prepend "Avoid: {era_markers joined}" to the main prompt.

5. **Chunk summarizer parallelism limit** — If a document has 40 chunks, the ParallelAgent spawns 40 simultaneous Gemini Flash calls. Confirm Gemini API rate limits allow this or add a semaphore-based concurrency cap (suggest max 10 concurrent).
