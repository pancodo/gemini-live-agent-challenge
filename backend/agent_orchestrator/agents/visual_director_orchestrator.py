"""Phase V of the AI Historian documentary pipeline: Visual Generation.

Implements the ``VisualDirectorOrchestrator`` — a custom ``BaseAgent`` that reads
``VisualDetailManifest`` objects (from Phase IV) and produces Imagen 3 images and
Veo 2 videos for each documentary segment.

Architecture
------------
For each segment the orchestrator:

1. Builds an Imagen 3 prompt from the enriched_prompt in the visual manifest,
   or falls back to the script's ``visual_descriptions`` if no manifest exists.
2. Calls Imagen 3 (``imagen-3.0-fast-generate-001``) four times concurrently —
   one image per visual frame — with frame-specific composition modifiers.
3. Uploads generated JPEG bytes to GCS at a predictable path structure and
   persists the GCS URIs to the Firestore segment document.
4. Triggers a Veo 2 (``veo-2.0-generate-001``) generation if the segment has a
   ``veo2_scene`` description. Veo 2 operations are long-running (~1–2 min) and
   are polled after all Imagen 3 work completes.
5. Emits ``segment_update(status="complete")`` SSE events so the frontend
   ``DocumentaryPlayer`` can begin loading visual assets.

Progressive delivery
--------------------
Scene 0 runs ahead of all other scenes. Its four Imagen 3 frames are generated
and the ``segment_update`` SSE event emitted before any subsequent scene starts.
All remaining scenes are then generated concurrently via ``asyncio.gather``.

Veo 2 polling
-------------
After all Imagen 3 generation completes, the orchestrator polls every outstanding
Veo 2 operation concurrently. When each finishes, Firestore is updated with the
video GCS URI and another ``segment_update`` SSE event is emitted.

Session state contract
----------------------
**Inputs** (must be set before Phase V runs):
    - ``session.state["script"]``                   — list[dict] of SegmentScript dicts (Phase III)
    - ``session.state["visual_research_manifest"]`` — dict[scene_id, dict] (Phase IV)
    - ``session.state["visual_bible"]``             — Imagen 3 style guide string (Phase I)

**Outputs** (written by this agent):
    - ``session.state["image_urls"]``  — dict[segment_id, list[str]] of GCS image URIs
    - ``session.state["video_urls"]``  — dict[segment_id, str] of GCS video URIs
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from collections.abc import AsyncGenerator
from functools import partial
from typing import Any

from google import genai as google_genai
from google.adk.agents.base_agent import BaseAgent
from google.adk.agents.invocation_context import InvocationContext
from google.cloud import firestore, storage
from google.genai import types as genai_types
from pydantic import ConfigDict, Field

from .sse_helpers import (
    SSEEmitter,
    build_agent_status_event,
    build_pipeline_phase_event,
    build_segment_update_event,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_FRAMES_PER_SEGMENT: int = 4
_IMAGEN_MODEL: str = "imagen-3.0-fast-generate-001"
_VEO2_MODEL: str = "veo-2.0-generate-001"
_VEO2_POLL_INTERVAL_SECONDS: int = 20
_VEO2_MAX_POLLS: int = 30  # 30 × 20s = 10-minute timeout per operation

# Each frame in a segment gets a distinct composition modifier.
# Combined with the enriched_prompt base, this produces four visually coherent
# but compositionally distinct images per scene.
_FRAME_MODIFIERS: list[str] = [
    "Wide establishing shot. Full scene composition, 16:9 cinematic framing, "
    "environment and spatial context dominant.",
    "Medium shot. Focus on central figures and primary objects. "
    "Human scale, interaction and relationship visible.",
    "Close-up detail shot. Emphasise textures, materials, and atmospheric elements. "
    "Macro detail that grounds the period and place.",
    "Dramatic alternative angle. Low or elevated perspective, "
    "cinematic depth of field, strong foreground-to-background layering.",
]

_BASE_NEGATIVE_PROMPT: str = (
    "text, watermark, logo, letters, numbers, typography, signage, "
    "modern elements, anachronisms, contemporary objects, CGI look, "
    "blurry, low quality, overexposed, underexposed, photoshop artifacts, "
    "lens flare, chromatic aberration"
)


# ---------------------------------------------------------------------------
# GCS helpers (sync operations run via executor from async context)
# ---------------------------------------------------------------------------


def _upload_image_bytes_sync(
    image_bytes: bytes,
    bucket_name: str,
    blob_name: str,
) -> str:
    """Upload raw JPEG bytes to GCS and return the gs:// URI.

    Creates a new GCS storage client per call (safe for executor threads).
    """
    client = storage.Client()
    blob = client.bucket(bucket_name).blob(blob_name)
    blob.upload_from_string(data=image_bytes, content_type="image/jpeg")
    return f"gs://{bucket_name}/{blob_name}"


async def _upload_image_bytes_async(
    image_bytes: bytes,
    bucket_name: str,
    blob_name: str,
) -> str:
    """Async wrapper: run synchronous GCS upload in a thread executor.

    Args:
        image_bytes: Raw JPEG image data from Imagen 3.
        bucket_name: Target GCS bucket.
        blob_name: Full blob path within the bucket.

    Returns:
        GCS URI in the form ``gs://{bucket_name}/{blob_name}``.
    """
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(
        None,
        partial(_upload_image_bytes_sync, image_bytes, bucket_name, blob_name),
    )


# ---------------------------------------------------------------------------
# Prompt construction
# ---------------------------------------------------------------------------


def _build_imagen_prompt(
    segment: dict[str, Any],
    manifest: dict[str, Any] | None,
    visual_bible: str,
    frame_idx: int,
) -> tuple[str, str]:
    """Build an Imagen 3 (prompt, negative_prompt) pair for a single frame.

    Priority rule:
      1. If ``manifest.enriched_prompt`` exists → combine visual_bible prefix +
         enriched_prompt + frame-specific composition modifier.  The era_markers
         from ``manifest.detail_fields`` are appended to the negative prompt.
      2. No manifest (or empty enriched_prompt) → combine visual_bible + the
         script's ``visual_descriptions[frame_idx]``.
      3. No visual_descriptions → generic cinematic fallback built from segment
         title and mood.

    Args:
        segment: SegmentScript dict from session.state["script"].
        manifest: VisualDetailManifest dict for this scene, or None.
        visual_bible: Imagen 3 style guide string from Phase I.
        frame_idx: 0–3 index selecting the frame composition modifier.

    Returns:
        Tuple of (prompt, negative_prompt).
    """
    frame_modifier = _FRAME_MODIFIERS[frame_idx % len(_FRAME_MODIFIERS)]

    # --- Priority 1: Use enriched research prompt from Phase IV ---
    if manifest and manifest.get("enriched_prompt"):
        enriched: str = manifest["enriched_prompt"]
        detail_fields: dict[str, Any] = manifest.get("detail_fields", {})
        era_markers: list[str] = detail_fields.get("era_markers", [])

        prompt = (
            f"{visual_bible}\n\n"
            f"{enriched}\n\n"
            f"Frame composition: {frame_modifier}"
        )

        negative = _BASE_NEGATIVE_PROMPT
        if era_markers:
            # Era markers describe elements that should NOT appear
            # (e.g. "no mechanical clocks visible", "oil lanterns only").
            # Appending them strengthens anachronism prevention.
            negative = f"{negative}, {', '.join(era_markers)}"

        return prompt, negative

    # --- Priority 2: Fall back to script's per-frame visual_descriptions ---
    visual_descriptions: list[str] = segment.get("visual_descriptions", [])
    if visual_descriptions:
        desc = visual_descriptions[frame_idx % len(visual_descriptions)]
        prompt = (
            f"{visual_bible}\n\n"
            f"{desc}\n\n"
            f"Frame composition: {frame_modifier}"
        )
        return prompt, _BASE_NEGATIVE_PROMPT

    # --- Priority 3: Generic fallback ---
    title: str = segment.get("title", "historical documentary scene")
    mood: str = segment.get("mood", "cinematic")
    prompt = (
        f"{visual_bible}\n\n"
        f"A {mood} historical documentary scene: {title}. "
        f"Period-accurate, no anachronisms. "
        f"Frame composition: {frame_modifier}"
    )
    return prompt, _BASE_NEGATIVE_PROMPT


# ---------------------------------------------------------------------------
# Imagen 3 generation
# ---------------------------------------------------------------------------


async def _generate_one_frame(
    client: google_genai.Client,
    semaphore: asyncio.Semaphore,
    prompt: str,
    negative_prompt: str,
    bucket_name: str,
    blob_name: str,
) -> str | None:
    """Generate a single Imagen 3 frame, upload to GCS, return GCS URI.

    Returns ``None`` if the image is filtered by Imagen 3's safety system or
    if an API error occurs — the caller handles partial completion gracefully.

    Args:
        client: Shared google-genai Vertex AI client.
        semaphore: Rate-limit gate shared across all concurrent scenes.
        prompt: Full Imagen 3 text prompt.
        negative_prompt: Comma-separated elements to exclude.
        bucket_name: GCS bucket for upload.
        blob_name: Target blob path within the bucket.

    Returns:
        GCS URI string or ``None`` on failure.
    """
    async with semaphore:
        try:
            response = await client.aio.models.generate_images(
                model=_IMAGEN_MODEL,
                prompt=prompt,
                config=genai_types.GenerateImagesConfig(
                    number_of_images=1,
                    aspect_ratio="16:9",
                    negative_prompt=negative_prompt,
                    safety_filter_level="BLOCK_MEDIUM_AND_ABOVE",
                    person_generation="allow_adult",
                    output_mime_type="image/jpeg",
                    output_compression_quality=90,
                    enhance_prompt=True,
                ),
            )

            if not response.generated_images:
                logger.warning(
                    "Imagen 3 returned no images for %s (content likely filtered)",
                    blob_name,
                )
                return None

            image_bytes: bytes | None = (
                response.generated_images[0].image.image_bytes
            )
            if not image_bytes:
                logger.warning(
                    "Imagen 3 image_bytes is empty for %s", blob_name
                )
                return None

            gcs_uri = await _upload_image_bytes_async(
                image_bytes, bucket_name, blob_name
            )
            logger.debug("Uploaded Imagen 3 frame to %s", gcs_uri)
            return gcs_uri

        except Exception as exc:
            logger.warning(
                "Imagen 3 frame generation failed for %s: %s", blob_name, exc
            )
            return None


async def _generate_segment_images(
    client: google_genai.Client,
    semaphore: asyncio.Semaphore,
    segment: dict[str, Any],
    manifest: dict[str, Any] | None,
    visual_bible: str,
    session_id: str,
    bucket_name: str,
) -> list[str]:
    """Generate all four Imagen 3 frames for one segment concurrently.

    All four frames run in parallel via ``asyncio.gather``.  Frames that fail
    (filtered content, API error) are silently dropped — the segment still gets
    whichever frames succeeded.

    Args:
        client: Shared google-genai client.
        semaphore: Rate-limit gate.
        segment: SegmentScript dict.
        manifest: VisualDetailManifest dict for this scene, or ``None``.
        visual_bible: Imagen 3 style guide string.
        session_id: Session ID used to construct the GCS blob path.
        bucket_name: Target GCS bucket.

    Returns:
        List of GCS URIs for successfully generated frames (0–4 items).
    """
    segment_id: str = segment.get("id", "unknown")
    frame_tasks = []

    for frame_idx in range(_FRAMES_PER_SEGMENT):
        prompt, negative = _build_imagen_prompt(
            segment, manifest, visual_bible, frame_idx
        )
        blob_name = (
            f"sessions/{session_id}/images/{segment_id}/frame_{frame_idx}.jpg"
        )
        frame_tasks.append(
            _generate_one_frame(
                client=client,
                semaphore=semaphore,
                prompt=prompt,
                negative_prompt=negative,
                bucket_name=bucket_name,
                blob_name=blob_name,
            )
        )

    results: list[str | None] = await asyncio.gather(*frame_tasks)
    return [uri for uri in results if uri is not None]


# ---------------------------------------------------------------------------
# Veo 2 generation
# ---------------------------------------------------------------------------


async def _trigger_veo2_generation(
    client: google_genai.Client,
    veo2_prompt: str,
    session_id: str,
    scene_id: str,
    bucket_name: str,
) -> Any | None:
    """Fire a Veo 2 text-to-video request and immediately return the operation.

    The operation is **not polled here** — the caller collects all operations
    and polls them together after all Imagen 3 work completes.

    Args:
        client: Shared google-genai Vertex AI client.
        veo2_prompt: Dramatic scene description for Veo 2.
        session_id: Session ID for GCS output path construction.
        scene_id: Scene ID for GCS output path construction.
        bucket_name: GCS bucket where Veo 2 writes the MP4.

    Returns:
        The long-running operation object, or ``None`` on immediate failure.
    """
    output_uri = (
        f"gs://{bucket_name}/sessions/{session_id}/videos/{scene_id}/"
    )
    try:
        operation = await client.aio.models.generate_videos(
            model=_VEO2_MODEL,
            prompt=veo2_prompt,
            config=genai_types.GenerateVideosConfig(
                aspect_ratio="16:9",
                number_of_videos=1,
                duration_seconds=5,
                enhance_prompt=True,
                person_generation="dont_allow",
                output_gcs_uri=output_uri,
            ),
        )
        logger.info(
            "Triggered Veo 2 for scene %s → output: %s", scene_id, output_uri
        )
        return operation
    except Exception as exc:
        logger.warning("Veo 2 trigger failed for %s: %s", scene_id, exc)
        return None


async def _poll_veo2_operation(
    client: google_genai.Client,
    operation: Any,
    segment_id: str,
    scene_id: str,
) -> str | None:
    """Poll a Veo 2 long-running operation until completion.

    Uses ``asyncio.sleep`` between polls so other coroutines (SSE emission,
    Firestore writes) can progress.  ``client.operations.get`` is synchronous
    in the SDK, so it is run via ``loop.run_in_executor``.

    Args:
        client: Shared google-genai client.
        operation: The Veo 2 operation object returned by generate_videos.
        segment_id: Segment ID for log messages.
        scene_id: Scene ID for log messages.

    Returns:
        GCS URI (``gs://...``) of the generated MP4, or ``None`` on timeout
        or error.
    """
    loop = asyncio.get_running_loop()

    for poll_num in range(_VEO2_MAX_POLLS):
        if operation.done:
            break
        await asyncio.sleep(_VEO2_POLL_INTERVAL_SECONDS)
        logger.debug(
            "Polling Veo 2 for %s (attempt %d/%d)",
            scene_id,
            poll_num + 1,
            _VEO2_MAX_POLLS,
        )
        try:
            operation = await loop.run_in_executor(
                None, client.operations.get, operation
            )
        except Exception as exc:
            logger.warning(
                "Veo 2 poll error for %s: %s", scene_id, exc
            )
            continue

    if not operation.done:
        logger.warning(
            "Veo 2 operation timed out for %s after %d polls (~%ds)",
            scene_id,
            _VEO2_MAX_POLLS,
            _VEO2_MAX_POLLS * _VEO2_POLL_INTERVAL_SECONDS,
        )
        return None

    try:
        video_uri: str = (
            operation.response.generated_videos[0].video.uri
        )
        logger.info("Veo 2 complete for %s: %s", scene_id, video_uri)
        return video_uri
    except Exception as exc:
        logger.warning(
            "Veo 2 response parse failed for %s: %s", scene_id, exc
        )
        return None


# ---------------------------------------------------------------------------
# Firestore helpers
# ---------------------------------------------------------------------------


async def _update_segment_images_in_firestore(
    db: firestore.AsyncClient,
    session_id: str,
    segment_id: str,
    image_urls: list[str],
) -> None:
    """Write generated image GCS URIs and mark segment as complete."""
    ref = (
        db.collection("sessions")
        .document(session_id)
        .collection("segments")
        .document(segment_id)
    )
    try:
        await ref.update(
            {
                "imageUrls": image_urls,
                "status": "complete",
            }
        )
    except Exception as exc:
        logger.warning(
            "Firestore imageUrls update failed for %s: %s", segment_id, exc
        )


async def _update_segment_video_in_firestore(
    db: firestore.AsyncClient,
    session_id: str,
    segment_id: str,
    video_url: str,
) -> None:
    """Write the Veo 2 GCS URI to the segment document."""
    ref = (
        db.collection("sessions")
        .document(session_id)
        .collection("segments")
        .document(segment_id)
    )
    try:
        await ref.update({"videoUrl": video_url})
    except Exception as exc:
        logger.warning(
            "Firestore videoUrl update failed for %s: %s", segment_id, exc
        )


# ---------------------------------------------------------------------------
# Per-segment generation runner
# ---------------------------------------------------------------------------


async def _run_segment_generation(
    client: google_genai.Client,
    semaphore: asyncio.Semaphore,
    db: firestore.AsyncClient,
    segment: dict[str, Any],
    manifest: dict[str, Any] | None,
    visual_bible: str,
    session_id: str,
    bucket_name: str,
    emitter: SSEEmitter | None,
    image_url_store: dict[str, list[str]],
) -> tuple[str, str, Any] | None:
    """Generate images for one segment, persist to Firestore, emit SSE.

    Generates all four Imagen 3 frames concurrently, then:
    - Stores GCS image URIs in ``image_url_store`` (shared mutable dict).
    - Updates the Firestore segment document with ``imageUrls``.
    - Emits ``segment_update(status="complete")`` so the frontend can begin
      loading the visual assets for this segment.
    - If the segment has a ``veo2_scene`` field, fires a Veo 2 generation
      request and returns the operation for the caller to poll.

    Args:
        client: Shared google-genai Vertex AI client.
        semaphore: Rate-limit gate shared across all concurrent scenes.
        db: Async Firestore client.
        segment: SegmentScript dict.
        manifest: VisualDetailManifest dict for this scene, or ``None``.
        visual_bible: Imagen 3 style guide string.
        session_id: Active session ID.
        bucket_name: GCS bucket for image upload.
        emitter: Optional SSE emitter.
        image_url_store: Mutable dict populated with completed image URLs.

    Returns:
        ``(segment_id, scene_id, veo2_operation)`` if Veo 2 was triggered,
        or ``None`` if this segment has no ``veo2_scene`` or Veo 2 failed
        to start.
    """
    segment_id: str = segment.get("id", "unknown")
    scene_id: str = segment.get("scene_id", "unknown")
    t_start = time.monotonic()
    used_manifest = bool(manifest and manifest.get("enriched_prompt"))

    if emitter:
        await emitter.emit(
            "agent_status",
            build_agent_status_event(
                agent_id=f"visual_director_{scene_id}",
                status="searching",  # teal pulse dot in frontend
                query=(
                    f"Generating {_FRAMES_PER_SEGMENT} frames for "
                    f"{segment.get('title', scene_id)}"
                ),
            ),
        )

    # --- Generate 4 Imagen 3 frames (concurrent) ---
    image_urls = await _generate_segment_images(
        client=client,
        semaphore=semaphore,
        segment=segment,
        manifest=manifest,
        visual_bible=visual_bible,
        session_id=session_id,
        bucket_name=bucket_name,
    )

    t_elapsed = round(time.monotonic() - t_start, 1)
    logger.info(
        "Segment %s: generated %d/%d frames in %.1fs (manifest=%s)",
        segment_id,
        len(image_urls),
        _FRAMES_PER_SEGMENT,
        t_elapsed,
        used_manifest,
    )

    # Persist image URLs to shared store (for session state)
    image_url_store[segment_id] = image_urls

    # Update Firestore with imageUrls + status="complete"
    await _update_segment_images_in_firestore(
        db, session_id, segment_id, image_urls
    )

    # Emit segment_update — frontend DocumentaryPlayer can start loading
    if emitter:
        await emitter.emit(
            "segment_update",
            build_segment_update_event(
                segment_id=segment_id,
                scene_id=scene_id,
                status="complete",
                title=segment.get("title"),
                mood=segment.get("mood"),
                image_urls=image_urls,
            ),
        )
        await emitter.emit(
            "agent_status",
            build_agent_status_event(
                agent_id=f"visual_director_{scene_id}",
                status="done",
                elapsed=t_elapsed,
                facts=[
                    f"{len(image_urls)}/{_FRAMES_PER_SEGMENT} frames generated",
                    (
                        "Used enriched Phase IV manifest prompt"
                        if used_manifest
                        else "Used script fallback prompt"
                    ),
                    (
                        f"gs://{bucket_name}/sessions/{session_id}"
                        f"/images/{segment_id}/"
                    ),
                ],
            ),
        )

    # --- Trigger Veo 2 (fire-and-forget) ---
    veo2_scene: str | None = segment.get("veo2_scene")
    if veo2_scene:
        operation = await _trigger_veo2_generation(
            client=client,
            veo2_prompt=veo2_scene,
            session_id=session_id,
            scene_id=scene_id,
            bucket_name=bucket_name,
        )
        if operation:
            return (segment_id, scene_id, operation)

    return None


# ---------------------------------------------------------------------------
# VisualDirectorOrchestrator — Phase V BaseAgent
# ---------------------------------------------------------------------------


class VisualDirectorOrchestrator(BaseAgent):
    """Phase V orchestrator: Imagen 3 image generation and Veo 2 video generation.

    Reads ``VisualDetailManifest`` objects (Phase IV) and ``SegmentScript`` dicts
    (Phase III), generates four Imagen 3 frames per segment, optionally fires Veo 2
    for segments with dramatic scene descriptions, persists all GCS URIs to Firestore,
    and emits ``segment_update(status="complete")`` SSE events.

    Progressive delivery: scene 0 is generated first (fast path) so the frontend
    ``DocumentaryPlayer`` can begin playback while the remaining scenes are rendered
    concurrently in the background.
    """

    model_config = ConfigDict(arbitrary_types_allowed=True)

    firestore_project: str = Field(
        ...,
        description="GCP project ID for Firestore writes and Vertex AI.",
    )
    gcs_bucket: str = Field(
        ...,
        description="GCS bucket name for generated image and video storage.",
    )
    emitter: Any = Field(
        default=None,
        description="Optional SSE emitter for frontend progress events.",
    )
    sub_agents: list[BaseAgent] = Field(
        default_factory=list,
        description=(
            "Declared for ADK BaseAgent compatibility. "
            "Unused — all AI calls are made directly via the google-genai client."
        ),
    )

    async def _run_async_impl(
        self,
        ctx: InvocationContext,
    ) -> AsyncGenerator[Any, None]:
        """Execute Phase V: announce → generate images → update Firestore → poll Veo 2.

        This generator yields no ADK sub-agent events (all work is done via the
        google-genai client directly). The ``yield`` below satisfies the
        ``AsyncGenerator`` protocol required by ADK's ``BaseAgent``.
        """
        session_id: str = ctx.session.id
        t_start = time.monotonic()

        # ------------------------------------------------------------------
        # Phase announcement
        # ------------------------------------------------------------------
        if self.emitter:
            await self.emitter.emit(
                "pipeline_phase",
                build_pipeline_phase_event(
                    phase=5,
                    label="GENERATION",
                    message=(
                        "Generating cinematic Imagen 3 frames and Veo 2 video clips"
                    ),
                ),
            )

        # ------------------------------------------------------------------
        # Load inputs from session state
        # ------------------------------------------------------------------
        script_raw: list[dict[str, Any]] = ctx.session.state.get("script", [])
        manifests: dict[str, dict[str, Any]] = ctx.session.state.get(
            "visual_research_manifest", {}
        )
        visual_bible: str = ctx.session.state.get("visual_bible", "")

        if not script_raw:
            logger.error(
                "Phase V: session.state['script'] is empty for session %s. "
                "Ensure Phase III (ScriptAgentOrchestrator) completed successfully.",
                session_id,
            )
            return

        logger.info(
            "Phase V: generating visuals for %d segments, %d manifests available",
            len(script_raw),
            len(manifests),
        )

        # ------------------------------------------------------------------
        # Initialise shared resources
        # ------------------------------------------------------------------
        # Vertex AI client: required for Imagen 3 and Veo 2
        client = google_genai.Client(
            vertexai=True,
            project=self.firestore_project,
            location="us-central1",
        )
        # 4 frames × N segments: cap concurrent Imagen 3 calls
        # (200 req/min limit → 8 concurrent keeps well within headroom)
        semaphore = asyncio.Semaphore(8)
        db = firestore.AsyncClient(project=self.firestore_project)

        image_url_store: dict[str, list[str]] = {}

        # ------------------------------------------------------------------
        # Announce all segments as queued so the frontend shows placeholders
        # ------------------------------------------------------------------
        for seg in script_raw:
            if self.emitter:
                await self.emitter.emit(
                    "agent_status",
                    build_agent_status_event(
                        agent_id=f"visual_director_{seg.get('scene_id', 'unknown')}",
                        status="queued",
                        query=seg.get("title", seg.get("scene_id", "unknown")),
                    ),
                )

        # ------------------------------------------------------------------
        # Per-segment generation coroutine
        # ------------------------------------------------------------------
        async def _generate(
            seg: dict[str, Any],
        ) -> tuple[str, str, Any] | None:
            scene_id = seg.get("scene_id", "unknown")
            manifest = manifests.get(scene_id)
            return await _run_segment_generation(
                client=client,
                semaphore=semaphore,
                db=db,
                segment=seg,
                manifest=manifest,
                visual_bible=visual_bible,
                session_id=session_id,
                bucket_name=self.gcs_bucket,
                emitter=self.emitter,
                image_url_store=image_url_store,
            )

        # ------------------------------------------------------------------
        # Progressive delivery: scene 0 first → remaining scenes concurrently
        # ------------------------------------------------------------------
        veo2_pending: list[tuple[str, str, Any]] = []

        # Scene 0: run ahead — its segment_update fires before any other scene
        if script_raw:
            result = await _generate(script_raw[0])
            if isinstance(result, tuple):
                veo2_pending.append(result)

        # All remaining scenes: run concurrently
        if len(script_raw) > 1:
            remaining_results: list[Any] = await asyncio.gather(
                *[_generate(seg) for seg in script_raw[1:]],
                return_exceptions=True,
            )
            for r in remaining_results:
                if isinstance(r, tuple):
                    veo2_pending.append(r)
                elif isinstance(r, Exception):
                    logger.warning(
                        "Phase V: segment generation raised exception: %s", r
                    )

        # ------------------------------------------------------------------
        # Persist image URL store to session state
        # ------------------------------------------------------------------
        ctx.session.state["image_urls"] = image_url_store

        # ------------------------------------------------------------------
        # Poll all pending Veo 2 operations concurrently
        # ------------------------------------------------------------------
        if veo2_pending:
            logger.info(
                "Phase V: polling %d Veo 2 operation(s) for session %s",
                len(veo2_pending),
                session_id,
            )

            async def _poll_and_update(
                segment_id: str,
                scene_id: str,
                operation: Any,
            ) -> None:
                """Poll one Veo 2 operation and update Firestore + SSE on completion."""
                video_uri = await _poll_veo2_operation(
                    client, operation, segment_id, scene_id
                )
                if not video_uri:
                    return

                # Store in session state
                ctx.session.state.setdefault("video_urls", {})[
                    segment_id
                ] = video_uri

                # Update Firestore
                await _update_segment_video_in_firestore(
                    db, session_id, segment_id, video_uri
                )

                # Emit SSE so frontend can attach the video to the segment
                if self.emitter:
                    await self.emitter.emit(
                        "segment_update",
                        build_segment_update_event(
                            segment_id=segment_id,
                            scene_id=scene_id,
                            status="complete",
                            video_url=video_uri,
                        ),
                    )

                logger.info(
                    "Veo 2 video attached to segment %s: %s",
                    segment_id,
                    video_uri,
                )

            await asyncio.gather(
                *[_poll_and_update(*pending) for pending in veo2_pending],
                return_exceptions=True,
            )

        # ------------------------------------------------------------------
        # Final summary
        # ------------------------------------------------------------------
        t_elapsed = round(time.monotonic() - t_start, 1)
        total_images = sum(len(v) for v in image_url_store.values())
        total_videos = len(ctx.session.state.get("video_urls", {}))

        if self.emitter:
            await self.emitter.emit(
                "stats_update",
                {
                    "type": "stats_update",
                    "imagesGenerated": total_images,
                    "videosGenerated": total_videos,
                },
            )
            await self.emitter.emit(
                "agent_status",
                build_agent_status_event(
                    agent_id="visual_director_orchestrator",
                    status="done",
                    elapsed=t_elapsed,
                    facts=[
                        f"{len(image_url_store)}/{len(script_raw)} segments with images",
                        f"{total_images} total Imagen 3 frames generated",
                        f"{total_videos} Veo 2 videos generated",
                        f"Phase V completed in {t_elapsed}s",
                    ],
                ),
            )

        logger.info(
            "Phase V complete for session %s: %d images, %d videos in %.1fs",
            session_id,
            total_images,
            total_videos,
            t_elapsed,
        )

        # Required by ADK BaseAgent — yield nothing (no sub-agent events)
        return
        yield  # noqa: unreachable — satisfies AsyncGenerator protocol


# ---------------------------------------------------------------------------
# Factory function
# ---------------------------------------------------------------------------


def build_visual_director_orchestrator(
    emitter: SSEEmitter | None = None,
) -> VisualDirectorOrchestrator:
    """Construct a ``VisualDirectorOrchestrator`` from environment variables.

    Required environment variables:
        - ``GCP_PROJECT_ID``:    Google Cloud project ID (Firestore + Vertex AI).
        - ``GCS_BUCKET_NAME``:   GCS bucket for generated images and videos.

    Args:
        emitter: Optional SSE emitter for frontend progress events.

    Returns:
        Configured ``VisualDirectorOrchestrator`` ready for pipeline integration.
    """
    return VisualDirectorOrchestrator(
        name="visual_director_orchestrator",
        description=(
            "Phase V: Generates Imagen 3 cinematic frames (4 per segment) and "
            "Veo 2 video clips for each documentary segment. Reads enriched prompts "
            "from Phase IV visual research manifests (or script fallbacks). Uploads "
            "all assets to GCS, updates Firestore segment documents with imageUrls "
            "and videoUrl, and emits segment_update SSE events so the frontend "
            "DocumentaryPlayer can begin playback."
        ),
        firestore_project=os.environ["GCP_PROJECT_ID"],
        gcs_bucket=os.environ["GCS_BUCKET_NAME"],
        emitter=emitter,
    )
