"""Phase III.5 of the AI Historian documentary pipeline: Fact Validation.

Implements the ``FactValidatorAgent`` -- a custom ``BaseAgent`` that acts as a
hallucination firewall between the Script Agent (Phase III) and downstream
visual generation phases.

Architecture
------------
``FactValidatorAgent`` reads the script output (``session.state["script"]``),
the aggregated research (``session.state["aggregated_research"]``), and scene
briefs (``session.state["scene_briefs"]``).  It sends the full script to
Gemini 2.0 Flash with a system instruction that enforces four classification
rules on every sentence in the narration:

1. **SUPPORTED** -- keep exactly as written.
2. **UNSUPPORTED SPECIFIC** -- a date, number, or proper name NOT found in the
   research.  Remove the claim and write a bridging sentence to maintain flow.
3. **UNSUPPORTED PLAUSIBLE** -- a reasonable but unverifiable claim.  Soften
   with hedging language ("according to tradition", "historical accounts
   suggest").
4. **NON-FACTUAL** -- rhetoric, atmosphere, transitions.  Keep exactly as
   written -- never touch these.

The agent produces a JSON output with ``validated_segments`` (the full script
with only ``narration_script`` potentially modified) and a ``report`` with
per-segment validation statistics.

Safety: ``session.state["script"]`` is only overwritten if the number of
validated segments matches the original count.

Session state contract
----------------------
**Inputs** (must be set before this agent runs):
    - ``session.state["script"]``               -- list[dict] of SegmentScript
    - ``session.state["aggregated_research"]``   -- merged research string
    - ``session.state["scene_briefs"]``          -- list[dict] of SceneBrief

**Outputs** (written by this agent):
    - ``session.state["script"]`` -- overwritten with validated narration_scripts
    - ``session.state["validation_report"]`` -- list of per-segment reports
"""

from __future__ import annotations

import json
import logging
import os
import time
from collections.abc import AsyncGenerator
from typing import Any

from google import genai as google_genai
from google.adk.agents.base_agent import BaseAgent
from google.adk.agents.invocation_context import InvocationContext
from google.genai import types as genai_types
from pydantic import ConfigDict, Field

from .sse_helpers import (
    SSEEmitter,
    build_agent_status_event,
    build_pipeline_phase_event,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_MODEL: str = "gemini-2.0-flash"
_MAX_RETRIES: int = 3

# ---------------------------------------------------------------------------
# System instruction
# ---------------------------------------------------------------------------

_SYSTEM_INSTRUCTION: str = """\
You are a rigorous fact-checking editor for a historical documentary narration.

You receive:
1. A list of documentary script segments (each with a narration_script).
2. Aggregated research containing corroborated facts, source citations, and
   confidence labels ([ESTABLISHED FACT], [VERIFIED], [UNVERIFIED], [DISPUTED]).
3. Scene briefs describing the planned documentary scenes.

YOUR TASK:
Review every sentence in every segment's narration_script. Classify each
sentence into exactly one of four categories:

== CATEGORY 1: SUPPORTED ==
The sentence states a claim that appears in the aggregated research with an
[ESTABLISHED FACT] or [VERIFIED] label. Keep the sentence EXACTLY as written.
Do not change a single word.

== CATEGORY 2: UNSUPPORTED SPECIFIC ==
The sentence contains a SPECIFIC factual claim (a date, a number, a proper
name, a quantity, a measurement) that does NOT appear anywhere in the
aggregated research. REMOVE the specific claim entirely. Replace it with a
bridging sentence that maintains narrative flow without asserting the
unverifiable detail.

Examples of UNSUPPORTED SPECIFIC:
- "The temple was built in 347 BCE" (if 347 BCE is not in the research)
- "Over 40,000 workers laboured for decades" (if 40,000 is not in the research)
- "Governor Halil Pasha decreed the tax rate" (if Halil Pasha is not in research)

== CATEGORY 3: UNSUPPORTED PLAUSIBLE ==
The sentence makes a general historical claim that is plausible for the era
and location but is not explicitly confirmed in the research. Soften the
sentence with hedging language. Use phrases like:
- "According to tradition..."
- "Historical accounts suggest..."
- "It is widely believed that..."
- "Scholars have proposed that..."
Do NOT remove the content -- only add the hedging qualifier.

== CATEGORY 4: NON-FACTUAL ==
The sentence is rhetoric, atmospheric description, transition prose, emotional
commentary, or narrative framing. It makes no factual claim. Keep it EXACTLY
as written. Never touch these sentences.

Examples of NON-FACTUAL:
- "The air was thick with the scent of spices."
- "What followed would reshape the region for centuries."
- "But the story does not end here."

CRITICAL RULES:
- Never invent new facts or add information not in the original script.
- Never change mood, tone, or narrative voice.
- Only modify narration_script fields. All other segment fields (id, scene_id,
  title, visual_descriptions, veo2_scene, mood, narrative_role, sources) must
  be copied EXACTLY.
- If you are unsure whether a claim is supported, classify it as
  UNSUPPORTED PLAUSIBLE (soften, do not remove).

OUTPUT FORMAT:
Return a single JSON object with exactly two keys. No markdown fences, no
preamble, no commentary.

{
  "validated_segments": [
    ... complete segment objects, identical to input except narration_script
    may differ where claims were removed or softened ...
  ],
  "report": [
    {
      "segment_id": "segment_0",
      "claims_checked": 12,
      "claims_removed": 1,
      "claims_softened": 2,
      "changes": [
        "Removed unsupported date '347 BCE' -- replaced with bridging sentence",
        "Softened claim about trade volume -- added 'Historical accounts suggest'"
      ]
    }
  ]
}
"""


# ---------------------------------------------------------------------------
# JSON parsing helpers
# ---------------------------------------------------------------------------


def _strip_fences(text: str) -> str:
    """Remove markdown code fences that the model may wrap JSON in."""
    stripped = text.strip()
    if stripped.startswith("```"):
        stripped = stripped.split("\n", 1)[-1]
    if stripped.endswith("```"):
        stripped = stripped.rsplit("```", 1)[0]
    return stripped.strip()


def _parse_validation_output(raw: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Parse the fact validator JSON output.

    Args:
        raw: Raw string from the model response.

    Returns:
        Tuple of (validated_segments, report). Both may be empty on failure.
    """
    cleaned = _strip_fences(raw)
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError as exc:
        logger.error("Fact validator output is not valid JSON: %s", exc)
        return [], []

    if not isinstance(parsed, dict):
        logger.error(
            "Fact validator output is not a JSON object (got %s)",
            type(parsed).__name__,
        )
        return [], []

    validated_segments = parsed.get("validated_segments", [])
    report = parsed.get("report", [])

    if not isinstance(validated_segments, list):
        logger.error("validated_segments is not a list")
        return [], []

    if not isinstance(report, list):
        report = []

    return validated_segments, report


# ---------------------------------------------------------------------------
# FactValidatorAgent -- Phase III.5 BaseAgent
# ---------------------------------------------------------------------------


class FactValidatorAgent(BaseAgent):
    """Phase III.5 orchestrator: validate script narration against research.

    Sends the full script + aggregated research to Gemini 2.0 Flash with a
    strict fact-checking system instruction.  Only overwrites
    ``session.state["script"]`` if the validated output has the same number
    of segments as the original -- preventing partial corruption.

    Emits ``pipeline_phase`` and ``agent_status`` SSE events for frontend
    Expedition Log integration.
    """

    model_config = ConfigDict(arbitrary_types_allowed=True)

    emitter: Any = Field(
        default=None,
        description="Optional SSE emitter for frontend progress events.",
    )
    sub_agents: list[BaseAgent] = Field(
        default_factory=list,
        description=(
            "Declared for ADK BaseAgent compatibility. "
            "No sub-agents -- all work is done via direct Gemini calls."
        ),
    )

    async def _run_async_impl(
        self,
        ctx: InvocationContext,
    ) -> AsyncGenerator[Any, None]:
        """Execute Phase III.5: validate script narration against research.

        Yields nothing (no ADK sub-agent events). The trailing ``yield``
        satisfies the ``AsyncGenerator`` protocol required by ADK.
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
                    label="FACT VALIDATION",
                    message="Cross-referencing narration claims against research evidence",
                ),
            )

        # ------------------------------------------------------------------
        # Load inputs from session state
        # ------------------------------------------------------------------
        original_script: list[dict[str, Any]] = ctx.session.state.get("script", [])
        aggregated_research: str = str(ctx.session.state.get("aggregated_research", ""))
        scene_briefs: list[dict[str, Any]] = ctx.session.state.get("scene_briefs", [])

        if not original_script:
            logger.error(
                "Phase III.5: session.state['script'] is empty for session %s. "
                "Ensure Phase III completed successfully.",
                session_id,
            )
            if self.emitter is not None:
                await self.emitter.emit(
                    "agent_status",
                    build_agent_status_event(
                        agent_id="fact_validator",
                        status="error",
                        query="Cross-referencing narration against research evidence",
                        elapsed=round(time.monotonic() - t_start, 1),
                    ),
                )
            return
            yield  # noqa: unreachable -- satisfies AsyncGenerator protocol

        num_segments = len(original_script)

        # ------------------------------------------------------------------
        # Announce as queued then searching
        # ------------------------------------------------------------------
        if self.emitter is not None:
            await self.emitter.emit(
                "agent_status",
                build_agent_status_event(
                    agent_id="fact_validator",
                    status="queued",
                    query=f"Preparing to validate {num_segments} segment(s)",
                ),
            )
            await self.emitter.emit(
                "agent_status",
                build_agent_status_event(
                    agent_id="fact_validator",
                    status="searching",
                    query="Cross-referencing narration against aggregated research",
                ),
            )

        # ------------------------------------------------------------------
        # Build prompt
        # ------------------------------------------------------------------
        prompt = (
            f"SCRIPT SEGMENTS:\n{json.dumps(original_script, indent=2, ensure_ascii=False)}\n\n"
            f"AGGREGATED RESEARCH:\n{aggregated_research}\n\n"
            f"SCENE BRIEFS:\n{json.dumps(scene_briefs, indent=2, ensure_ascii=False)}"
        )

        # ------------------------------------------------------------------
        # Call Gemini 2.0 Flash with retry
        # ------------------------------------------------------------------
        client = google_genai.Client(
            vertexai=True,
            project=os.environ["GCP_PROJECT_ID"],
            location=os.environ.get("VERTEX_AI_LOCATION", "us-central1"),
        )

        raw_text: str | None = None
        last_error: Exception | None = None

        for attempt in range(_MAX_RETRIES):
            try:
                response = await client.aio.models.generate_content(
                    model=_MODEL,
                    contents=prompt,
                    config=genai_types.GenerateContentConfig(
                        system_instruction=_SYSTEM_INSTRUCTION,
                        max_output_tokens=8192,
                        temperature=0.1,
                    ),
                )
                raw_text = response.text
                break
            except Exception as exc:
                last_error = exc
                wait = 2 ** attempt
                logger.warning(
                    "Phase III.5: Gemini call attempt %d/%d failed: %s. "
                    "Retrying in %ds.",
                    attempt + 1,
                    _MAX_RETRIES,
                    exc,
                    wait,
                )
                import asyncio
                await asyncio.sleep(wait)

        if raw_text is None:
            logger.error(
                "Phase III.5: all %d Gemini retries exhausted for session %s: %s",
                _MAX_RETRIES,
                session_id,
                last_error,
            )
            if self.emitter is not None:
                await self.emitter.emit(
                    "agent_status",
                    build_agent_status_event(
                        agent_id="fact_validator",
                        status="error",
                        query="Cross-referencing narration against research evidence",
                        elapsed=round(time.monotonic() - t_start, 1),
                    ),
                )
            return
            yield  # noqa: unreachable

        # ------------------------------------------------------------------
        # Parse and validate output
        # ------------------------------------------------------------------
        validated_segments, report = _parse_validation_output(raw_text)

        t_elapsed = round(time.monotonic() - t_start, 1)

        # Safety check: only overwrite if segment count matches
        if len(validated_segments) != num_segments:
            logger.error(
                "Phase III.5: validated_segments count (%d) does not match "
                "original script count (%d) for session %s. "
                "Keeping original script unchanged.",
                len(validated_segments),
                num_segments,
                session_id,
            )
            if self.emitter is not None:
                await self.emitter.emit(
                    "agent_status",
                    build_agent_status_event(
                        agent_id="fact_validator",
                        status="done",
                        query="Cross-referencing narration against research evidence",
                        elapsed=t_elapsed,
                        facts=[
                            f"Segment count mismatch ({len(validated_segments)} vs {num_segments})",
                            "Original script preserved unchanged",
                        ],
                    ),
                )
            # Store report even on mismatch for debugging
            ctx.session.state["validation_report"] = report
            return
            yield  # noqa: unreachable

        # ------------------------------------------------------------------
        # Overwrite session.state["script"] with validated narration
        # ------------------------------------------------------------------
        ctx.session.state["script"] = validated_segments
        ctx.session.state["validation_report"] = report

        # Clean up intermediate output key if it was set
        ctx.session.state.pop("validation_output", None)

        # Compute summary stats from report
        total_checked = sum(r.get("claims_checked", 0) for r in report)
        total_removed = sum(r.get("claims_removed", 0) for r in report)
        total_softened = sum(r.get("claims_softened", 0) for r in report)

        logger.info(
            "Phase III.5 complete for session %s: %d claims checked, "
            "%d removed, %d softened in %.1fs",
            session_id,
            total_checked,
            total_removed,
            total_softened,
            t_elapsed,
        )

        # ------------------------------------------------------------------
        # Emit completion events
        # ------------------------------------------------------------------
        if self.emitter is not None:
            await self.emitter.emit(
                "agent_status",
                build_agent_status_event(
                    agent_id="fact_validator",
                    status="done",
                    query="Cross-referencing narration against research evidence",
                    elapsed=t_elapsed,
                    facts=[
                        f"{total_checked} claims checked across {num_segments} segments",
                        f"{total_removed} unsupported claims removed",
                        f"{total_softened} claims softened with hedging language",
                        "session.state['script'] updated with validated narration",
                    ],
                ),
            )

        return
        yield  # noqa: unreachable -- satisfies AsyncGenerator protocol


# ---------------------------------------------------------------------------
# Factory function
# ---------------------------------------------------------------------------


def build_fact_validator_agent(
    emitter: SSEEmitter | None = None,
) -> FactValidatorAgent:
    """Construct a ``FactValidatorAgent`` ready for pipeline integration.

    Args:
        emitter: Optional SSE emitter for frontend progress events.

    Returns:
        Configured ``FactValidatorAgent`` instance.
    """
    return FactValidatorAgent(
        name="fact_validator_agent",
        description=(
            "Phase III.5: Cross-references every narration claim against "
            "aggregated research evidence. Removes unsupported specific claims, "
            "softens unverifiable plausible claims, and preserves rhetoric and "
            "atmosphere. Acts as a hallucination firewall between script "
            "generation and visual production."
        ),
        emitter=emitter,
    )
