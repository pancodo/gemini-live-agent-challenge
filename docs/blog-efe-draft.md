# From Ottoman Manuscript to AI Documentary: Building a 7-Agent Research Pipeline with Google ADK

*This post was written as part of my submission to the [Gemini Live Agent Challenge](https://geminiliveagentchallenge.devpost.com/) hackathon, organized by Google LLC and administered by Devpost.*

---

Upload a 400-year-old Ottoman manuscript written in Arabic script. Forty-five seconds later, watch the first segment of a cinematic documentary about it — narrated by an AI historian you can interrupt and question at any time, illustrated with period-accurate generated images, backed by corroborated research from real web sources.

That is **AI Historian**. This post covers the engine behind it: a 7-agent pipeline built on Google's Agent Development Kit (ADK) that transforms any historical document into a structured documentary, streaming progress to the frontend in real time.

## The Pipeline at a Glance

```
Document Analyzer → Scene Research (parallel) → Aggregator
→ Script Agent → Fact Validator → Visual Storyboard Planner
→ Visual Research → Visual Director
```

Each stage is a custom `BaseAgent` subclass in Google ADK. State flows between agents via `session.state["key"]` — ADK's built-in state sharing mechanism. The entire pipeline is wrapped in a `ResumablePipelineAgent` that checkpoints to Firestore after each phase, so a crash at Phase IV resumes from Phase IV, not from the beginning.

Here is the function that wires everything together:

```python
def build_new_pipeline(emitter=None) -> ResumablePipelineAgent:
    document_analyzer = build_document_analyzer(emitter=emitter)
    scene_research = build_scene_research_orchestrator(emitter=emitter)
    script_orch = build_script_agent_orchestrator(emitter=emitter)
    fact_validator = build_fact_validator_agent(emitter=emitter)
    visual_planner = build_narrative_visual_planner(emitter=emitter)
    visual_research_orch = build_visual_research_orchestrator(emitter=emitter)
    visual_director_orch = build_visual_director_orchestrator(emitter=emitter)

    return ResumablePipelineAgent(
        name="historian_pipeline",
        sub_agents=[
            document_analyzer,        # Phase I
            scene_research,           # Phase II
            _make_aggregator_agent(), # Phase II (aggregator)
            script_orch,              # Phase III
            fact_validator,           # Phase III.5
            visual_planner,           # Phase 4.0
            visual_research_orch,     # Phase IV
            visual_director_orch,     # Phase V
        ],
    )
```

Every agent receives the same `emitter` — an SSE channel that streams structured events to the frontend. More on that later.

## Phase I — Document Analysis: OCR to Scene Briefs

The pipeline starts with Google Document AI's `OCR_PROCESSOR`, which handles 200+ languages including Arabic, Ottoman Turkish, and Classical Chinese. The raw OCR text goes through a deterministic Python chunker — not an LLM call. It splits on page breaks (`\f`), detected headings, topic shifts, and a 3,200-character hard fallback. Fast and predictable.

Each chunk is then summarized in parallel using Gemini 2.0 Flash, bounded by `asyncio.gather` with a `Semaphore(10)` to respect rate limits. The summaries form a `DocumentMap` — a structured outline of the entire source document.

The interesting part is the **Narrative Curator**: an ADK Agent running Gemini 2.0 Pro that reads the full document map and makes editorial decisions. It selects 4-8 scenes that form a compelling documentary arc, outputting structured `SceneBrief` objects:

```python
class SceneBrief(BaseModel):
    scene_id: str          # "scene_002"
    title: str             # "The Architect's Commission"
    document_excerpt: str  # Verbatim passage from source
    source_chunk_ids: list[str]  # ["chunk_003", "chunk_004"]
    era: str               # "Ottoman Empire, 1550s"
    location: str          # "Constantinople"
    key_entities: list[str]
    narrative_role: str    # "opening" | "climax" | "resolution" ...
```

The Curator also produces a **Visual Bible** — a style guide that every downstream visual prompt references. It specifies era, palette, composition rules, and what to avoid. This is the creative intelligence of the system: deciding which 5 minutes of a 50-page document become the documentary.

## Phase II — Parallel Scene Research: The F-String Trick

Each scene needs independent research to corroborate the specific claims in its source text. The `SceneResearchOrchestrator` reads the scene briefs from state, fetches raw chunk texts from Firestore, and dynamically builds N research agents — one per scene.

Here is the ADK constraint that shaped the entire architecture: **`google_search` cannot be combined with other tools in the same agent.** Every research agent is search-only. No Firestore reads, no LLM post-processing, no tool chaining. Just `google_search`.

Building the agents dynamically hits a Python/ADK syntax conflict. ADK resolves `{variable_name}` in instruction strings from `session.state`. Python f-strings use the same braces. The solution is double-bracing:

```python
def _build_researcher_instruction(scene_index: int) -> str:
    i = scene_index
    return f"""\
You are a historical research specialist.

SCENE BRIEF:
{{scene_{i}_brief}}

SOURCE DOCUMENT EXCERPT:
{{scene_{i}_chunks}}

VISUAL BIBLE:
{{visual_bible}}

Research the specific claims in the excerpt above...
"""
```

`{{scene_{i}_brief}}` in the f-string produces `{scene_0_brief}` in the output string. ADK then resolves `{scene_0_brief}` from `session.state["scene_0_brief"]` at runtime. It took a while to get right, but it is clean once you see the pattern.

Each agent writes to its own `output_key`:

```python
Agent(
    name=f"researcher_{i}",
    model="gemini-2.0-flash",
    tools=[google_search],
    output_key=f"research_{i}",
    instruction=_build_researcher_instruction(i),
)
```

All agents are wrapped in a `ParallelAgent` and execute concurrently. Important ADK constraint: `ParallelAgent` provides no shared state during execution. Each sub-agent writes to its own key. The downstream aggregator reads all of them.

## Phase III — Script Generation

The Script Agent (Gemini 2.0 Pro) reads scene briefs plus aggregated research and produces `SegmentScript` objects — one per scene. Each segment carries a title, a 60-120 second narration script, four Imagen 3 visual descriptions, an optional Veo 2 scene, mood, narrative role, and source citations.

Scripts are written to Firestore immediately at `/sessions/{id}/segments/{segmentId}`. The frontend shows skeleton segment cards that fill in as each segment arrives. A fact validation agent (Phase III.5) then cross-references every narration claim against the research evidence before visual production begins — a hallucination firewall.

One parsing lesson: always handle LLM JSON output defensively. We parse bare arrays, `{"segments": [...]}` envelopes, and markdown code fences. The model does not always return the same wrapper.

## Phase IV — Visual Research: Google Search Grounding for Period Accuracy

Before generating images, we research what things actually looked like. The `VisualResearchOrchestrator` runs a 6-stage micro-pipeline per scene using direct `client.aio.models.generate_content` calls with Google Search Grounding:

```python
from google.genai import types
tool = types.Tool(google_search=types.GoogleSearch())
response = await client.aio.models.generate_content(
    model="gemini-2.0-flash",
    contents=query,
    config=types.GenerateContentConfig(tools=[tool]),
)
```

The grounding response includes `grounding_chunks[].web.uri` — actual URLs of museum archives, academic papers, and reference images. We fetch these pages (httpx + BeautifulSoup for HTML, Wikipedia REST API for wiki articles, Document AI for PDFs), evaluate each source for historical reliability, and merge the accepted details into a `VisualDetailManifest` with enriched Imagen 3 prompts.

The manifests include `era_markers` — things that should not appear in the image. These become Imagen 3 negative prompts. If the scene is set in 1550s Constantinople, the negative prompt prevents modern buildings, electric lights, and automobiles from appearing.

## Phase V — Imagen 3 and Veo 2: Progressive Delivery

The `VisualDirectorOrchestrator` reads the manifests and generates images. Each scene gets a variable number of frames based on its narrative role — a climax scene gets 3 frames (wide, human, dramatic), while an opening gets just 1 establishing wide shot. Each frame gets distinct composition modifiers, lens specifications, film stock references, and era-specific art style anchors:

```python
_ERA_ART_STYLE_REFERENCES = {
    "ottoman_empire": "Jean-Leon Gerome's photorealistic Orientalist warm palette",
    "medieval_europe": "Flemish Masters oil painting technique, Van Eyck luminous detail",
    "ancient_egypt": "David Roberts lithograph, warm golden sandstone, monumental scale",
}
```

The key to hitting the < 45 second target is **progressive delivery**. Scene 0 generates first — its frames are created and the SSE event fires before any other scene starts. The user can begin watching while scenes 1 through 5 generate concurrently via `asyncio.gather`.

Veo 2 video generation is fire-and-forget. We call `client.aio.models.generate_videos(model="veo-2.0-generate-001", ...)` which returns a long-running operation. Here is the gotcha: **`client.operations.get` is sync-only** in the Python GenAI SDK. In an async pipeline, you must wrap it:

```python
loop = asyncio.get_running_loop()
op = await loop.run_in_executor(
    None, client.operations.get, operation_name
)
```

We poll every 20 seconds, up to 30 times (10-minute timeout). All Veo 2 polls run concurrently after Imagen 3 completes. When a video finishes, we update Firestore with the GCS URI and emit a `segment_update(status="complete", videoUrl=...)` SSE event. The documentary player hot-swaps the static Ken Burns image for the video clip.

## SSE as Content: The Expedition Log

Every agent in the pipeline emits structured SSE events through a shared `SSEEmitter` protocol. Event types include `pipeline_phase`, `agent_status`, `agent_source_evaluation`, `segment_update`, and `stats_update`.

The frontend does not show a loading spinner. It renders these events as an **Expedition Log** — a typewriter-style journal that narrates the research process as it happens. "TRANSLATION & SCAN... Extracting text from 23 pages... FIELD RESEARCH... Researcher 0 searching for 'Sinan mosque construction techniques 1557'..." Each log entry types itself character by character with randomized timing.

The 150ms drip buffer is important: parallel agents can emit dozens of events in the same second. The frontend queues them in a `pendingRef` and releases one every 150ms, creating a readable cadence instead of a wall of text appearing at once.

This turns pipeline waiting into the first act of the documentary. By the time Scene 0's images are ready, the user has been engaged for 30-40 seconds watching AI research their document in real time. The loading state is the product.

## Lessons and Gotchas

**ADK `google_search` isolation.** This constraint is not a bug — it is a design choice in the SDK. But it fundamentally shapes your agent architecture. You cannot have an agent that searches the web and then writes to Firestore in the same turn. Plan for it from the start.

**ADK `ParallelAgent` has no shared state.** Each sub-agent writes to its own `output_key`. If you need them to coordinate, do it in a downstream agent that reads all the keys.

**Pydantic v2 `ConfigDict(arbitrary_types_allowed=True)`.** Required when your `BaseAgent` subclass has non-serializable fields like the SSE emitter or a Firestore client. Without it, Pydantic rejects the field at class definition time.

**Defensive JSON parsing.** Gemini sometimes wraps output in markdown fences. Sometimes it returns a bare array. Sometimes it wraps it in `{"segments": [...]}`. Parse all three.

**Imagen 3 `negative_prompt` works and matters.** Without it, you get modern elements leaking into historical scenes. The `era_markers` from visual research directly populate this field.

**Resumable pipelines save hours.** A crash at Phase V (visual generation) used to mean re-running OCR, research, and scripting — 3 minutes of wasted compute. Checkpointing to Firestore after each phase means you restart from exactly where you stopped.

## The Stack

| Service | Role |
|---|---|
| Cloud Run | All backend services (Python 3.12 + Node.js 20) |
| Vertex AI | Imagen 3, Veo 2, Gemini model hosting |
| Firestore | Session state, agent logs, checkpoints, segments |
| Cloud Storage | Uploaded documents, generated images, MP4 videos |
| Document AI | Multilingual OCR |
| Google ADK | Agent orchestration (SequentialAgent, ParallelAgent, BaseAgent) |

Infrastructure is automated with Terraform (`terraform/` directory) — `terraform apply` provisions everything.

---

The full source code is at [github.com/pancodo/gemini-live-agent-challenge](https://github.com/pancodo/gemini-live-agent-challenge). The pipeline lives in `backend/agent_orchestrator/agents/`. If you want to see the voice side — how the historian persona handles real-time interruption over WebSocket — check out Berkay's companion post.

`#GeminiLiveAgentChallenge`
