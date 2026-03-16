# From Ottoman Manuscript to AI Documentary: Building an 11-Phase Research Pipeline with Google ADK

*This post was written as part of my submission to the [Gemini Live Agent Challenge](https://geminiliveagentchallenge.devpost.com/) hackathon, organized by Google LLC and administered by Devpost.*

---

Upload a 400-year-old Ottoman manuscript written in Arabic script. Forty-five seconds later, watch the first segment of a cinematic documentary about it — narrated by an AI historian you can interrupt and question at any time, illustrated with period-accurate generated images, backed by corroborated research from real web sources.

That is **AI Historian**. This post covers the engine behind it: an 11-phase pipeline built on Google's Agent Development Kit (ADK) that transforms any historical document into a structured, fact-checked, geographically grounded documentary — streaming progress to the frontend in real time.

## The Pipeline at a Glance

```
I   Document Analyzer      — OCR, chunking, scene selection
II  Scene Research          — parallel web search per scene
III Script Generation       — narration scripts + segment structure
IV  Narrative Director      — Gemini interleaved TEXT+IMAGE storyboards
V   Beat Illustration       — per-beat narration visuals (TEXT+IMAGE)
VI  Visual Interleave       — assigns visual type per beat (illustration/cinematic/video)
VII Fact Validator           — hallucination firewall
VIII Geographic Mapping      — location extraction + geocoding
IX  Visual Storyboard        — director's shot list for visual distinctness
X   Visual Research          — archival web search for period accuracy
XI  Visual Director          — Imagen 3 frames + Veo 2 video generation
```

Each phase is a custom `BaseAgent` subclass in Google ADK. State flows between agents via `session.state["key"]` — ADK's built-in state sharing mechanism. The entire pipeline is wrapped in a `ResumablePipelineAgent` that checkpoints to Firestore after each phase, so a crash at Phase X resumes from Phase X, not from the beginning.

Here is the function that wires everything together:

```python
def build_new_pipeline(emitter=None) -> ResumablePipelineAgent:
    document_analyzer = build_document_analyzer(emitter=emitter)
    scene_research = build_scene_research_orchestrator(emitter=emitter)
    script_orch = build_script_agent_orchestrator(emitter=emitter)
    narrative_director = build_narrative_director(emitter=emitter)
    beat_illustrator = build_beat_illustration_agent(emitter=emitter)
    visual_interleave = build_visual_interleave_agent(emitter=emitter)
    fact_validator = build_fact_validator_agent(emitter=emitter)
    geo_agent = build_geo_location_agent(emitter=emitter)
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
            narrative_director,       # Phase IV
            beat_illustrator,         # Phase V
            visual_interleave,        # Phase VI
            fact_validator,           # Phase VII
            geo_agent,               # Phase VIII
            visual_planner,           # Phase IX
            visual_research_orch,     # Phase X
            visual_director_orch,     # Phase XI
        ],
    )
```

Every agent receives the same `emitter` — an SSE channel that streams structured events to the frontend. More on that later.

## Phase I — Document Analysis: OCR to Scene Briefs

The pipeline starts with Google Document AI's `OCR_PROCESSOR`, which handles 200+ languages including Arabic, Ottoman Turkish, and Classical Chinese. The raw OCR text goes through a deterministic Python chunker — not an LLM call. It splits on page breaks (`\f`), detected headings, topic shifts, and a 3,200-character hard fallback. Fast and predictable.

Each chunk is then summarized in parallel using Gemini 2.0 Flash, bounded by `asyncio.gather` with a `Semaphore(10)` to respect rate limits. The summaries form a `DocumentMap` — a structured outline of the entire source document.

The interesting part is the **Narrative Curator**: an ADK Agent running Gemini 2.0 Pro that reads the full document map and makes editorial decisions. It selects 4–6 scenes that form a compelling documentary arc, outputting structured `SceneBrief` objects:

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

The Script Agent (Gemini 2.0 Pro) reads scene briefs plus aggregated research and produces `SegmentScript` objects — one per scene. Each segment carries a title, a 60–120 second narration script, four Imagen 3 visual descriptions, an optional Veo 2 scene, mood, narrative role, and source citations.

Scripts are written to Firestore immediately at `/sessions/{id}/segments/{segmentId}`. The frontend shows skeleton segment cards that fill in as each segment arrives.

One parsing lesson: always handle LLM JSON output defensively. We parse bare arrays, `{"segments": [...]}` envelopes, and markdown code fences. The model does not always return the same wrapper.

## Phases IV–VI — Gemini's Interleaved TEXT+IMAGE Output

This is the most technically interesting part of the pipeline. Gemini models can produce text and images in a single response — not sequentially, but interleaved. We use this capability in three consecutive phases.

### Phase IV — Narrative Director: Storyboarding in One Call

The `NarrativeDirector` makes one Gemini call per scene with `response_modalities=["TEXT", "IMAGE"]`. A single response produces both a creative direction note (text) and a storyboard illustration (inline image bytes) — the model reasons about visual composition and generates the image in one pass.

```python
response = await client.aio.models.generate_content(
    model="gemini-2.5-flash-image",
    contents=storyboard_prompt,
    config=types.GenerateContentConfig(
        response_modalities=["TEXT", "IMAGE"],
    ),
)

# One response, two modalities
for part in response.candidates[0].content.parts:
    if part.text:
        creative_direction = part.text
    elif part.inline_data:
        image_bytes = part.inline_data.data
```

The image bytes are uploaded to GCS, and the storyboard text feeds downstream phases. If Gemini's safety filter blocks image generation (it occasionally does for historical violence), the phase degrades gracefully — Phase XI falls back to Imagen 3.

### Phase V — Beat Illustration: Fast-Path Visuals

Each segment's narration is decomposed into 3–4 dramatic beats. For each beat, Gemini produces an illustration alongside a direction note using the same interleaved TEXT+IMAGE capability:

```
Beat 1: "The fleet assembles at dawn" → [text: camera direction] + [image: harbor scene]
Beat 2: "The admiral surveys the strait" → [text: lighting note] + [image: close-up portrait]
Beat 3: "Cannons fire across the water" → [text: composition] + [image: wide battle scene]
```

This is the documentary player's **primary visual path**. Beat images are available before Phase XI even starts, which is how we hit the < 45 second first-segment target. Scene 0's beats generate first (fast path); remaining scenes run concurrently with a `Semaphore(2)`.

If interleaved generation fails for a specific beat, we fall back to Imagen 3. If that also fails, we skip the beat. The player always has something to show.

### Phase VI — Visual Interleave: Cinematic Taxonomy

Not every beat should look the same. The `VisualInterleaveAgent` reads all beats and assigns each one a visual type:

- **`illustration`** — keep the Phase V beat image (contemplative moments)
- **`cinematic`** — regenerate with Imagen 3 using enriched prompts (dramatic scenes)
- **`video`** — generate with Veo 2 (action sequences, transitions)

If a segment has 3+ beats, at least one of each type is required — enforced by validation logic, not just the prompt. If Gemini returns invalid types, we fall back to a cycling pattern: `["illustration", "cinematic", "illustration", "video"]`.

This three-way split means the documentary has visual variety without manual art direction. The system decides that a quiet dialogue scene keeps its illustration while a battle gets Imagen 3's cinematic treatment and a ship sailing gets Veo 2 motion.

## Phase VII — Fact Validation: The Hallucination Firewall

Before any visual production begins, every narration claim passes through an LLM-judge. The `FactValidatorAgent` cross-references each sentence in the script against the aggregated research from Phase II.

Every sentence is classified into one of four categories. **Supported** claims stay exactly as written — "The mosque was commissioned in 1557" survives untouched if research confirms it. **Unsupported specific** claims lose their false precision — if no source confirms "47 ships", the number gets removed. **Unsupported plausible** claims get softened with hedging language — "He arrived in March" becomes "Historical accounts suggest he arrived in early spring." And **non-factual** prose stays as-is — "The city held its breath" is rhetoric, not a factual claim, so the validator leaves it alone.

The prompt feeds the model specific hedging phrases: "According to tradition...", "Evidence indicates...", "Historical accounts suggest...". This lets the narration stay cinematic while removing false precision.

The validated script overwrites `session.state["script"]` only if the segment count matches the original — a safety check to prevent the validator from accidentally dropping scenes.

## Phase VIII — Geographic Mapping

The `GeoLocationAgent` extracts every geographic location mentioned in the documentary script. It uses Gemini 2.0 Flash with `response_mime_type="application/json"` to guarantee structured output — no markdown fences, no prose, just coordinates.

For each segment, the agent produces:

- **Events** — cities, battle sites, regions, each with lat/lng, a type marker (city/battle/region), and a date context
- **Routes** — trade routes, military campaigns, migration paths connecting events in narrative order
- **Viewport** — calculated center point and zoom level for the map display

The output goes to Firestore and emits `geo_update` SSE events. The frontend renders an interactive map with diamond battle pins, colored route lines, and location markers — the documentary's geography comes alive alongside the narration.

Lat/lng validation catches swapped coordinates (a common Gemini mistake — confusing latitude and longitude for Middle Eastern locations). Zoom auto-clamps to a 2–8 range.

## Phase IX — Visual Storyboard: The Director's Shot List

Before generating final images, we need a plan. The `NarrativeVisualPlanner` makes one Gemini 2.5 Flash call across all scenes to produce a `VisualStoryboard` — a global shot list ensuring no two scenes look the same.

Each scene entry includes:

- **`primary_subject`** — what the image is *of* (no duplicates allowed across scenes)
- **`temporal_state`** — is the building newly built or a ruin? Does the sculpture have polychrome paint?
- **`color_palette`** — warm opening → neutral rising action → cool climax → warm resolution
- **`avoid_list`** — references adjacent scenes by name to prevent visual repetition
- **`frame_concepts`** — 4 distinct compositions, each ≥ 20 characters (not just "wide shot")

The temporal state matters more than you might expect. Ancient Greek and Roman sculptures were originally painted in vivid colors — polychrome paint that has since weathered away. Without the `temporal_state: "newly built, polychrome paint intact"` instruction, every image model defaults to white marble. The planner catches these details because it reads the era from the scene brief and reasons about what the subject looked like *at the time*.

## Phase X — Visual Research: Google Search Grounding for Period Accuracy

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

## Phase XI — Imagen 3 and Veo 2: Progressive Delivery

The `VisualDirectorOrchestrator` reads the manifests and the beat type assignments from Phase VI. Each beat's generation path depends on its assigned type:

- **`illustration`** beats keep their Phase V images — no regeneration needed
- **`cinematic`** beats get Imagen 3 with enriched prompts from the visual research manifest
- **`video`** beats get Veo 2 clips

Each Imagen 3 frame gets distinct composition modifiers, lens specifications, film stock references, and era-specific art style anchors:

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

Every agent in the pipeline emits structured SSE events through a shared `SSEEmitter` protocol. Event types include `pipeline_phase`, `agent_status`, `agent_source_evaluation`, `segment_update`, `geo_update`, `narration_beat`, and `stats_update`.

The frontend does not show a loading spinner. It renders these events as an **Expedition Log** — a typewriter-style journal that narrates the research process as it happens. "TRANSLATION & SCAN... Extracting text from 23 pages... FIELD RESEARCH... Researcher 0 searching for 'Sinan mosque construction techniques 1557'... CREATIVE DIRECTION... Generating storyboard for Scene 0..." Each log entry types itself character by character with randomized timing.

The pipeline has 11 named phases in the Expedition Log. Each new phase triggers a self-drawing gold divider line with an ornament dot — the visual rhythm matches the pipeline's actual progress.

The 150ms drip buffer is important: parallel agents can emit dozens of events in the same second. The frontend queues them in a `pendingRef` and releases one every 150ms, creating a readable cadence instead of a wall of text appearing at once.

This turns pipeline waiting into the first act of the documentary. By the time Scene 0's beats are ready, the user has been engaged watching AI research their document in real time. The loading state is the product.

## Lessons and Gotchas

**ADK `google_search` isolation.** This constraint is not a bug — it is a design choice in the SDK. But it fundamentally shapes your agent architecture. You cannot have an agent that searches the web and then writes to Firestore in the same turn. Plan for it from the start.

**ADK `ParallelAgent` has no shared state.** Each sub-agent writes to its own `output_key`. If you need them to coordinate, do it in a downstream agent that reads all the keys.

**Pydantic v2 `ConfigDict(arbitrary_types_allowed=True)`.** Required when your `BaseAgent` subclass has non-serializable fields like the SSE emitter or a Firestore client. Without it, Pydantic rejects the field at class definition time.

**Defensive JSON parsing.** Gemini sometimes wraps output in markdown fences. Sometimes it returns a bare array. Sometimes it wraps it in `{"segments": [...]}`. Parse all three.

**Gemini interleaved TEXT+IMAGE is powerful but not guaranteed.** Safety filters can block image generation mid-response. Always have a fallback path — in our case, Imagen 3 catches what interleaved output drops.

**`response_mime_type="application/json"` for structured extraction.** When you need guaranteed JSON (no prose, no fences), this Gemini config parameter is more reliable than prompt engineering alone. We use it for geo extraction and visual storyboarding.

**Imagen 3 `negative_prompt` works and matters.** Without it, you get modern elements leaking into historical scenes. The `era_markers` from visual research directly populate this field.

**Temporal state matters for historical accuracy.** Image models default to present-day appearance. Ancient sculptures lose their paint, buildings gain modern context. The visual planner explicitly specifies what things looked like *at the time*, not now.

**`client.operations.get` is sync-only.** The Python GenAI SDK's operation polling is synchronous. In an async pipeline, wrap it with `loop.run_in_executor`. This is not documented prominently.

**Resumable pipelines save hours.** A crash at Phase XI (visual generation) used to mean re-running OCR, research, and scripting — 3 minutes of wasted compute. Checkpointing to Firestore after each phase means you restart from exactly where you stopped.

## The Stack

All three backend services run on **Cloud Run** — the FastAPI gateway and ADK orchestrator in Python 3.12, the WebSocket relay in Node.js 20. **Vertex AI** hosts Imagen 3, Veo 2, and all Gemini model calls. **Firestore** stores session state, agent logs, pipeline checkpoints, segment data, and geographic metadata. **Cloud Storage** holds uploaded documents, generated images, storyboard frames, and MP4 video clips. **Document AI** handles multilingual OCR across 200+ languages.

On the AI side, **Gemini 2.5 Flash** powers the interleaved TEXT+IMAGE storyboards and beat illustrations. **Gemini 2.0 Flash** handles research, extraction, fact validation, and geo mapping. **Gemini 2.0 Pro** generates the narration scripts and visual storyboard plans. The entire agent orchestration runs on **Google ADK** using SequentialAgent, ParallelAgent, and custom BaseAgent subclasses.

Infrastructure is automated with Terraform (`terraform/` directory) — `terraform apply` provisions everything.

---

The full source code is at [github.com/pancodo/gemini-live-agent-challenge](https://github.com/pancodo/gemini-live-agent-challenge). The pipeline lives in `backend/agent_orchestrator/agents/`. If you want to see the voice side — how the historian persona handles real-time interruption over WebSocket — check out Berkay's companion post.

`#GeminiLiveAgentChallenge`
