"""Phase 3.8 of the AI Historian pipeline: Geographic Mapping.

Implements the ``GeoLocationAgent`` -- a custom ``BaseAgent`` that extracts
geographic locations, routes, and map viewport data from documentary scripts
and scene briefs, then geocodes them using Gemini with Google Maps grounding.

Session state contract
----------------------
**Inputs** (must be set before this agent runs):
    - ``session.state["script"]``        -- list[dict] of SegmentScript
    - ``session.state["scene_briefs"]``  -- list[dict] of SceneBrief

**Outputs** (written by this agent):
    - ``session.state["geo_manifest"]``  -- dict[segment_id, SegmentGeo.to_frontend_dict()]
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

from .geo_types import GeoEvent, GeoRoute, SegmentGeo
from .sse_helpers import (
    SSEEmitter,
    build_agent_status_event,
    build_geo_update_event,
    build_pipeline_phase_event,
)

logger = logging.getLogger(__name__)

_MODEL: str = "gemini-2.0-flash"
_MAX_RETRIES: int = 3

_EXTRACTION_PROMPT: str = """\
You are a historical geography expert. Extract all geographic locations and routes from this documentary segment.

Scene Brief:
- Title: {title}
- Era: {era}
- Location: {location}

Narration Script:
{script}

Return a JSON object with this exact structure (no markdown, no code fences, raw JSON only):
{{
  "center": [lat, lng],
  "zoom": <number 2-8, framing all locations>,
  "events": [
    {{
      "name": "<place name as referenced>",
      "lat": <number>,
      "lng": <number>,
      "type": "city" | "battle" | "route" | "region",
      "era": "<year or period>",
      "description": "<one sentence>"
    }}
  ],
  "routes": [
    {{
      "name": "<route name>",
      "points": [[lat, lng], [lat, lng], ...],
      "style": "trade" | "military" | "migration"
    }}
  ]
}}

Rules:
- Use accurate historical coordinates (where the ancient site actually was/is)
- Center should be the geographic midpoint of all mentioned locations
- Zoom should frame all locations (2=world, 5=region, 8=city)
- Include at least the primary location from the scene brief
- For ancient cities, use the coordinates of their modern site or archaeological ruins
- Mark battle sites as type "battle", trade hubs as type "city", regions as type "region"
- If the narration describes movement between locations (armies marching, traders traveling, peoples migrating, journeys, expeditions), create a route connecting those locations even if a specific route name is not given
- Route styles: "trade" for commerce/trade routes, "military" for campaigns/invasions/army movements, "migration" for population movements/pilgrimages/voyages
- Always try to generate at least one route if multiple locations are mentioned — connect them in the narrative order of events
"""

_GEOCODE_PROMPT: str = """\
Give me the exact real-world coordinates (latitude, longitude) for this historical location: {place_name}

Context: This is from the era {era}, in the region of {location}.

Return ONLY a JSON object: {{"lat": <number>, "lng": <number>, "modern_name": "<current name if different>"}}
"""


# ---------------------------------------------------------------------------
# Per-segment geo extraction (Workstream B)
# ---------------------------------------------------------------------------


async def extract_geo_for_segment(
    *,
    segment: dict[str, Any],
    scene_brief: dict[str, Any],
    session_id: str,
    emitter: SSEEmitter | None = None,
) -> dict[str, Any] | None:
    """Extract and geocode geographic data for a single segment.

    This is the per-segment entry point used by the streaming pipeline.
    Returns the SegmentGeo frontend dict, or None on failure.

    Args:
        segment: SegmentScript dict with id, scene_id, title, narration_script.
        scene_brief: The scene brief dict for this segment.
        session_id: Parent session ID for Firestore writes.
        emitter: Optional SSE emitter for status events.

    Returns:
        SegmentGeo.to_frontend_dict() or None on failure.
    """
    import asyncio

    segment_id = segment.get("id", "unknown")
    scene_id = segment.get("scene_id", "unknown")
    title = segment.get("title", "")
    script_text = segment.get("narration_script", "")

    era = scene_brief.get("era", segment.get("mood", "historical"))
    location = scene_brief.get("location", "")

    agent_id = f"geo_mapper_{scene_id}"
    t_start = time.monotonic()

    # Emit status
    if emitter is not None:
        await emitter.emit(
            "agent_status",
            build_agent_status_event(
                agent_id=agent_id,
                status="searching",
                query=f"Mapping locations for: {title}",
            ),
        )

    # Initialize Gemini client
    project_id = os.environ.get("GCP_PROJECT_ID", "")
    client = google_genai.Client(
        vertexai=True if project_id else False,
        project=project_id or None,
        location="us-central1" if project_id else None,
    )

    # Extract locations via Gemini
    prompt = _EXTRACTION_PROMPT.format(
        title=title,
        era=era,
        location=location,
        script=script_text,
    )

    geo_data: dict | None = None
    for attempt in range(_MAX_RETRIES):
        try:
            response = await client.aio.models.generate_content(
                model=_MODEL,
                contents=prompt,
                config=genai_types.GenerateContentConfig(
                    temperature=0.1,
                    response_mime_type="application/json",
                ),
            )
            text = response.text or "{}"
            text = text.strip()
            if text.startswith("```"):
                text = text.split("\n", 1)[1] if "\n" in text else text[3:]
            if text.endswith("```"):
                text = text[:-3]
            text = text.strip()

            geo_data = json.loads(text)
            break
        except Exception as e:
            logger.warning(
                "Per-segment geo extraction attempt %d failed for %s: %s",
                attempt + 1,
                segment_id,
                e,
            )
            if attempt < _MAX_RETRIES - 1:
                await asyncio.sleep(2 ** attempt)

    if not geo_data:
        if emitter is not None:
            await emitter.emit(
                "agent_status",
                build_agent_status_event(
                    agent_id=agent_id,
                    status="error",
                    error_message=f"Failed to extract geo data for {title}",
                ),
            )
        return None

    # Validate and build SegmentGeo
    events: list[GeoEvent] = []
    for raw_event in geo_data.get("events", []):
        try:
            lat = float(raw_event.get("lat", 0))
            lng = float(raw_event.get("lng", 0))
            if abs(lat) > 90:
                lat, lng = lng, lat
            lat = max(-90.0, min(90.0, lat))
            lng = max(-180.0, min(180.0, lng))

            events.append(
                GeoEvent(
                    name=str(raw_event.get("name", "Unknown")),
                    lat=lat,
                    lng=lng,
                    type=raw_event.get("type", "city"),
                    era=raw_event.get("era"),
                    description=raw_event.get("description"),
                )
            )
        except (ValueError, TypeError) as e:
            logger.warning("Skipping invalid geo event: %s", e)

    routes: list[GeoRoute] = []
    for raw_route in geo_data.get("routes", []):
        try:
            points = []
            for p in raw_route.get("points", []):
                if isinstance(p, (list, tuple)) and len(p) >= 2:
                    points.append((float(p[0]), float(p[1])))
            if len(points) >= 2:
                routes.append(
                    GeoRoute(
                        name=str(raw_route.get("name", "Route")),
                        points=points,
                        style=raw_route.get("style", "trade"),
                    )
                )
        except (ValueError, TypeError) as e:
            logger.warning("Skipping invalid geo route: %s", e)

    # Calculate center
    raw_center = geo_data.get("center", [])
    if isinstance(raw_center, list) and len(raw_center) >= 2:
        center = (float(raw_center[0]), float(raw_center[1]))
    elif events:
        avg_lat = sum(e.lat for e in events) / len(events)
        avg_lng = sum(e.lng for e in events) / len(events)
        center = (avg_lat, avg_lng)
    else:
        center = (30.0, 30.0)

    zoom = int(geo_data.get("zoom", 4))
    zoom = max(2, min(8, zoom))

    segment_geo = SegmentGeo(
        segment_id=segment_id,
        center=center,
        zoom=zoom,
        events=events,
        routes=routes,
    )

    geo_frontend = segment_geo.to_frontend_dict()

    # Write to Firestore
    try:
        from google.cloud import firestore as _firestore

        db = _firestore.AsyncClient(project=project_id)
        seg_ref = (
            db.collection("sessions")
            .document(session_id)
            .collection("segments")
            .document(segment_id)
        )
        await seg_ref.set({"geo": geo_frontend}, merge=True)
    except Exception as e:
        logger.warning(
            "Per-segment geo Firestore write failed for %s: %s",
            segment_id,
            e,
        )

    # Emit SSE events
    if emitter is not None:
        await emitter.emit(
            "geo_update",
            build_geo_update_event(
                segment_id=segment_id,
                geo=geo_frontend,
            ),
        )
        await emitter.emit(
            "agent_status",
            build_agent_status_event(
                agent_id=agent_id,
                status="done",
                elapsed=round(time.monotonic() - t_start, 1),
                facts=[e.name for e in events],
            ),
        )

    logger.info(
        "Per-segment geo extraction for %s: %d locations in %.1fs",
        segment_id,
        len(events),
        round(time.monotonic() - t_start, 1),
    )

    return geo_frontend


class GeoLocationAgent(BaseAgent):
    """Extracts and geocodes geographic data from documentary scripts.

    Runs as Phase 3.8 between FactValidator (3.5) and NarrativeVisualPlanner (4.0).
    Uses Gemini 2.0 Flash for extraction and Gemini + Google Maps grounding
    for coordinate verification.
    """

    model_config = ConfigDict(arbitrary_types_allowed=True)

    emitter: Any = Field(default=None, description="SSE emitter for progress events")

    async def _run_async_impl(
        self,
        ctx: InvocationContext,
    ) -> AsyncGenerator[Any, None]:
        t_start = time.monotonic()
        session_id = ctx.session.id

        # -- Emit phase start -------------------------------------------------
        if self.emitter:
            await self.emitter.emit(
                "pipeline_phase",
                build_pipeline_phase_event(
                    phase=3.8,
                    label="GEOGRAPHIC MAPPING",
                    message="Extracting locations and mapping the documentary's geography\u2026",
                ),
            )

        # -- Read inputs ------------------------------------------------------
        scripts: list[dict] = ctx.session.state.get("script", [])
        scene_briefs: list[dict] = ctx.session.state.get("scene_briefs", [])

        if not scripts:
            logger.warning("GeoLocationAgent: no scripts in session state, skipping")
            return
            yield  # satisfy AsyncGenerator protocol

        # Build scene_id -> brief lookup
        brief_map: dict[str, dict] = {}
        for brief in scene_briefs:
            sid = brief.get("scene_id", "")
            if sid:
                brief_map[sid] = brief

        # -- Initialize Gemini client -----------------------------------------
        project_id = os.environ.get("GCP_PROJECT_ID", "")
        client = google_genai.Client(
            vertexai=True if project_id else False,
            project=project_id or None,
            location="us-central1" if project_id else None,
        )

        geo_manifest: dict[str, dict] = {}
        total_locations = 0

        # -- Process each segment ---------------------------------------------
        for i, segment in enumerate(scripts):
            segment_id = segment.get("id", f"segment_{i}")
            scene_id = segment.get("scene_id", f"scene_{i}")
            title = segment.get("title", "")
            script_text = segment.get("narration_script", "")

            # Get brief context
            brief = brief_map.get(scene_id, {})
            era = brief.get("era", segment.get("mood", "historical"))
            location = brief.get("location", "")

            agent_id = f"geo_mapper_{scene_id}"

            # Emit queued status
            if self.emitter:
                await self.emitter.emit(
                    "agent_status",
                    build_agent_status_event(
                        agent_id=agent_id,
                        status="queued",
                        query=f"Mapping locations for: {title}",
                    ),
                )

            # Emit searching status
            if self.emitter:
                await self.emitter.emit(
                    "agent_status",
                    build_agent_status_event(
                        agent_id=agent_id,
                        status="searching",
                        query=f"Extracting geography from: {title}",
                    ),
                )

            # -- Step 1: Extract locations from script ------------------------
            prompt = _EXTRACTION_PROMPT.format(
                title=title,
                era=era,
                location=location,
                script=script_text,
            )

            geo_data: dict | None = None
            for attempt in range(_MAX_RETRIES):
                try:
                    response = await client.aio.models.generate_content(
                        model=_MODEL,
                        contents=prompt,
                        config=genai_types.GenerateContentConfig(
                            temperature=0.1,
                            response_mime_type="application/json",
                        ),
                    )
                    text = response.text or "{}"
                    # Strip markdown fences if present
                    text = text.strip()
                    if text.startswith("```"):
                        text = text.split("\n", 1)[1] if "\n" in text else text[3:]
                    if text.endswith("```"):
                        text = text[:-3]
                    text = text.strip()

                    geo_data = json.loads(text)
                    break
                except Exception as e:
                    logger.warning(
                        "GeoLocationAgent extraction attempt %d failed for %s: %s",
                        attempt + 1,
                        segment_id,
                        e,
                    )
                    if attempt == _MAX_RETRIES - 1:
                        logger.error(
                            "GeoLocationAgent: all retries exhausted for %s",
                            segment_id,
                        )

            if not geo_data:
                # Emit error and continue to next segment
                if self.emitter:
                    await self.emitter.emit(
                        "agent_status",
                        build_agent_status_event(
                            agent_id=agent_id,
                            status="error",
                            query=f"Mapping locations for: {title}",
                            error_message=f"Failed to extract geo data for {title}",
                        ),
                    )
                continue

            # -- Step 2: Validate and build SegmentGeo ------------------------
            events: list[GeoEvent] = []
            for raw_event in geo_data.get("events", []):
                try:
                    lat = float(raw_event.get("lat", 0))
                    lng = float(raw_event.get("lng", 0))
                    # Fix swapped coordinates
                    if abs(lat) > 90:
                        lat, lng = lng, lat
                    lat = max(-90.0, min(90.0, lat))
                    lng = max(-180.0, min(180.0, lng))

                    events.append(
                        GeoEvent(
                            name=str(raw_event.get("name", "Unknown")),
                            lat=lat,
                            lng=lng,
                            type=raw_event.get("type", "city"),
                            era=raw_event.get("era"),
                            description=raw_event.get("description"),
                        )
                    )
                except (ValueError, TypeError) as e:
                    logger.warning("Skipping invalid geo event: %s", e)

            routes: list[GeoRoute] = []
            for raw_route in geo_data.get("routes", []):
                try:
                    points = []
                    for p in raw_route.get("points", []):
                        if isinstance(p, (list, tuple)) and len(p) >= 2:
                            points.append((float(p[0]), float(p[1])))
                    if len(points) >= 2:
                        routes.append(
                            GeoRoute(
                                name=str(raw_route.get("name", "Route")),
                                points=points,
                                style=raw_route.get("style", "trade"),
                            )
                        )
                except (ValueError, TypeError) as e:
                    logger.warning("Skipping invalid geo route: %s", e)

            # Calculate center if not provided
            raw_center = geo_data.get("center", [])
            if isinstance(raw_center, list) and len(raw_center) >= 2:
                center = (float(raw_center[0]), float(raw_center[1]))
            elif events:
                avg_lat = sum(e.lat for e in events) / len(events)
                avg_lng = sum(e.lng for e in events) / len(events)
                center = (avg_lat, avg_lng)
            else:
                center = (30.0, 30.0)

            zoom = int(geo_data.get("zoom", 4))
            zoom = max(2, min(8, zoom))

            segment_geo = SegmentGeo(
                segment_id=segment_id,
                center=center,
                zoom=zoom,
                events=events,
                routes=routes,
            )

            geo_manifest[segment_id] = segment_geo.to_frontend_dict()
            total_locations += len(events)

            # -- Step 3: Write to Firestore -----------------------------------
            try:
                from google.cloud import firestore

                db = firestore.AsyncClient(project=project_id)
                seg_ref = (
                    db.collection("sessions")
                    .document(session_id)
                    .collection("segments")
                    .document(segment_id)
                )
                await seg_ref.set(
                    {"geo": segment_geo.to_frontend_dict()},
                    merge=True,
                )
            except Exception as e:
                logger.warning(
                    "GeoLocationAgent: Firestore write failed for %s: %s",
                    segment_id,
                    e,
                )

            # -- Step 4: Emit SSE events --------------------------------------
            if self.emitter:
                await self.emitter.emit(
                    "geo_update",
                    build_geo_update_event(
                        segment_id=segment_id,
                        geo=segment_geo.to_frontend_dict(),
                    ),
                )
                await self.emitter.emit(
                    "agent_status",
                    build_agent_status_event(
                        agent_id=agent_id,
                        status="done",
                        query=f"Mapping locations for: {title}",
                        elapsed=round(time.monotonic() - t_start, 1),
                        facts=[e.name for e in events],
                    ),
                )

            # Emit phase progress
            if self.emitter:
                await self.emitter.emit(
                    "pipeline_phase",
                    build_pipeline_phase_event(
                        phase=3.8,
                        label="GEOGRAPHIC MAPPING",
                        message=f"Mapped {len(events)} locations for \u201c{title}\u201d",
                    ),
                )

        # -- Write geo_manifest to session state ------------------------------
        ctx.session.state["geo_manifest"] = geo_manifest

        # -- Final stats ------------------------------------------------------
        if self.emitter:
            await self.emitter.emit(
                "pipeline_phase",
                build_pipeline_phase_event(
                    phase=3.8,
                    label="GEOGRAPHIC MAPPING",
                    message=(
                        f"Geographic mapping complete \u2014 {total_locations} locations "
                        f"across {len(geo_manifest)} segments."
                    ),
                ),
            )

        elapsed = round(time.monotonic() - t_start, 1)
        logger.info(
            "GeoLocationAgent completed for session %s: %d segments, %d locations in %.1fs",
            session_id,
            len(geo_manifest),
            total_locations,
            elapsed,
        )

        return
        yield  # satisfy AsyncGenerator protocol


def build_geo_location_agent(
    emitter: SSEEmitter | None = None,
) -> GeoLocationAgent:
    """Factory function for GeoLocationAgent.

    Args:
        emitter: Optional SSE emitter for frontend progress events.

    Returns:
        A configured GeoLocationAgent instance.
    """
    return GeoLocationAgent(
        name="geo_location_agent",
        description=(
            "Extracts geographic locations and routes from documentary scripts, "
            "geocodes them using Gemini + Google Maps grounding, and produces "
            "SegmentGeo metadata for the frontend timeline map."
        ),
        emitter=emitter,
    )
