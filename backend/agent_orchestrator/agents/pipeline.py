"""ADK Pipeline — SequentialAgent orchestrating the full documentary generation flow.

Current pipeline order (Phases I–V fully integrated):
    1. document_analyzer      — OCR, semantic chunking, parallel summarisation,
                                narrative curation → scene_briefs + visual_bible
    2. scene_research_orch    — Parallel scene research (one google_search agent
                                per SceneBrief) → research_0 … research_N
    3. aggregator_agent       — Merges all research_N outputs into unified context
    4. script_orch            — Script Agent (gemini-2.0-pro) → SegmentScript list,
                                Firestore write, segment_update SSE (Phase III)
    5. visual_research_orch   — Per-scene 6-stage micro-pipeline → VisualDetailManifest
                                per scene, Firestore write, segment_update(ready) SSE (Phase IV)
    6. visual_director_orch   — Reads manifests → Imagen 3 (4 frames/scene) + Veo 2
                                → GCS upload, Firestore imageUrls/videoUrl, segment_update(complete)
                                SSE (Phase V)

Legacy agents (scan_agent, build_research_agents) remain in this file and are
used by the legacy ``build_pipeline`` path. They will be removed once all
phases are integrated.

ADK constraints:
    - google_search cannot be combined with other tools in the same Agent
    - Agent results shared via output_key -> session.state[key]
    - Downstream agents reference state via {key} template syntax in instructions
    - ParallelAgent provides no shared state during execution
"""

from __future__ import annotations

from google.adk.agents import Agent
from google.adk.agents.parallel_agent import ParallelAgent
from google.adk.agents.sequential_agent import SequentialAgent
from google.adk.tools import google_search

from .document_analyzer import build_document_analyzer
from .scene_research_agent import build_scene_research_orchestrator
from .script_agent_orchestrator import build_script_agent_orchestrator
from .sse_helpers import SSEEmitter
from .visual_director_orchestrator import build_visual_director_orchestrator
from .visual_research_agent import visual_research_agent
from .visual_research_orchestrator import build_visual_research_orchestrator

# ---------------------------------------------------------------------------
# 1. Scan Agent
# ---------------------------------------------------------------------------
scan_agent = Agent(
    name="scan_agent",
    model="gemini-2.0-flash",
    description="Analyzes OCR'd historical document text to extract entities, visual gaps, and research queries.",
    instruction="""\
You receive an OCR'd historical document text.
Document text: {ocr_text}

Produce a JSON object with:
{
  "summary": "3-5 sentence document summary",
  "entities": ["person/place/event/date list"],
  "visual_gaps": ["things referenced but not depicted in the document"],
  "research_queries": ["one targeted query per entity/gap, minimum 5"],
  "visual_bible": "style reference for Imagen 3 prompts: era, region, palette, composition rules"
}

Be specific in research_queries — each should be a single focused question
that google_search can answer definitively. Include era, location, and subject
in each query for maximum relevance.
""",
    output_key="scan_result",
)


# ---------------------------------------------------------------------------
# 2. Parallel Research Agents (dynamically constructed)
# ---------------------------------------------------------------------------
def build_research_agents(num_queries: int) -> ParallelAgent:
    """Build N parallel research agents, one per scan_agent query.

    Each agent uses google_search exclusively (ADK constraint: cannot combine
    with other tools). Results are written to session.state[f"research_{i}"].

    Args:
        num_queries: Number of research queries from the scan agent.

    Returns:
        A ParallelAgent wrapping all research sub-agents.
    """
    research_agents = [
        Agent(
            name=f"researcher_{i}",
            model="gemini-2.0-flash",
            description=f"Researches query {i} using Google Search with source evaluation.",
            instruction=f"""\
Research query: {{query_{i}}}
Document context: {{document_summary}}
Visual Bible style: {{visual_bible}}

1. Search the web for this query
2. Evaluate each result: accept or reject with a one-line reason
3. From accepted sources, extract minimum 3 key historical facts
4. Build a detailed Imagen 3 visual prompt:
   - Start with the Visual Bible style prefix
   - Describe scene: setting, lighting, figures, mood
   - 16:9 composition, no anachronisms
Output as JSON: {{ "sources": [...], "accepted_sources": [...], "rejected_sources": [...], "facts": [...], "visual_prompt": "..." }}
""",
            tools=[google_search],
            output_key=f"research_{i}",
        )
        for i in range(num_queries)
    ]

    return ParallelAgent(
        name="parallel_research",
        sub_agents=research_agents,
        description="Runs all research queries in parallel via Google Search.",
    )


# ---------------------------------------------------------------------------
# 3. Aggregator Agent
# ---------------------------------------------------------------------------
# References research_0 through research_9 to accommodate up to 10 scenes
# produced by the Narrative Curator (typical range: 4-8). Keys that do not
# exist in session.state are left unresolved by ADK and treated as empty
# by the model — no error is raised for absent keys.
# ---------------------------------------------------------------------------
_AGGREGATOR_INSTRUCTION = """\
You receive research results from parallel scene research agents.
Each result is a JSON object with sources, accepted_sources, rejected_sources,
facts, and a visual_prompt. Some slots below may be empty if fewer than 10
scenes were researched — ignore empty or unresolved entries.

Document Map (full outline of the source document):
{document_map}

Scene Briefs (the planned documentary scenes):
{scene_briefs}

Visual Bible (style guide for Imagen 3):
{visual_bible}

Research outputs (one per scene):
Scene 0: {research_0}
Scene 1: {research_1}
Scene 2: {research_2}
Scene 3: {research_3}
Scene 4: {research_4}
Scene 5: {research_5}
Scene 6: {research_6}
Scene 7: {research_7}
Scene 8: {research_8}
Scene 9: {research_9}

Merge all research into a unified context document:
1. Deduplicate facts across all scene research agents
2. Rank facts by relevance and historical significance
3. Note any contradictions between sources and flag the more reliable one
4. Compile a master list of accepted sources with citations
5. Create a unified Visual Bible enriched with details from all research,
   incorporating the original Visual Bible style preferences

Output as JSON:
{{
  "unified_facts": ["fact 1", "fact 2", ...],
  "source_citations": ["citation 1", "citation 2", ...],
  "contradictions": ["if any"],
  "enriched_visual_bible": "Comprehensive style guide combining visual_bible + research details",
  "total_sources_accepted": N,
  "total_sources_rejected": N
}}
"""


def _make_aggregator_agent() -> Agent:
    """Create a fresh aggregator Agent — ADK agents cannot be reused across pipeline instances."""
    return Agent(
        name="aggregator_agent",
        model="gemini-2.0-flash",
        description="Merges all parallel scene research outputs into a unified research context.",
        instruction=_AGGREGATOR_INSTRUCTION,
        output_key="aggregated_research",
    )


# ---------------------------------------------------------------------------
# 4. Script Agent
# ---------------------------------------------------------------------------
script_agent = Agent(
    name="script_agent",
    model="gemini-2.0-pro",
    description="Generates documentary segments grounded in scene briefs and aggregated research.",
    instruction="""\
You are the scriptwriter for an AI-generated historical documentary.

Scene Briefs (the planned scenes, grounded in the source document):
{scene_briefs}

Aggregated Research (corroborated historical facts and enriched Visual Bible):
{aggregated_research}

Generate one documentary segment per scene brief. Each segment must directly
correspond to its scene brief (same scene_id, title from the brief, same era
and location). Do not invent new scenes or reorder the narrative arc.

For each scene brief, produce a JSON segment:
{{
  "id": "segment_N",
  "scene_id": "scene_N",
  "title": "Scene title (from the brief)",
  "narration_script": "Full narration text, 60-120 seconds when spoken aloud",
  "visual_descriptions": [
    "Frame 1: detailed Imagen 3 prompt (starts with enriched_visual_bible prefix)",
    "Frame 2: ...",
    "Frame 3: ...",
    "Frame 4: ..."
  ],
  "veo2_scene": "Optional: one dramatic scene description for Veo 2 video generation",
  "mood": "cinematic | reflective | dramatic | scholarly",
  "sources": ["citation 1", "citation 2"]
}}

Ensure visual_descriptions are grounded in the research facts — period-accurate,
no anachronisms, specific to the era and location from each scene brief.
Each visual prompt must specify: era, location, lighting, composition, subjects, mood.
""",
    output_key="script",
)


# ---------------------------------------------------------------------------
# 5. Visual Research Agent (imported from visual_research_agent.py)
# ---------------------------------------------------------------------------
# visual_research_agent is imported at module top.
# It reads {script} and {visual_bible}, outputs to session.state["visual_research"].
# Uses google_search exclusively (ADK constraint).


# ---------------------------------------------------------------------------
# 6. Visual Director Agent
# ---------------------------------------------------------------------------
visual_director = Agent(
    name="visual_director",
    model="gemini-2.0-flash",
    description="Generates Imagen 3 images and Veo 2 videos for each documentary segment.",
    instruction="""\
You are the visual director for a historical documentary.

Script segments: {script}
Visual Bible: {visual_bible}
Visual research manifests (enriched prompts, one per scene_id): {visual_research_manifest}

Priority rule — for each segment:
1. If session.state["visual_research_manifest"][segment.scene_id]["enriched_prompt"] exists
   and is non-empty → use that as the SOLE Imagen 3 prompt base. It already incorporates
   period-accurate archival research. Apply the Visual Bible style prefix and 16:9 framing.
2. If no manifest exists or enriched_prompt is empty → fall back to the segment's
   visual_descriptions from the script.

For each segment, produce:
1. Four Imagen 3 prompts (one per visual frame).
   Each prompt must:
   - Start with the Visual Bible style prefix
   - Be 100-300 words of flowing descriptive text, 16:9 composition
   - Include period-accurate details (lighting, materials, colors)
   - End with "Exclude: [era_markers from manifest if present]"
   - Contain NO modern elements or anachronisms

2. One Veo 2 prompt for the segment's dramatic scene (if veo2_scene exists).
   - 8 seconds, cinematic camera movement, same Visual Bible style

Output as JSON:
{{
  "segments": [
    {{
      "segment_id": "segment_N",
      "scene_id": "scene_N",
      "imagen_prompts": ["prompt_1", "prompt_2", "prompt_3", "prompt_4"],
      "veo2_prompt": "optional prompt for video generation",
      "used_manifest": true,
      "mood": "cinematic"
    }}
  ]
}}
""",
    output_key="visual_direction",
)


# ---------------------------------------------------------------------------
# Full Pipeline Assembly
# ---------------------------------------------------------------------------


def build_pipeline(num_research_queries: int = 5) -> SequentialAgent:
    """[LEGACY] Assemble the original scan-based documentary pipeline.

    Uses the old ``scan_agent`` + ``build_research_agents`` path. Kept for
    reference until all phases are fully integrated and tested.

    Args:
        num_research_queries: Number of parallel research queries (from the
            scan_agent output). Defaults to 5.

    Returns:
        A SequentialAgent running the legacy pipeline:
        scan -> parallel_research -> aggregator -> script -> visual_research
        -> visual_director
    """
    parallel_research = build_research_agents(num_research_queries)

    return SequentialAgent(
        name="historian_pipeline_legacy",
        description=(
            "Legacy documentary pipeline: scan, research, script, "
            "visual research, visual direction."
        ),
        sub_agents=[
            scan_agent,
            parallel_research,
            _make_aggregator_agent(),
            script_agent,
            visual_research_agent,
            visual_director,
        ],
    )


def build_new_pipeline(
    emitter: SSEEmitter | None = None,
) -> SequentialAgent:
    """Assemble the complete Phase I–V documentary generation pipeline.

    This is the production pipeline. All five phases are fully integrated:
    - Phase I  (DocumentAnalyzerAgent):     OCR → chunks → summaries → scene_briefs
    - Phase II (SceneResearchOrchestrator): per-scene google_search corroboration
    - Phase III (ScriptAgentOrchestrator):  script generation + Firestore + SSE
    - Phase IV (VisualResearchOrchestrator): 6-stage per-scene visual research
      micro-pipeline → VisualDetailManifest per scene → Firestore + SSE
    - Phase V  (VisualDirectorOrchestrator): Imagen 3 (4 frames/scene) + Veo 2
      generation → GCS upload → Firestore imageUrls/videoUrl → SSE complete

    Args:
        emitter: Optional SSE emitter forwarded to all phase orchestrators
            for frontend Expedition Log progress events.

    Returns:
        A SequentialAgent running:
        document_analyzer → scene_research → aggregator
        → ParallelAgent(script_orch, visual_research_orch)
        → visual_director_orch
    """
    document_analyzer = build_document_analyzer(emitter=emitter)
    scene_research = build_scene_research_orchestrator(emitter=emitter)
    script_orch = build_script_agent_orchestrator(emitter=emitter)
    visual_research_orch = build_visual_research_orchestrator(emitter=emitter)
    visual_director_orch = build_visual_director_orchestrator(emitter=emitter)

    # Phase III (script generation) and Phase IV (visual research) are independent:
    # both only need scene_briefs + visual_bible (Phase I) and aggregated_research
    # (Aggregator). Neither depends on the other's output. Running them in parallel
    # saves the full runtime of whichever finishes first (~30-60s saved).
    synthesis_parallel = ParallelAgent(
        name="synthesis_parallel",
        sub_agents=[script_orch, visual_research_orch],
        description=(
            "Runs Phase III (script generation) and Phase IV (visual research) "
            "concurrently — both feed Phase V but neither depends on the other."
        ),
    )

    return SequentialAgent(
        name="historian_pipeline",
        description=(
            "AI Historian documentary pipeline: document analysis (Phase I), "
            "scene research (Phase II), parallel script + visual research "
            "(Phase III + IV), and visual generation (Phase V)."
        ),
        sub_agents=[
            document_analyzer,        # Phase I:    OCR → chunks → summaries → scene_briefs
            scene_research,           # Phase II:   per-scene google_search corroboration
            _make_aggregator_agent(), # Aggregator: research_{n} → aggregated_research
            synthesis_parallel,       # Phase III+IV (parallel): script + visual research
            visual_director_orch,     # Phase V:    Imagen 3 + Veo 2 → GCS + Firestore + SSE
        ],
    )
