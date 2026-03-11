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

from .historical_period_profiles import (
    detect_period_key,
    get_mood_lighting,
    get_period_negative_prompt_additions,
    HISTORICAL_PERIOD_PROFILES,
)
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

# Frame indices map to subject types in frame_prompts / _FRAME_MODIFIERS:
#   0 = environment/architecture (wide, no people)
#   1 = human activity (people as primary subject)
#   2 = material detail (extreme close-up of one object)
#   3 = dramatic atmosphere (light, shadow, mood)
#
# Frame count and type are chosen per narrative role so the visual budget
# matches the scene's dramatic weight in the documentary arc.
_NARRATIVE_FRAME_PLAN: dict[str, list[int]] = {
    "opening":       [0],          # 1 frame — one wide establishing shot, no more
    "rising_action": [0, 1],       # 2 frames — place + people entering the story
    "climax":        [0, 1, 3],    # 3 frames — full visual depth for the peak moment
    "resolution":    [1, 3],       # 2 frames — human presence + reflective atmosphere
    "coda":          [3],          # 1 frame — one resonant atmospheric close
}
_DEFAULT_FRAME_PLAN: list[int] = [0, 1]  # fallback for unknown narrative roles

# Narrative-role driven visual styling: prefix/suffix applied to every frame prompt
# so that the Imagen 3 output reflects the segment's position in the documentary arc.
_NARRATIVE_ROLE_STYLES: dict[str, dict[str, str]] = {
    "opening": {
        "prefix": "Golden hour, warm Renaissance palette, hopeful atmosphere,",
        "suffix": "wide depth of field, inviting composition",
    },
    "rising_action": {
        "prefix": "Dynamic composition, directional side lighting, sense of motion,",
        "suffix": "energetic, mid-depth of field",
    },
    "climax": {
        "prefix": "High contrast chiaroscuro, dramatic tension, peak dramatic moment,",
        "suffix": "shallow depth of field on subject, intense atmosphere",
    },
    "resolution": {
        "prefix": "Soft diffused light, balanced symmetry, calm composition,",
        "suffix": "sense of conclusion, wide establishing framing",
    },
    "coda": {
        "prefix": "Long shadows, contemplative framing, historical distance,",
        "suffix": "melancholic atmosphere, empty spaces, fading light",
    },
}
_DEFAULT_STYLE: dict[str, str] = {"prefix": "Cinematic,", "suffix": "documentary style"}

_IMAGEN_MODEL: str = "imagen-3.0-fast-generate-001"
_VEO2_MODEL: str = "veo-2.0-generate-001"
_VEO2_POLL_INTERVAL_SECONDS: int = 20
_VEO2_MAX_POLLS: int = 30  # 30 × 20s = 10-minute timeout per operation

# Each frame in a segment gets a distinct composition modifier.
# Combined with the enriched_prompt base, this produces four visually coherent
# but compositionally distinct images per scene.
_FRAME_MODIFIERS: list[str] = [
    "Wide establishing shot, 24mm anamorphic lens. Full scene composition, "
    "16:9 cinematic framing, environment and spatial context dominant, "
    "foreground-to-background depth layering, rule of thirds.",
    "Medium shot, 50mm lens. Focus on central figures and primary objects. "
    "Human scale, relationships and interactions visible, rule of thirds composition.",
    "Close-up detail shot, 85mm macro lens. Emphasise textures, materials, "
    "and atmospheric elements. Shallow depth of field, f/2.8, "
    "period-specific surface details sharp against blurred background.",
    "Dramatic low-angle shot, 35mm anamorphic lens. Strong foreground-to-background "
    "layering, architectural lines converging overhead, cinematic depth of field, "
    "heroic scale perspective.",
]


def _frames_for_segment(
    segment: dict[str, Any],
    narrative_role: str,
) -> list[int]:
    """Return the Imagen 3 frame indices to generate for this segment.

    Frame selection is driven by narrative role so visual spending matches
    dramatic weight: opening and coda scenes get one frame; the climax gets
    three; rising action and resolution get two.

    Args:
        segment: SegmentScript dict (used for logging only here).
        narrative_role: The scene's position in the documentary arc
            (from the matching SceneBrief).

    Returns:
        Ordered list of frame indices (0–3) to generate.
    """
    plan = _NARRATIVE_FRAME_PLAN.get(narrative_role, _DEFAULT_FRAME_PLAN)
    logger.debug(
        "Segment %s (narrative_role=%r): generating %d frame(s) %s",
        segment.get("id", "unknown"),
        narrative_role,
        len(plan),
        plan,
    )
    return plan


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
    narrative_role: str = "",
) -> tuple[str, str]:
    """Build an Imagen 3 (prompt, negative_prompt) pair for a single frame.

    Priority rule:
      0. If ``manifest.frame_prompts`` has an entry for ``frame_idx`` → use that
         subject-differentiated prompt directly (no frame modifier appended).
      1. If ``manifest.enriched_prompt`` exists → combine enriched_prompt +
         frame-specific composition modifier.
      2. No manifest (or empty enriched_prompt) → combine the script's
         ``visual_descriptions[frame_idx]``.
      3. No visual_descriptions → generic cinematic fallback built from segment
         title and mood.

    All prompt paths are wrapped with:
      - A style anchor (first 200 chars of ``visual_bible``) as an era prefix.
      - Narrative-role prefix/suffix from ``_NARRATIVE_ROLE_STYLES``.

    Args:
        segment: SegmentScript dict from session.state["script"].
        manifest: VisualDetailManifest dict for this scene, or None.
        visual_bible: Imagen 3 style guide string from Phase I.
        frame_idx: 0–3 index selecting the frame composition modifier.
        narrative_role: Dramatic arc position (opening, rising_action, climax,
            resolution, coda). Controls visual styling prefix/suffix.

    Returns:
        Tuple of (prompt, negative_prompt).
    """
    frame_modifier = _FRAME_MODIFIERS[frame_idx % len(_FRAME_MODIFIERS)]

    # Shared: extract mood and era for lighting / negative prompt enrichment
    mood: str = segment.get("mood", "cinematic")
    lighting_directive: str = get_mood_lighting(mood)
    era: str = segment.get("era", "") or (manifest or {}).get("era", "")
    period_additions: str = get_period_negative_prompt_additions(era)

    # Build period-aware negative prompt prefix to anchor the era
    period_prefix = ""
    if era:
        period_prefix = (
            f"modern {era}, contemporary version, 21st century, tourists, "
            f"modern infrastructure, "
        )

    # --- Style anchor: first 200 chars of visual_bible as era consistency prefix ---
    style_anchor = (visual_bible[:200].strip() + "," if visual_bible else "")

    # --- Narrative-role styling (same for all frames in the segment) ---
    role_style = _NARRATIVE_ROLE_STYLES.get(narrative_role, _DEFAULT_STYLE)
    narrative_prefix: str = role_style["prefix"]
    narrative_suffix: str = role_style["suffix"]

    def _assemble_prompt(core_prompt: str) -> str:
        """Wrap a core prompt with style_anchor, narrative prefix/suffix, and lighting."""
        return (
            f"{style_anchor} {narrative_prefix} {core_prompt} "
            f"{narrative_suffix}\n\n"
            f"Lighting: {lighting_directive}"
        )

    # --- Priority 0: Use per-frame subject-differentiated prompts from Phase IV ---
    if manifest and manifest.get("frame_prompts"):
        frame_prompts: list[str] = manifest["frame_prompts"]
        if frame_idx < len(frame_prompts) and frame_prompts[frame_idx]:
            frame_prompt = frame_prompts[frame_idx]
            # Ensure the era is explicit in the first 50 chars of the prompt
            if era and era.lower() not in frame_prompt[:50].lower():
                frame_prompt = f"[{era}] {frame_prompt}"
            prompt = _assemble_prompt(frame_prompt)
            negative = f"{period_prefix}{_BASE_NEGATIVE_PROMPT}"
            if period_additions:
                negative = f"{negative}, {period_additions}"
            return prompt, negative

    # --- Priority 1: Use shared enriched research prompt from Phase IV ---
    if manifest and manifest.get("enriched_prompt"):
        enriched: str = manifest["enriched_prompt"]
        detail_fields: dict[str, Any] = manifest.get("detail_fields", {})
        era_markers: list[str] = detail_fields.get("era_markers", [])

        # Ensure the era is explicit in the first 50 chars of the prompt
        if era and era.lower() not in enriched[:50].lower():
            enriched = f"[{era}] {enriched}"

        core = f"{enriched}\n\nFrame composition: {frame_modifier}"
        prompt = _assemble_prompt(core)

        negative = f"{period_prefix}{_BASE_NEGATIVE_PROMPT}"
        if era_markers:
            # Era markers describe elements that should NOT appear
            # (e.g. "no mechanical clocks visible", "oil lanterns only").
            # Appending them strengthens anachronism prevention.
            negative = f"{negative}, {', '.join(era_markers)}"
        if period_additions:
            negative = f"{negative}, {period_additions}"

        return prompt, negative

    # --- Priority 2: Fall back to script's per-frame visual_descriptions ---
    visual_descriptions: list[str] = segment.get("visual_descriptions", [])
    if visual_descriptions:
        desc = visual_descriptions[frame_idx % len(visual_descriptions)]
        core = f"{desc}\n\nFrame composition: {frame_modifier}"
        prompt = _assemble_prompt(core)
        negative = f"{period_prefix}{_BASE_NEGATIVE_PROMPT}"
        if period_additions:
            negative = f"{negative}, {period_additions}"
        return prompt, negative

    # --- Priority 3: Generic fallback ---
    title: str = segment.get("title", "historical documentary scene")
    era_qualifier = f", {era}" if era else ""
    core = (
        f"A {mood} historical documentary scene: {title}{era_qualifier}. "
        f"Period-accurate, no anachronisms. "
        f"Frame composition: {frame_modifier}"
    )
    prompt = _assemble_prompt(core)
    negative = f"{period_prefix}{_BASE_NEGATIVE_PROMPT}"
    if period_additions:
        negative = f"{negative}, {period_additions}"
    return prompt, negative


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
    enhance_prompt: bool = True,
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
        enhance_prompt: Whether Imagen 3 should auto-enhance the prompt.
            Disabled for long enriched prompts that are already detailed.

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
                    enhance_prompt=enhance_prompt,
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
    narrative_role: str = "",
) -> list[str]:
    """Generate Imagen 3 frames for one segment, selecting which frames based on narrative role.

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

    for frame_idx in _frames_for_segment(segment, narrative_role):
        prompt, negative = _build_imagen_prompt(
            segment, manifest, visual_bible, frame_idx,
            narrative_role=narrative_role,
        )
        # Never let Imagen 3 enhance historical prompts — it modernizes them
        use_enhance = False
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
                enhance_prompt=use_enhance,
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
    narrative_role: str = "",
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
                    f"Generating {len(_frames_for_segment(segment, narrative_role))} frame(s) for "
                    f"{segment.get('title', scene_id)}"
                ),
            ),
        )

    # --- Generate Imagen 3 frames (concurrent) ---
    image_urls = await _generate_segment_images(
        client=client,
        semaphore=semaphore,
        segment=segment,
        manifest=manifest,
        visual_bible=visual_bible,
        session_id=session_id,
        bucket_name=bucket_name,
        narrative_role=narrative_role,
    )

    t_elapsed = round(time.monotonic() - t_start, 1)
    logger.info(
        "Segment %s: generated %d/%d frames in %.1fs (manifest=%s)",
        segment_id,
        len(image_urls),
        len(_frames_for_segment(segment, narrative_role)),
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
                    f"{len(image_urls)}/{len(_frames_for_segment(segment, narrative_role))} frames generated",
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

    # --- Trigger Veo 2 (climax scenes only) ---
    veo2_scene: str | None = segment.get("veo2_scene")
    should_generate_video = (
        narrative_role == "climax"
        and bool(veo2_scene)
    )
    if veo2_scene and not should_generate_video:
        logger.info(
            "Skipping Veo 2 for segment %s (narrative_role=%s, climax only)",
            segment_id,
            narrative_role,
        )
    if should_generate_video:
        assert veo2_scene is not None  # narrowing for type checker
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

        # Build scene_id → narrative_role lookup from Phase I scene briefs
        # (narrative_role is on SceneBrief, not on SegmentScript)
        scene_briefs_raw: list[dict[str, Any]] = ctx.session.state.get("scene_briefs", [])
        narrative_role_map: dict[str, str] = {
            b.get("scene_id", ""): b.get("narrative_role", "")
            for b in scene_briefs_raw
        }

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
            role = narrative_role_map.get(scene_id, "")
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
                narrative_role=role,
            )

        # ------------------------------------------------------------------
        # Progressive delivery: scene 0 first → remaining scenes concurrently
        # Phase IV may have already generated images inline for some segments.
        # Check session.state["image_urls"] and skip those — only generate
        # images for segments that Phase IV did not process inline.
        # ------------------------------------------------------------------
        already_generated: dict[str, list[str]] = ctx.session.state.get(
            "image_urls", {}
        )
        veo2_pending: list[tuple[str, str, Any]] = []

        # Trigger Veo 2 for segments that Phase IV already processed inline
        # (images done but veo2_scene wasn't available then — script is now)
        for seg in script_raw:
            seg_id = seg.get("id", "")
            scene_id_v = seg.get("scene_id", "")
            role_v = narrative_role_map.get(scene_id_v, "")
            # Only trigger Veo 2 for climax moments with a veo2_scene description
            veo2_worthy = role_v == "climax" and bool(seg.get("veo2_scene"))
            if seg_id in already_generated and seg.get("veo2_scene") and not veo2_worthy:
                logger.info(
                    "Skipping Veo 2 for segment %s (narrative_role=%s, climax only)",
                    seg_id,
                    role_v,
                )
            if seg_id in already_generated and veo2_worthy:
                scene_id = seg.get("scene_id", "unknown")
                operation = await _trigger_veo2_generation(
                    client=client,
                    veo2_prompt=seg["veo2_scene"],
                    session_id=session_id,
                    scene_id=scene_id,
                    bucket_name=self.gcs_bucket,
                )
                if operation:
                    veo2_pending.append((seg_id, scene_id, operation))

        # Collect segments that still need Imagen 3 (Phase IV didn't process inline)
        pending_image_segs = [s for s in script_raw if s.get("id", "") not in already_generated]

        if pending_image_segs:
            logger.info(
                "Phase V: %d segment(s) need image generation (not processed inline by Phase IV)",
                len(pending_image_segs),
            )
            # Scene 0 (if still pending) runs ahead
            first_pending = pending_image_segs[0]
            result = await _generate(first_pending)
            if isinstance(result, tuple):
                veo2_pending.append(result)

            # Remaining pending scenes run concurrently
            if len(pending_image_segs) > 1:
                remaining_results: list[Any] = await asyncio.gather(
                    *[_generate(seg) for seg in pending_image_segs[1:]],
                    return_exceptions=True,
                )
                for r in remaining_results:
                    if isinstance(r, tuple):
                        veo2_pending.append(r)
                    elif isinstance(r, Exception):
                        logger.warning(
                            "Phase V: segment generation raised exception: %s", r
                        )
        else:
            logger.info(
                "Phase V: all %d segments already have images from Phase IV inline generation — skipping Imagen 3",
                len(script_raw),
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
            "Phase V complete for session %s: %d images across %d segments, %d videos in %.1fs",
            session_id,
            total_images,
            len(image_url_store),
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
