"""Phase III of the AI Historian documentary pipeline: Script Generation.

Wraps the Script Agent (gemini-2.0-pro) in a custom ``BaseAgent`` orchestrator
that handles SSE emission, output parsing, and Firestore persistence.

Architecture
------------
``ScriptAgentOrchestrator`` is a custom ``BaseAgent`` subclass. It:

1. Emits the ``pipeline_phase`` SSE event (phase 3, label "SYNTHESIS") so the
   frontend Expedition Log advances to Phase III.
2. Announces the inner script agent as ``queued`` then ``searching`` so the
   Research Panel shows a status card.
3. Runs the inner ADK ``Agent`` (``_INNER_SCRIPT_AGENT``) via
   ``run_async(ctx)``, yielding every ADK event upstream.
4. Parses the JSON output from ``session.state["script"]`` into a list of
   ``SegmentScript`` objects.
5. Writes each segment as a Firestore document under
   ``/sessions/{sessionId}/segments/{segmentId}`` with a ``status: "pending"``
   field (imageUrls/videoUrl are filled by Phase V).
6. Emits ``segment_update`` SSE events — one per segment with
   ``status: "generating"`` — so the frontend SegmentCard skeletons become
   titled cards.
7. Emits a ``stats_update`` event with ``segmentsReady`` equal to the number
   of successfully parsed segments.

Session state contract
----------------------
**Inputs** (must be set before Phase III runs):
    - ``session.state["scene_briefs"]``        — ``list[dict]`` from Phase I
    - ``session.state["aggregated_research"]`` — merged string from aggregator
    - ``session.state["visual_bible"]``        — Imagen 3 style guide string
    - ``session.state["document_map"]``        — document outline string

**Outputs** (written by this agent):
    - ``session.state["script"]`` — list[dict] of serialised ``SegmentScript``
      objects (raw JSON string as returned by the inner ADK Agent, then
      re-written as a list of dicts after parsing).
"""

from __future__ import annotations

import json
import logging
import os
import time
from collections.abc import AsyncGenerator
from typing import Any

from google.adk.agents import Agent
from google.adk.agents.base_agent import BaseAgent
from google.adk.agents.invocation_context import InvocationContext
from google.cloud import firestore
from pydantic import ConfigDict, Field

from .script_types import SegmentScript
from .sse_helpers import (
    SSEEmitter,
    build_agent_status_event,
    build_pipeline_phase_event,
    build_segment_update_event,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Inner ADK Script Agent
# ---------------------------------------------------------------------------
# Defined at module level so it is reused across pipeline invocations.
# The agent reads {scene_briefs} and {aggregated_research} from session.state
# via ADK's template substitution mechanism.
# ---------------------------------------------------------------------------

_INNER_SCRIPT_AGENT_INSTRUCTION = """\
You are the scriptwriter for an AI-generated historical documentary.

## Your Voice

Write as Ken Burns and Geoffrey C. Ward — scholarly, warm, specific, never \
academic. Your sentences have weight without pretension. You trust the viewer's \
intelligence. You let silence and image do half the work. When you speak, every \
word earns its place.

## FIVE MANDATORY RULES

Follow every rule in every segment. No exceptions.

### Rule 1 — Open with a specific moment, never a topic sentence.
BAD:  "The Roman Colosseum was one of the greatest engineering achievements."
GOOD: "On a sweltering August morning in 80 AD, the emperor Titus stood at \
the rim of the largest amphitheater the world had ever seen."

### Rule 2 — At least one primary-source quote per segment with attribution.
Format: "'[quote],' wrote [Name], [context of who they were]."
If no direct quote exists in the research, use a named paraphrase: \
"According to Pliny the Elder, who catalogued the natural wonders of the empire..."

### Rule 3 — Present-tense pivot for immediacy, at least once per segment.
Example: "It is the spring of 1348. The first ships have just arrived in \
Messina harbor. No one on the docks understands what the rats carry."

### Rule 4 — End with resonance, never summary.
BAD:  "The battle was a turning point in the war."
GOOD: "The field is quiet now. Wildflowers grow where the artillery stood."

### Rule 5 — Bridge sentence to the next scene (all segments except the last).
The bridge must be spatial, temporal, or narrative — never meta-commentary. \
GOOD: "Three hundred miles to the east, another city is about to learn the \
same lesson." \
BAD:  "Meanwhile, in another part of the story..." \
BAD:  "Moving on to our next topic..."

## ANTI-PATTERNS — NEVER USE THESE

Banned phrases: "Throughout history...", "It is worth noting", \
"Interestingly enough", "Moving on to our next topic", "It is important to \
remember", "In conclusion".
Banned modern idioms: "game-changer", "iconic", "legendary", "cutting-edge", \
"ahead of its time", "changed the world forever".
Banned didactic address: Never use "You might wonder...", "Imagine yourself \
there...", "Picture this..." — the narration places the viewer in the scene \
without instructing them to imagine it.

## Pacing by narrative_role

The `narrative_role` field in each scene brief shapes pacing and register:

- "opening": Slow, atmospheric. Long compound sentences. The viewer arrives \
before the action does. Establish geography, season, light, the texture of \
daily life. Breathe.
- "rising_action": Building momentum. Facts accumulate. Sentences shorten \
as tension mounts. Introduce the specific people who will matter.
- "climax": Urgency. Short declarative sentences. Present-tense pivot is \
strongest here. Sensory detail — sound, heat, smell, the weight of objects. \
Let the moment land without explaining its importance.
- "resolution": Exhale. The consequence arrives. Longer sentences return. \
What changed is stated plainly, without editorialising.
- "coda": The longest view. Historical echo — how this moment ripples into \
the present. Quietest register. The last image should linger.

## FEW-SHOT EXAMPLE — All 5 Rules in Action

Scene: The Inaugural Games of the Colosseum, Rome, 80 AD. \
narrative_role: "opening".

"On a sweltering August morning in 80 AD, fifty thousand Romans press through \
the marble archways of the largest amphitheater the world has ever seen. \
[Rule 1: specific moment, not topic sentence] The emperor Titus has spent \
eight years finishing what his father began, and today the Flavian \
Amphitheater — the building we will come to call the Colosseum — opens its \
gates for the first time.

'He gave a most lavish gladiatorial show,' wrote Cassius Dio, the senator \
who would chronicle the excesses of a dozen emperors. [Rule 2: primary-source \
quote with attribution] The sand is raked smooth. The velarium — an enormous \
linen awning operated by a thousand sailors — billows overhead, casting the \
crowd in rippling shadow.

It is mid-morning. The first beast hunt is about to begin. [Rule 3: \
present-tense pivot] Beneath the arena floor, in a maze of tunnels and \
mechanical lifts that no audience member can see, handlers steady crates of \
North African lions. A trapdoor rises. Sunlight floods the passage. The crowd \
draws a single breath.

For one hundred days the games will continue — five thousand animals killed, \
uncounted men alongside them. The stone remembers what the empire preferred \
to celebrate. [Rule 4: resonance, not summary]

Six hundred miles to the south, in the quarries that supplied the travertine, \
the next shipment is already being cut. [Rule 5: bridge sentence — spatial]"

## Inputs

Scene Briefs (the planned scenes, grounded in the source document):
{scene_briefs}

Aggregated Research (corroborated historical facts and enriched Visual Bible):
{aggregated_research}

Visual Bible (period-accurate style guide for all imagery):
{visual_bible}

Document Map (structural outline of the source document):
{document_map}

## Task

Generate one documentary segment per scene brief. Each segment must directly \
correspond to its scene brief — same scene_id, title from the brief, same era \
and location. Do not invent new scenes or reorder the narrative arc.

## Visual Descriptions — 4 Frames (Imagen 3 Prompts)

Each `visual_descriptions` array MUST have exactly 4 entries. CRITICAL: Each \
frame must depict a DIFFERENT SUBJECT/ASPECT of the scene — not the same view \
from a different camera angle.

- Frame 1 (index 0): ENVIRONMENT ONLY — The architectural or landscape \
setting in its full glory. NO human figures whatsoever. The space, its scale, \
its textures, its atmosphere. Wide and immersive.

- Frame 2 (index 1): HUMAN ACTIVITY — People actively present in this space. \
Workers, citizens, merchants, soldiers, priests — whoever belongs here. \
Period dress. Human activity is PRIMARY; architecture is background only.

- Frame 3 (index 2): MATERIAL DETAIL — An extreme close-up of ONE specific \
physical object from this era. A carved stone inscription, a worn bronze \
tool, a piece of fabric, a document, a vessel, an architectural ornament. \
The object IS the entire frame. No context needed.

- Frame 4 (index 3): ATMOSPHERE — Light, shadow, and environmental mood. A \
dramatic visual relationship: a shaft of light through a colonnade, shadow \
patterns on stone, dust in sunbeams, fire reflection on water. Atmosphere \
and light are the subject, not objects.

RULES for each visual description:
- Start with "Cinematic still photograph."
- Include the EXPLICIT ERA and PERIOD (e.g., "circa 1st century CE", \
"ancient Rome 80 AD", "Renaissance Florence 1500s"). Never omit the time \
period.
- Be 50–70 words — precise and specific.
- Include period-accurate materials (what surfaces are made of), lighting \
source (candles, oil lamps, torches, natural daylight), and atmospheric \
condition.
- Each frame must show something DIFFERENT from the other three. If Frame 1 \
shows the Colosseum's arches, Frame 2 must show PEOPLE, Frame 3 must show \
a SPECIFIC SMALL OBJECT, and Frame 4 must show LIGHT/SHADOW — NOT more \
Colosseum arches.
- Do not repeat the main landmark across all 4 frames. One establishing shot \
(Frame 1) is enough — the other frames show different aspects of the world.

## Veo 2 Scenes (Optional)

The `veo2_scene` field is optional. Include it ONLY if the segment has a \
visually dramatic moment: sweeping environment (harbor, plaza, forest), \
atmospheric dynamics (fog, fire, water), or architectural scale.

When present, the Veo 2 prompt MUST follow this EXACT structure:
"[Camera movement]. [Subject/environment in period context with temporal \
state]. [Atmospheric motion element]. Shot on 35mm film, anamorphic lens."

MANDATORY RULES:
- SINGLE camera movement only — NEVER combine movements (pan + zoom), \
(dolly + crane), etc. Choose ONE: "Slow dolly in", "Crane shot rising", \
"Pan right across", "Static shot of", "Slow arc around", "Tracking shot \
along". One movement per clip, no exceptions.
- Include ONE atmospheric motion element — fog drifting, dust floating in \
light shafts, candlelight flickering, water rippling, shadows lengthening, \
smoke curling, leaves stirring, fabric billowing. This gives Veo 2 \
something to animate.
- Stay within 30-50 words maximum. Shorter is sharper — over 50 words \
dilutes Veo 2's focus and produces muddled output.
- The depicted environment must reflect its STATE at the historical period — \
specify if it is freshly built, intact, in active use, polychrome-painted, \
etc. NEVER default to the modern ruined appearance of famous sites.
- NO negative descriptions — Veo 2 cannot process negations. Describe WHAT \
IS THERE, not what should be absent.
- Contain NO human faces, NO identifiable individuals — describe environment, \
objects, atmospheric movement, and traces of human activity only.
- Include time-of-day as atmosphere shorthand: "at golden hour", "pre-dawn \
blue light", "dusk last light".
- Example: "Slow crane shot rising over the intact Colosseum at golden hour, \
its travertine arches painted in ochre and cinnabar, dust motes drifting \
through the archways. Shot on 35mm film, anamorphic lens."

If the segment has no dramatic visual moment, omit the `veo2_scene` key \
entirely — do not force it.

## Mood

The `mood` field must be exactly one of: "cinematic", "reflective", \
"dramatic", "scholarly". Never combine moods, never use custom strings.

## Sources / Citations

The `sources` array should use consistent formatting:
- Academic: "Author Last, First. 'Title.' Journal/Publisher, Year. [URL if online]"
- Archival: "Archive Name. Document Title. Call number/date."
- Web: "Site Name: Article Title. [URL]. Accessed from research."

## Narrative Role (copy from scene brief)

The `narrative_role` field must be copied EXACTLY from the scene brief — do not change it. Valid values: "opening", "rising_action", "climax", "resolution", "coda".

## Output Format

Produce a JSON array containing one object per scene brief, in the same order \
as the briefs. Do not wrap it in markdown fences or add a preamble.

Each object:
{
  "id": "segment_N",
  "scene_id": "scene_N",
  "title": "Scene title (from the brief)",
  "narration_script": "Full narration text, 60-120 seconds when spoken aloud",
  "visual_descriptions": [
    "Cinematic still photograph. Environment only, no people — [full scene, circa ERA]...",
    "Cinematic still photograph. Human figures as primary subject — [people in period dress, ERA]...",
    "Cinematic still photograph. Extreme close-up — [single specific object, ERA]...",
    "Cinematic still photograph. Atmospheric light and shadow — [light quality, ERA]..."
  ],
  "veo2_scene": "Slow dolly in over ... (optional, omit key if not applicable)",
  "mood": "cinematic",
  "narrative_role": "climax",
  "sources": ["formatted citation 1", "formatted citation 2"]
}
"""


def _make_inner_script_agent() -> Agent:
    """Create a fresh script Agent per pipeline run — ADK agents cannot be reused."""
    return Agent(
        name="script_agent",
        model="gemini-2.0-flash",  # Was gemini-2.0-pro — switch back to pro before submission
        description=(
            "Generates documentary segments grounded in scene briefs and "
            "aggregated research. One segment per SceneBrief."
        ),
        instruction=_INNER_SCRIPT_AGENT_INSTRUCTION,
        output_key="script",
    )


# ---------------------------------------------------------------------------
# JSON parsing helpers
# ---------------------------------------------------------------------------


def _strip_fences(text: str) -> str:
    """Remove markdown code fences that the model may wrap JSON in."""
    stripped = text.strip()
    if stripped.startswith("```"):
        # Remove opening fence (with optional language tag)
        stripped = stripped.split("\n", 1)[-1]
    if stripped.endswith("```"):
        stripped = stripped.rsplit("```", 1)[0]
    return stripped.strip()


def _parse_script_output(raw: str) -> list[SegmentScript]:
    """Parse the script_agent JSON output into SegmentScript objects.

    The agent is instructed to produce a bare JSON array, but may wrap it in
    a ``{"segments": [...]}`` object or markdown fences. Both forms are handled.

    Args:
        raw: Raw string from ``session.state["script"]``.

    Returns:
        List of validated ``SegmentScript`` objects. May be empty if parsing
        fails — the caller logs the error and emits an SSE error event.
    """
    cleaned = _strip_fences(raw)
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError as exc:
        logger.error("Script Agent output is not valid JSON: %s", exc)
        return []

    # Unwrap {"segments": [...]} envelope if present
    if isinstance(parsed, dict):
        parsed = parsed.get("segments", [])

    if not isinstance(parsed, list):
        logger.error(
            "Script Agent output is not a JSON array (got %s)", type(parsed).__name__
        )
        return []

    segments: list[SegmentScript] = []
    for idx, item in enumerate(parsed):
        if not isinstance(item, dict):
            logger.warning("Skipping non-dict segment at index %d", idx)
            continue
        try:
            segments.append(SegmentScript(**item))
        except Exception as exc:
            logger.warning("Skipping malformed segment at index %d: %s", idx, exc)

    return segments


# ---------------------------------------------------------------------------
# Firestore persistence helper
# ---------------------------------------------------------------------------


async def _write_segment_to_firestore(
    db: firestore.AsyncClient,
    session_id: str,
    segment: SegmentScript,
) -> None:
    """Write a single SegmentScript to Firestore.

    Creates or overwrites the document at
    ``/sessions/{sessionId}/segments/{segmentId}``.

    The document includes stub arrays for ``imageUrls`` and ``videoUrl`` that
    Phase V (Visual Director) will populate.

    Args:
        db: Async Firestore client.
        session_id: Parent session.
        segment: Parsed and validated segment to persist.
    """
    ref = (
        db.collection("sessions")
        .document(session_id)
        .collection("segments")
        .document(segment.id)
    )
    await ref.set(
        {
            "sceneId": segment.scene_id,
            "title": segment.title,
            "script": segment.narration_script,
            "visualDescriptions": segment.visual_descriptions,
            "veo2Scene": segment.veo2_scene,
            "mood": segment.mood,
            "narrativeRole": segment.narrative_role,
            "sources": segment.sources,
            "imageUrls": [],       # Populated by Phase V
            "videoUrl": None,      # Populated by Phase V
            "graphEdges": [],      # Reserved for future branching
            "status": "pending",   # Updated to "ready" by Phase V
            "createdAt": firestore.SERVER_TIMESTAMP,
        }
    )


# ---------------------------------------------------------------------------
# ScriptAgentOrchestrator — Phase III BaseAgent
# ---------------------------------------------------------------------------


class ScriptAgentOrchestrator(BaseAgent):
    """Phase III orchestrator: run Script Agent → parse → store → emit events.

    Wraps the inner ``_INNER_SCRIPT_AGENT`` (gemini-2.0-pro ADK Agent) in the
    same BaseAgent orchestrator pattern used by Phases I and II. This gives
    Phase III full SSE visibility without requiring the inner ADK Agent to know
    anything about the SSE transport.
    """

    model_config = ConfigDict(arbitrary_types_allowed=True)

    firestore_project: str = Field(
        ...,
        description="GCP project ID for Firestore operations.",
    )
    emitter: Any = Field(
        default=None,
        description="Optional SSE emitter for frontend progress events.",
    )
    sub_agents: list[BaseAgent] = Field(
        default_factory=list,
        description=(
            "Declared for ADK BaseAgent compatibility. "
            "The inner script agent is run directly via run_async(ctx)."
        ),
    )

    async def _run_async_impl(
        self,
        ctx: InvocationContext,
    ) -> AsyncGenerator[Any, None]:
        """Execute Phase III: announce → run script agent → parse → persist.

        Yields every ADK event produced by the inner script agent so the ADK
        runtime can track execution correctly.
        """
        session_id: str = ctx.session.id
        t_start = time.monotonic()

        # ------------------------------------------------------------------
        # Phase announcement
        # ------------------------------------------------------------------
        if self.emitter is not None:
            await self.emitter.emit(
                "pipeline_phase",
                build_pipeline_phase_event(
                    phase=3,
                    label="SYNTHESIS",
                    message="Writing narration and visual direction for each scene",
                ),
            )

        # ------------------------------------------------------------------
        # Announce script agent as queued
        # ------------------------------------------------------------------
        num_scenes = len(ctx.session.state.get("scene_briefs", []))
        if self.emitter is not None:
            await self.emitter.emit(
                "agent_status",
                build_agent_status_event(
                    agent_id="script_agent",
                    status="queued",
                    query=(
                        f"Scripting {num_scenes} scene"
                        f"{'s' if num_scenes != 1 else ''}"
                    ),
                ),
            )

        # ------------------------------------------------------------------
        # Run the inner script agent
        # ------------------------------------------------------------------
        if self.emitter is not None:
            await self.emitter.emit(
                "agent_status",
                build_agent_status_event(
                    agent_id="script_agent",
                    status="searching",  # "working" maps to teal dot in frontend
                    query="Composing narration and visual prompts from research",
                ),
            )

        t_script_start = time.monotonic()
        async for event in _make_inner_script_agent().run_async(ctx):
            yield event
        t_script_elapsed = time.monotonic() - t_script_start

        logger.info(
            "Script Agent completed in %.1fs for session %s",
            t_script_elapsed,
            session_id,
        )

        # ------------------------------------------------------------------
        # Parse output
        # ------------------------------------------------------------------
        raw_script: str = ctx.session.state.get("script", "")
        if not raw_script:
            logger.error(
                "Phase III: script_agent produced no output for session %s",
                session_id,
            )
            if self.emitter is not None:
                await self.emitter.emit(
                    "agent_status",
                    build_agent_status_event(
                        agent_id="script_agent",
                        status="error",
                        elapsed=round(t_script_elapsed, 1),
                    ),
                )
            return

        segments = _parse_script_output(raw_script)

        # Enrich segments with narrative_role from scene_briefs if missing
        scene_briefs_raw: list[dict[str, Any]] = ctx.session.state.get("scene_briefs", [])
        narrative_role_by_scene: dict[str, str] = {
            b.get("scene_id", ""): b.get("narrative_role", "")
            for b in scene_briefs_raw
        }
        for seg in segments:
            if not seg.narrative_role:
                seg.narrative_role = narrative_role_by_scene.get(seg.scene_id, "")

        if not segments:
            logger.error(
                "Phase III: could not parse any SegmentScript from output for "
                "session %s. Raw output (first 500 chars): %s",
                session_id,
                raw_script[:500],
            )
            if self.emitter is not None:
                await self.emitter.emit(
                    "agent_status",
                    build_agent_status_event(
                        agent_id="script_agent",
                        status="error",
                        elapsed=round(t_script_elapsed, 1),
                    ),
                )
            return

        logger.info(
            "Phase III: parsed %d segments for session %s",
            len(segments),
            session_id,
        )

        # Re-write session.state["script"] as a clean list of dicts so
        # downstream agents (aggregator, visual_director) get consistent data.
        ctx.session.state["script"] = [seg.model_dump() for seg in segments]

        # ------------------------------------------------------------------
        # Persist to Firestore + emit per-segment SSE events
        # ------------------------------------------------------------------
        db = firestore.AsyncClient(project=self.firestore_project)

        for segment in segments:
            try:
                await _write_segment_to_firestore(db, session_id, segment)
                logger.debug(
                    "Wrote segment %s to Firestore for session %s",
                    segment.id,
                    session_id,
                )
            except Exception as exc:
                logger.warning(
                    "Failed to write segment %s to Firestore: %s",
                    segment.id,
                    exc,
                )

            if self.emitter is not None:
                await self.emitter.emit(
                    "segment_update",
                    build_segment_update_event(
                        segment_id=segment.id,
                        scene_id=segment.scene_id,
                        status="generating",
                        title=segment.title,
                        mood=segment.mood,
                    ),
                )

        # ------------------------------------------------------------------
        # Stats update and completion event
        # ------------------------------------------------------------------
        t_total_elapsed = time.monotonic() - t_start

        if self.emitter is not None:
            await self.emitter.emit(
                "stats_update",
                {
                    "type": "stats_update",
                    "segmentsReady": len(segments),
                },
            )
            await self.emitter.emit(
                "agent_status",
                build_agent_status_event(
                    agent_id="script_agent",
                    status="done",
                    elapsed=round(t_total_elapsed, 1),
                    facts=[
                        f"{len(segments)} segment(s) scripted and written to Firestore",
                        "session.state['script'] updated with validated SegmentScript list",
                    ],
                ),
            )

        logger.info(
            "Phase III complete for session %s: %d segments in %.1fs",
            session_id,
            len(segments),
            t_total_elapsed,
        )


# ---------------------------------------------------------------------------
# Factory function
# ---------------------------------------------------------------------------


def build_script_agent_orchestrator(
    emitter: SSEEmitter | None = None,
) -> ScriptAgentOrchestrator:
    """Construct a ``ScriptAgentOrchestrator`` from environment variables.

    Required environment variables:
        - ``GCP_PROJECT_ID``: Google Cloud project ID for Firestore writes.

    Args:
        emitter: Optional SSE emitter for frontend progress events.

    Returns:
        Configured ``ScriptAgentOrchestrator`` ready for pipeline integration.
    """
    return ScriptAgentOrchestrator(
        name="script_agent_orchestrator",
        description=(
            "Phase III: Runs the Script Agent (gemini-2.0-pro) to generate "
            "narration and visual descriptions for each SceneBrief, then "
            "validates the output, writes segments to Firestore, and emits "
            "segment_update SSE events so the frontend Expedition Log updates."
        ),
        firestore_project=os.environ["GCP_PROJECT_ID"],
        emitter=emitter,
    )
