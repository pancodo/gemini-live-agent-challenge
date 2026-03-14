"""Phase V of the AI Historian documentary pipeline: Visual Generation.

Implements the ``VisualDirectorOrchestrator`` — a custom ``BaseAgent`` that reads
``VisualDetailManifest`` objects (from Phase IV) and produces Imagen 3 images and
Veo 2 videos for each documentary segment.

Architecture
------------
For each segment the orchestrator:

1. Builds an Imagen 3 prompt from the enriched_prompt in the visual manifest,
   or falls back to the script's ``visual_descriptions`` if no manifest exists.
2. Calls Imagen 3 (``imagen-3.0-fast-generate-001``) concurrently — one image
   per visual frame — with frame-specific composition modifiers, lens specs,
   film stock references, temporal accuracy prefixes, and era art style anchors.
3. Uploads generated JPEG bytes to GCS at a predictable path structure and
   persists the GCS URIs to the Firestore segment document.
4. Triggers a Veo 2 (``veo-2.0-generate-001``) generation if the segment has a
   ``veo2_scene`` description. Veo 2 operations are long-running (~1-2 min) and
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
Each segment's Veo 2 operation is polled in a fire-and-forget background task
(``asyncio.create_task``) immediately after that segment's Imagen 3 frames
complete. Background tasks run independently and never block the pipeline.
When each finishes, Firestore is updated with the video GCS URI and a
``segment_update`` SSE event is emitted. The public ``generate_video_background``
method can also be called externally (e.g. from pipeline.py) to trigger Veo 2
for a specific segment without blocking.

Session state contract
----------------------
**Inputs** (must be set before Phase V runs):
    - ``session.state["script"]``                   -- list[dict] of SegmentScript dicts (Phase III)
    - ``session.state["visual_research_manifest"]`` -- dict[scene_id, dict] (Phase IV)
    - ``session.state["visual_bible"]``             -- Imagen 3 style guide string (Phase I)

**Outputs** (written by this agent):
    - ``session.state["image_urls"]``  -- dict[segment_id, list[str]] of GCS image URIs
    - ``session.state["video_urls"]``  -- dict[segment_id, str] of GCS video URIs
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
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

from .rate_limiter import GlobalRateLimiter
from .historical_period_profiles import (
    detect_period,
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
    build_stats_update_event,
)

logger = logging.getLogger(__name__)

# Fallback rate limiters used when no limiter is injected via the factory.
_fallback_gemini_limiter = GlobalRateLimiter(12, "gemini")
_fallback_imagen_limiter = GlobalRateLimiter(8, "imagen")


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
    "opening":       [0],          # 1 frame -- one wide establishing shot, no more
    "rising_action": [0, 1],       # 2 frames -- place + people entering the story
    "climax":        [0, 1, 3],    # 3 frames -- full visual depth for the peak moment
    "resolution":    [1, 3],       # 2 frames -- human presence + reflective atmosphere
    "coda":          [3],          # 1 frame -- one resonant atmospheric close
}
_DEFAULT_FRAME_PLAN: list[int] = [0, 1]  # fallback for unknown narrative roles

# ---------------------------------------------------------------------------
# Lens specifications per frame type (Change 1)
# ---------------------------------------------------------------------------
# Each frame type gets a physically specific lens + aperture + depth-of-field
# description. This dramatically improves Imagen 3's photographic authenticity.
_FRAME_LENS_SPECS: list[str] = [
    "24mm anamorphic lens, deep focus f/8, full depth of field",       # frame 0: wide establishing
    "50mm lens at f/4, mid-range focus, natural perspective",           # frame 1: human activity
    "100mm macro lens at f/4, shallow depth of field, fine detail",     # frame 2: close-up material
    "35mm anamorphic lens at f/2.8, shallow depth of field, atmospheric bokeh",  # frame 3: dramatic
]

# ---------------------------------------------------------------------------
# Film stock references (Change 1)
# ---------------------------------------------------------------------------
# Film stock is the single strongest cinematic quality signal for Imagen 3.
_DAYLIGHT_FILM: str = "shot on Kodak Vision3 250D film stock"
_TUNGSTEN_FILM: str = "shot on Kodak Vision3 500T film stock"

# Keywords in mood/era/title that signal interior or nighttime lighting,
# triggering the tungsten film stock instead of daylight.
_TUNGSTEN_KEYWORDS: frozenset[str] = frozenset({
    "night", "interior", "candlelight", "torch", "lamp", "firelight",
    "indoor", "temple interior", "palace interior", "chamber", "cellar",
    "dungeon", "crypt", "hearth", "banquet hall", "tavern", "hammam",
    "bathhouse", "underground", "cave", "mine", "lantern",
})

# ---------------------------------------------------------------------------
# Atmospheric depth suffix (Change 1)
# ---------------------------------------------------------------------------
# Applied to EVERY frame to prevent the flat digital look.
_ATMOSPHERE_SUFFIX: str = (
    "dust motes drifting in light beams, atmospheric depth, "
    "slight haze between foreground and background"
)

# Narrative-role driven visual styling: prefix/suffix applied to every frame prompt
# so that the Imagen 3 output reflects the segment's position in the documentary arc.
_NARRATIVE_ROLE_STYLES: dict[str, dict[str, str]] = {
    "opening": {
        "prefix": "Golden hour, warm Renaissance palette, hopeful atmosphere,",
        "suffix": f"wide depth of field, inviting composition, {_ATMOSPHERE_SUFFIX}",
    },
    "rising_action": {
        "prefix": "Dynamic composition, directional side lighting, sense of motion,",
        "suffix": f"energetic, mid-depth of field, {_ATMOSPHERE_SUFFIX}",
    },
    "climax": {
        "prefix": "High contrast chiaroscuro, dramatic tension, peak dramatic moment,",
        "suffix": f"shallow depth of field on subject, intense atmosphere, {_ATMOSPHERE_SUFFIX}",
    },
    "resolution": {
        "prefix": "Soft diffused light, balanced symmetry, calm composition,",
        "suffix": f"sense of conclusion, wide establishing framing, {_ATMOSPHERE_SUFFIX}",
    },
    "coda": {
        "prefix": "Long shadows, contemplative framing, historical distance,",
        "suffix": f"melancholic atmosphere, empty spaces, fading light, {_ATMOSPHERE_SUFFIX}",
    },
}
_DEFAULT_STYLE: dict[str, str] = {
    "prefix": "Cinematic,",
    "suffix": f"documentary style, {_ATMOSPHERE_SUFFIX}",
}

_IMAGEN_MODEL: str = "imagen-3.0-fast-generate-001"
_VEO2_MODEL: str = "veo-2.0-generate-001"
_VEO2_POLL_INTERVAL_SECONDS: int = 20
_VEO2_MAX_POLLS: int = 30  # 30 x 20s = 10-minute timeout per operation

# Hard timeout for Veo 2 operations: if polling exceeds this, the video is
# gracefully skipped and the segment proceeds with images only.
_VEO2_HARD_TIMEOUT_SECONDS: float = 180.0

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

# ---------------------------------------------------------------------------
# Era art style references (Change 3)
# ---------------------------------------------------------------------------
# Historical painter references carry entire visual vocabularies of period accuracy.
# Matched via detect_period_key() so they only apply when a known era is detected.
_ERA_ART_STYLE_REFERENCES: dict[str, str] = {
    "ancient_rome_greece": (
        "Lawrence Alma-Tadema's meticulous marble textures and Mediterranean light"
    ),
    "ottoman_empire": (
        "Jean-Leon Gerome's photorealistic Orientalist warm palette"
    ),
    "medieval_europe": (
        "Flemish Masters oil painting technique, Van Eyck luminous detail"
    ),
    "victorian_england": (
        "John Atkinson Grimshaw nocturne, amber gaslight on wet surfaces"
    ),
    "ancient_egypt": (
        "David Roberts lithograph, warm golden sandstone, monumental scale"
    ),
    "colonial_americas": (
        "Dutch Golden Age painting precision, Vermeer-like light quality"
    ),
    "islamic_golden_age": (
        "Persian miniature painting, jewel-toned pigments, geometric precision"
    ),
    "east_asian_imperial": (
        "Song dynasty ink-wash landscape painting, atmospheric perspective"
    ),
    "indian_subcontinent": (
        "Mughal miniature painting, precise naturalistic detail, jewel tones"
    ),
    "mesoamerican": (
        "Maya polychrome ceramic painting, bold outlines, vivid mineral pigments"
    ),
    "sub_saharan_african": (
        "Benin bronze relief aesthetic, formal composition, warm earth tones"
    ),
    "byzantine": (
        "Byzantine mosaic style, gold ground, jeweled colors, frontal figures"
    ),
    "viking_norse": (
        "Bayeux Tapestry narrative style, bold outlines, Northern light"
    ),
    "renaissance_europe": (
        "Italian Renaissance painting, linear perspective, sfumato technique"
    ),
}

# ---------------------------------------------------------------------------
# Temporal accuracy injection (Change 2)
# ---------------------------------------------------------------------------
# Keywords that signal different temporal states of buildings/sites.
_CONSTRUCTION_KEYWORDS: frozenset[str] = frozenset({
    "built", "constructed", "inaugurated", "founded", "erected", "completed",
    "new", "first", "opening", "dedication", "consecrated", "commissioned",
    "freshly", "newly", "just finished",
})

_RUIN_KEYWORDS: frozenset[str] = frozenset({
    "ruin", "fall", "collapse", "abandon", "decay", "destruction",
    "sack", "siege", "earthquake", "fire destroyed", "crumbl",
    "desolat", "neglect", "dilapidated",
})

# Famous site anti-defaults: force the historically accurate version,
# not the modern ruins tourists photograph.
_SITE_OVERRIDES: dict[str, str] = {
    "colosseum": (
        "all four exterior stories complete, travertine marble facade intact, "
        "no missing walls, no exposed brick core, velarium awning mast sockets visible"
    ),
    "flavian amphitheatre": (
        "all four exterior stories complete, travertine marble facade intact, "
        "no missing walls, no exposed brick core, velarium awning mast sockets visible"
    ),
    "parthenon": (
        "complete marble roof intact, full pediment sculptures in place, "
        "polychrome paint visible on metopes and triglyphs"
    ),
    "acropolis": (
        "complete marble roof intact, full pediment sculptures in place, "
        "polychrome paint visible on metopes and triglyphs"
    ),
    "hagia sophia": (
        "white marble exterior cladding, no minarets, "
        "golden mosaic tesserae covering interior dome and walls"
    ),
    "angkor wat": (
        "fresh sandstone surfaces, no moss or lichen, no tree roots, "
        "sharp-edged bas-reliefs with traces of original lacquer and gold leaf"
    ),
}

# Negative prompt additions for famous sites (Change 5)
_SITE_NEGATIVE_OVERRIDES: dict[str, str] = {
    "colosseum": (
        "missing exterior walls, exposed brick core, collapsed sections, "
        "modern restoration patches, tourists, scaffolding"
    ),
    "flavian amphitheatre": (
        "missing exterior walls, exposed brick core, collapsed sections, "
        "modern restoration patches, tourists, scaffolding"
    ),
    "parthenon": (
        "roofless colonnade, bare columns without entablature, "
        "concrete repairs, metal reinforcement bars"
    ),
    "acropolis": (
        "roofless colonnade, bare columns without entablature, "
        "concrete repairs, metal reinforcement bars"
    ),
    "hagia sophia": (
        "minarets, reddish-brown stucco exterior, Islamic medallions, "
        "modern museum signage"
    ),
    "angkor wat": (
        "moss-covered stones, tree roots growing over walls, "
        "jungle overgrowth, crumbling sandstone"
    ),
}

# ---------------------------------------------------------------------------
# Veo 2 atmospheric motion per narrative role (Change 4)
# ---------------------------------------------------------------------------
_VEO2_ATMOSPHERIC_MOTION: dict[str, str] = {
    "opening": "gentle morning mist drifting across the scene",
    "rising_action": "dust swirling in shafts of light",
    "climax": "fire and smoke curling upward through shafts of light",
    "resolution": "late afternoon shadows lengthening across stone surfaces",
    "coda": "long shadows, fading amber light, dust settling",
}
_VEO2_DEFAULT_ATMOSPHERE: str = "atmospheric particles drifting through light beams"


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
        Ordered list of frame indices (0-3) to generate.
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
# Temporal accuracy prefix builder (Change 2)
# ---------------------------------------------------------------------------


def _build_temporal_accuracy_prefix(
    scene_brief: dict[str, Any],
    era: str,
) -> str:
    """Build a temporal state prefix that forces Imagen 3 to depict the correct
    historical moment rather than defaulting to the modern state of a site.

    Detects whether the scene depicts a newly built structure, an active
    civilization at its height, or a period of decline, and returns a prefix
    that anchors the prompt to the correct temporal state.

    Args:
        scene_brief: SceneBrief dict with fields like title, document_excerpt,
            location, era, narrative_role.
        era: Free-form era string (e.g. "80 AD Roman Empire").

    Returns:
        A temporal accuracy prefix string. May be empty if no meaningful
        temporal signal is detected.
    """
    if not era:
        return ""

    # Combine searchable text fields
    title = scene_brief.get("title", "")
    excerpt = scene_brief.get("document_excerpt", "")
    location = scene_brief.get("location", "")
    searchable = f"{era} {title} {excerpt} {location}".lower()

    # Detect temporal context from keywords
    is_construction = any(kw in searchable for kw in _CONSTRUCTION_KEYWORDS)
    is_ruin = any(kw in searchable for kw in _RUIN_KEYWORDS)

    # Build the base temporal prefix
    parts: list[str] = []

    if is_construction:
        parts.append(
            f"Historical reconstruction showing {era}: freshly constructed, "
            f"pristine condition, newly quarried stone with sharp edges, "
            f"NO weathering or damage, NO ruins."
        )
    elif is_ruin:
        parts.append(
            f"Historical reconstruction showing {era} decline: "
            f"structural damage beginning, signs of neglect, weathering visible."
        )
    else:
        # Default: active prime -- the most common case for documentary scenes
        parts.append(
            f"Historical reconstruction showing {era} at its height: "
            f"fully intact, well-maintained, in active use, "
            f"period-accurate materials and decoration."
        )

    # Classical antiquity polychrome correction
    era_lower = era.lower()
    classical_signals = (
        "roman", "greek", "classical", "ancient rome", "ancient greece",
        "athens", "pompeii", "sparta", "corinth",
    )
    if any(signal in searchable for signal in classical_signals):
        parts.append(
            "Painted in vivid polychrome -- cinnabar red, Egyptian blue, "
            "gold leaf accents -- NOT plain white marble."
        )

    # Famous site anti-defaults
    for site_key, site_override in _SITE_OVERRIDES.items():
        if site_key in searchable:
            parts.append(site_override)
            break  # Only one site match per scene

    return " ".join(parts)


def _detect_film_stock(
    mood: str,
    era: str,
    title: str,
) -> str:
    """Select the appropriate film stock reference based on scene context.

    Uses tungsten film (500T) for interior/night scenes and daylight film
    (250D) for exterior/day scenes.

    Args:
        mood: Mood string from the segment.
        era: Era string from the scene brief.
        title: Title of the segment.

    Returns:
        Film stock reference string.
    """
    combined = f"{mood} {era} {title}".lower()
    if any(kw in combined for kw in _TUNGSTEN_KEYWORDS):
        return _TUNGSTEN_FILM
    return _DAYLIGHT_FILM


def _detect_era_art_style(era: str) -> str:
    """Return a historical painter art style reference for the detected era.

    Args:
        era: Free-form era string.

    Returns:
        Art style reference string, or empty string if no match.
    """
    period_key = detect_period_key(era)
    if period_key and period_key in _ERA_ART_STYLE_REFERENCES:
        return f"in the aesthetic tradition of {_ERA_ART_STYLE_REFERENCES[period_key]}"
    return ""


def _build_site_negative_additions(
    era: str,
    title: str,
    excerpt: str,
) -> str:
    """Return site-specific negative prompt additions for famous landmarks.

    Args:
        era: Free-form era string.
        title: Segment title.
        excerpt: Document excerpt text.

    Returns:
        Comma-separated negative prompt additions, or empty string.
    """
    searchable = f"{era} {title} {excerpt}".lower()
    for site_key, site_negative in _SITE_NEGATIVE_OVERRIDES.items():
        if site_key in searchable:
            return site_negative
    return ""


# ---------------------------------------------------------------------------
# GCS helpers (sync operations run via executor from async context)
# ---------------------------------------------------------------------------


def _upload_image_bytes_sync(
    image_bytes: bytes,
    bucket_name: str,
    blob_name: str,
) -> str:
    """Upload raw JPEG bytes to GCS and return the gs:// URI.

    Reuses the module-level ``_get_storage_client()`` singleton so that all
    uploads share a single HTTP connection pool instead of creating a new
    ``storage.Client`` (and its underlying ``requests.Session``) per call.
    """
    client = _get_storage_client()
    blob = _get_bucket(client, bucket_name).blob(blob_name)
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
# GCS cache: module-level storage client + batch existence checks (Task #16)
# ---------------------------------------------------------------------------

_storage_client: storage.Client | None = None


def _get_storage_client() -> storage.Client:
    """Return a lazily initialised module-level GCS storage client."""
    global _storage_client
    if _storage_client is None:
        _storage_client = storage.Client()
    return _storage_client


# Cache bucket references so ``client.bucket()`` is called at most once per
# bucket name across the entire process lifetime.
_bucket_cache: dict[str, storage.Bucket] = {}


def _get_bucket(
    client: storage.Client,
    bucket_name: str,
) -> storage.Bucket:
    """Return a cached ``Bucket`` reference for *bucket_name*.

    ``client.bucket()`` is cheap (no RPC), but caching avoids redundant object
    allocation when thousands of uploads target the same bucket.
    """
    bucket = _bucket_cache.get(bucket_name)
    if bucket is None:
        bucket = client.bucket(bucket_name)
        _bucket_cache[bucket_name] = bucket
    return bucket


def _check_blob_exists_sync(bucket_name: str, blob_name: str) -> bool:
    """Check if a GCS blob exists (synchronous, runs in executor)."""
    client = _get_storage_client()
    return _get_bucket(client, bucket_name).blob(blob_name).exists()


async def _check_blob_exists_async(
    bucket_name: str,
    blob_name: str,
) -> tuple[str, bool]:
    """Async wrapper: check GCS blob existence via thread executor.

    Returns:
        Tuple of ``(blob_name, exists)`` so the caller can build a dict.
    """
    loop = asyncio.get_running_loop()
    exists = await loop.run_in_executor(
        None,
        _check_blob_exists_sync,
        bucket_name,
        blob_name,
    )
    return blob_name, exists


async def _batch_check_existing_frames(
    bucket_name: str,
    session_id: str,
    segments: list[dict[str, Any]],
    narrative_role_map: dict[str, str],
) -> dict[str, str]:
    """Check GCS for existing Imagen 3 frames across all segments.

    Runs all existence checks concurrently. Returns a mapping from blob names
    that already exist to their ``gs://`` URIs. The caller uses this to skip
    regeneration of frames that are already in GCS (idempotent re-runs).

    Args:
        bucket_name: GCS bucket for generated images.
        session_id: Active session ID.
        segments: List of SegmentScript dicts.
        narrative_role_map: Maps scene_id -> narrative_role for frame planning.

    Returns:
        Dict mapping blob_name to ``gs://{bucket_name}/{blob_name}`` for hits.
    """
    tasks: list[Any] = []
    for seg in segments:
        segment_id = seg.get("id", "unknown")
        scene_id = seg.get("scene_id", "unknown")
        narrative_role = narrative_role_map.get(scene_id, "")
        frame_indices = _frames_for_segment(seg, narrative_role)
        for frame_idx in frame_indices:
            blob_name = (
                f"sessions/{session_id}/images/{segment_id}/frame_{frame_idx}.jpg"
            )
            tasks.append(_check_blob_exists_async(bucket_name, blob_name))

    if not tasks:
        return {}

    results: list[tuple[str, bool]] = await asyncio.gather(*tasks)
    total_checked = len(results)
    hits: dict[str, str] = {}
    for blob_name, exists in results:
        if exists:
            hits[blob_name] = f"gs://{bucket_name}/{blob_name}"

    logger.info(
        "GCS cache check: %d/%d frames exist, %d to generate",
        len(hits),
        total_checked,
        total_checked - len(hits),
    )
    return hits


# ---------------------------------------------------------------------------
# Prompt construction
# ---------------------------------------------------------------------------


def _build_imagen_prompt(
    segment: dict[str, Any],
    manifest: dict[str, Any] | None,
    visual_bible: str,
    frame_idx: int,
    narrative_role: str = "",
    scene_brief: dict[str, Any] | None = None,
) -> tuple[str, str]:
    """Build an Imagen 3 (prompt, negative_prompt) pair for a single frame.

    Priority rule:
      0. If ``manifest.frame_prompts`` has an entry for ``frame_idx`` -> use that
         subject-differentiated prompt directly (no frame modifier appended).
      1. If ``manifest.enriched_prompt`` exists -> combine enriched_prompt +
         frame-specific composition modifier.
      2. No manifest (or empty enriched_prompt) -> combine the script's
         ``visual_descriptions[frame_idx]``.
      3. No visual_descriptions -> generic cinematic fallback built from segment
         title and mood.

    All prompt paths are wrapped with:
      - A temporal accuracy prefix (forces correct historical state).
      - A style anchor (first 200 chars of ``visual_bible``) as an era prefix.
      - Narrative-role prefix/suffix from ``_NARRATIVE_ROLE_STYLES``.
      - Era art style reference (historical painter vocabulary).
      - Frame-specific lens specification.
      - Film stock reference (daylight or tungsten).
      - Atmospheric depth suffix.

    Args:
        segment: SegmentScript dict from session.state["script"].
        manifest: VisualDetailManifest dict for this scene, or None.
        visual_bible: Imagen 3 style guide string from Phase I.
        frame_idx: 0-3 index selecting the frame composition modifier.
        narrative_role: Dramatic arc position (opening, rising_action, climax,
            resolution, coda). Controls visual styling prefix/suffix.
        scene_brief: Optional SceneBrief dict for temporal accuracy injection.

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

    # --- Temporal accuracy prefix (Change 2) ---
    temporal_prefix = ""
    if scene_brief:
        temporal_prefix = _build_temporal_accuracy_prefix(scene_brief, era)

    # --- Style anchor: first 200 chars of visual_bible as era consistency prefix ---
    style_anchor = (visual_bible[:200].strip() + "," if visual_bible else "")

    # --- Era art style reference (Change 3) ---
    art_style_ref = _detect_era_art_style(era) if era else ""

    # --- Lens spec for this frame type (Change 1) ---
    lens_spec = _FRAME_LENS_SPECS[frame_idx % len(_FRAME_LENS_SPECS)]

    # --- Film stock (Change 1) ---
    title_str: str = segment.get("title", "")
    film_stock = _detect_film_stock(mood, era, title_str)

    # --- Narrative-role styling (same for all frames in the segment) ---
    role_style = _NARRATIVE_ROLE_STYLES.get(narrative_role, _DEFAULT_STYLE)
    narrative_prefix: str = role_style["prefix"]
    narrative_suffix: str = role_style["suffix"]

    # --- Site-specific negative prompt additions (Change 5) ---
    excerpt_str: str = ""
    if scene_brief:
        excerpt_str = scene_brief.get("document_excerpt", "")
    site_negatives = _build_site_negative_additions(era, title_str, excerpt_str)

    # --- Period profile enrichment (Task #7) ---
    # Detect historical period from visual_bible + scene text and inject
    # period-specific visual elements, colors, and negatives into the prompt.
    scene_text = f"{era} {title_str} {excerpt_str}"
    period_key = detect_period(f"{visual_bible} {scene_text}")
    period_visual_elements: str = ""
    period_colors: str = ""
    period_profile_negatives: str = ""
    if period_key and period_key in HISTORICAL_PERIOD_PROFILES:
        profile = HISTORICAL_PERIOD_PROFILES[period_key]
        # Visual elements: architecture, materials, crowd details
        arch = profile.get("architecture", [])
        mats = profile.get("materials_textures", [])
        elements = arch[:3] + mats[:2]  # 5 most salient elements
        if elements:
            period_visual_elements = (
                f"Period-accurate details: {', '.join(elements)}."
            )
        # Color palette
        colors = profile.get("color_palette", [])
        if colors:
            period_colors = f"Color palette: {', '.join(colors[:5])}."
        # Negative prompt from profile
        era_neg = profile.get("era_markers_negative", [])
        if era_neg:
            period_profile_negatives = ", ".join(era_neg)

    def _assemble_prompt(core_prompt: str) -> str:
        """Wrap a core prompt with temporal prefix, style_anchor, narrative
        prefix/suffix, lens spec, film stock, art style, period profile
        enrichment, and lighting."""
        parts: list[str] = []
        if temporal_prefix:
            parts.append(temporal_prefix)
        parts.append(style_anchor)
        if art_style_ref:
            parts.append(art_style_ref + ",")
        parts.append(narrative_prefix)
        parts.append(core_prompt)
        if period_visual_elements:
            parts.append(period_visual_elements)
        if period_colors:
            parts.append(period_colors)
        parts.append(f"{narrative_suffix}, {lens_spec}.")
        parts.append(f"\n\nLighting: {lighting_directive}")
        parts.append(f"\n\n{film_stock}.")
        return " ".join(parts)

    def _assemble_negative() -> str:
        """Build the full negative prompt from all layers."""
        negative = f"{period_prefix}{_BASE_NEGATIVE_PROMPT}"
        if period_additions:
            negative = f"{negative}, {period_additions}"
        if period_profile_negatives:
            negative = f"{negative}, {period_profile_negatives}"
        if site_negatives:
            negative = f"{negative}, {site_negatives}"
        return negative

    # --- Priority 0: Use per-frame subject-differentiated prompts from Phase IV ---
    if manifest and manifest.get("frame_prompts"):
        frame_prompts: list[str] = manifest["frame_prompts"]
        if frame_idx < len(frame_prompts) and frame_prompts[frame_idx]:
            frame_prompt = frame_prompts[frame_idx]
            # Ensure the era is explicit in the first 50 chars of the prompt
            if era and era.lower() not in frame_prompt[:50].lower():
                frame_prompt = f"[{era}] {frame_prompt}"
            prompt = _assemble_prompt(frame_prompt)
            return prompt, _assemble_negative()

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
        if site_negatives:
            negative = f"{negative}, {site_negatives}"

        return prompt, negative

    # --- Priority 2: Fall back to script's per-frame visual_descriptions ---
    visual_descriptions: list[str] = segment.get("visual_descriptions", [])
    if visual_descriptions:
        desc = visual_descriptions[frame_idx % len(visual_descriptions)]
        core = f"{desc}\n\nFrame composition: {frame_modifier}"
        prompt = _assemble_prompt(core)
        return prompt, _assemble_negative()

    # --- Priority 3: Generic fallback ---
    title: str = segment.get("title", "historical documentary scene")
    era_qualifier = f", {era}" if era else ""
    core = (
        f"A {mood} historical documentary scene: {title}{era_qualifier}. "
        f"Period-accurate, no anachronisms. "
        f"Frame composition: {frame_modifier}"
    )
    prompt = _assemble_prompt(core)
    return prompt, _assemble_negative()


# ---------------------------------------------------------------------------
# Veo 2 prompt enrichment (Change 4)
# ---------------------------------------------------------------------------


def _build_enriched_veo2_prompt(
    veo2_scene: str,
    narrative_role: str,
    manifest: dict[str, Any] | None = None,
) -> str:
    """Enrich a raw Veo 2 scene description with period lighting, atmospheric
    motion, and a film stock anchor. Caps the result at 50 words.

    Veo 2 performs best with 30-50 word prompts containing a single camera
    movement, atmospheric motion, and a film stock reference.

    Args:
        veo2_scene: Raw veo2_scene string from the SegmentScript.
        narrative_role: Dramatic arc position for atmospheric motion selection.
        manifest: Optional VisualDetailManifest for period lighting extraction.

    Returns:
        Enriched and word-count-capped Veo 2 prompt string.
    """
    parts: list[str] = [veo2_scene.rstrip(". ")]

    # Period lighting from manifest detail_fields (first 2 items)
    if manifest:
        detail_fields = manifest.get("detail_fields", {})
        lighting_items: list[str] = detail_fields.get("lighting", [])
        if lighting_items:
            lighting_str = ", ".join(lighting_items[:2])
            parts.append(lighting_str)

    # Atmospheric motion based on narrative role
    atmo = _VEO2_ATMOSPHERIC_MOTION.get(
        narrative_role, _VEO2_DEFAULT_ATMOSPHERE
    )
    parts.append(atmo)

    # Film stock anchor
    parts.append("Shot on 35mm film, anamorphic lens.")

    # Join and cap at 50 words
    full_prompt = ". ".join(parts)
    # Clean up double periods
    full_prompt = re.sub(r"\.\.+", ".", full_prompt)

    words = full_prompt.split()
    if len(words) > 50:
        # Truncate at word boundary, ensure it ends cleanly
        full_prompt = " ".join(words[:50])
        if not full_prompt.endswith("."):
            full_prompt += "."

    return full_prompt


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
    existing_cache: dict[str, str] | None = None,
    imagen_rate_limiter: GlobalRateLimiter | None = None,
) -> str | None:
    """Generate a single Imagen 3 frame, upload to GCS, return GCS URI.

    Returns ``None`` if the image is filtered by Imagen 3's safety system or
    if an API error occurs -- the caller handles partial completion gracefully.

    If ``existing_cache`` contains an entry for ``blob_name``, the cached GCS
    URI is returned immediately without calling Imagen 3.

    When an ``imagen_rate_limiter`` is provided, the Imagen 3 API call is
    gated through the limiter (with in-flight tracking and wait-time
    warnings) instead of the legacy asyncio.Semaphore.

    Args:
        client: Shared google-genai Vertex AI client.
        semaphore: Legacy rate-limit gate (used when no imagen_rate_limiter).
        prompt: Full Imagen 3 text prompt.
        negative_prompt: Comma-separated elements to exclude.
        bucket_name: GCS bucket for upload.
        blob_name: Target blob path within the bucket.
        enhance_prompt: Whether Imagen 3 should auto-enhance the prompt.
            Disabled for long enriched prompts that are already detailed.
        existing_cache: Optional dict mapping blob names to GCS URIs for
            frames that already exist in GCS (cache hits skip generation).
        imagen_rate_limiter: Optional ``GlobalRateLimiter`` for Imagen 3 calls.

    Returns:
        GCS URI string or ``None`` on failure.
    """
    # GCS cache hit: skip Imagen 3 generation entirely
    if existing_cache and blob_name in existing_cache:
        logger.debug("GCS cache hit for %s -- skipping Imagen 3", blob_name)
        return existing_cache[blob_name]

    limiter = imagen_rate_limiter or _fallback_imagen_limiter

    async with limiter.acquire(caller=f"imagen3:{blob_name}"):
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
    scene_brief: dict[str, Any] | None = None,
    existing_cache: dict[str, str] | None = None,
    imagen_rate_limiter: GlobalRateLimiter | None = None,
    storyboard_uri: str | None = None,
) -> list[str]:
    """Generate Imagen 3 frames for one segment, selecting which frames based on narrative role.

    All frames run in parallel via ``asyncio.gather``.  Frames that fail
    (filtered content, API error) are silently dropped -- the segment still gets
    whichever frames succeeded.

    Args:
        client: Shared google-genai client.
        semaphore: Rate-limit gate.
        segment: SegmentScript dict.
        manifest: VisualDetailManifest dict for this scene, or ``None``.
        visual_bible: Imagen 3 style guide string.
        session_id: Session ID used to construct the GCS blob path.
        bucket_name: Target GCS bucket.
        narrative_role: Dramatic arc position for styling.
        scene_brief: Optional SceneBrief dict for temporal accuracy injection.
        existing_cache: Optional dict mapping blob names to GCS URIs for
            frames that already exist in GCS (cache hits skip generation).

    Returns:
        List of GCS URIs for successfully generated frames (0-4 items).
    """
    segment_id: str = segment.get("id", "unknown")
    frame_tasks = []

    for frame_idx in _frames_for_segment(segment, narrative_role):
        prompt, negative = _build_imagen_prompt(
            segment, manifest, visual_bible, frame_idx,
            narrative_role=narrative_role,
            scene_brief=scene_brief,
        )
        # Phase 3.1 creative director handoff: for frame 0, prepend the
        # Gemini storyboard GCS path as a creative direction note so judges
        # can trace the Gemini→Imagen pipeline. The path encodes scene_id,
        # making the provenance explicit in prompt logs.
        if frame_idx == 0 and storyboard_uri:
            scene_id_hint = segment.get("scene_id", "")
            prompt = (
                f"[Creative direction from Gemini storyboard — scene {scene_id_hint}] "
                f"{prompt}"
            )
            logger.debug(
                "Injected storyboard reference (%s) into Imagen 3 prompt for scene %s",
                storyboard_uri,
                scene_id_hint,
            )
        # Never let Imagen 3 enhance historical prompts -- it modernizes them
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
                existing_cache=existing_cache,
                imagen_rate_limiter=imagen_rate_limiter,
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

    The operation is **not polled here** -- the caller collects all operations
    and polls them together after all Imagen 3 work completes.

    Args:
        client: Shared google-genai Vertex AI client.
        veo2_prompt: Enriched dramatic scene description for Veo 2.
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
            "Triggered Veo 2 for scene %s -> output: %s", scene_id, output_uri
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


async def _mark_segment_video_skipped(
    db: firestore.AsyncClient,
    session_id: str,
    segment_id: str,
    reason: str = "timeout",
) -> None:
    """Mark a segment's video as skipped in Firestore (non-propagating).

    Called when Veo 2 times out or fails irrecoverably. Sets ``videoUrl``
    to ``None`` and writes a ``videoStatus`` field so the frontend and
    debugging tools can distinguish "no video attempted" from "video
    skipped due to timeout/error".

    This method never raises -- all exceptions are caught and logged so
    that a Firestore failure here cannot crash the pipeline.
    """
    ref = (
        db.collection("sessions")
        .document(session_id)
        .collection("segments")
        .document(segment_id)
    )
    try:
        await ref.update({
            "videoUrl": None,
            "videoStatus": f"skipped:{reason}",
        })
    except Exception as exc:
        logger.warning(
            "Firestore video skip update failed for %s: %s",
            segment_id,
            exc,
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
    scene_brief: dict[str, Any] | None = None,
    existing_cache: dict[str, str] | None = None,
    imagen_rate_limiter: GlobalRateLimiter | None = None,
    storyboard_uri: str | None = None,
) -> tuple[str, str, Any] | None:
    """Generate images for one segment, persist to Firestore, emit SSE.

    Generates all Imagen 3 frames concurrently, then:
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
        narrative_role: Dramatic arc position for styling.
        scene_brief: Optional SceneBrief dict for temporal accuracy injection.
        existing_cache: Optional GCS cache dict for skipping already-generated frames.

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

    # --- Generate Imagen 3 frames (concurrent, with GCS cache) ---
    image_urls = await _generate_segment_images(
        client=client,
        semaphore=semaphore,
        segment=segment,
        manifest=manifest,
        visual_bible=visual_bible,
        session_id=session_id,
        bucket_name=bucket_name,
        narrative_role=narrative_role,
        scene_brief=scene_brief,
        existing_cache=existing_cache,
        imagen_rate_limiter=imagen_rate_limiter,
        storyboard_uri=storyboard_uri,
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

    # Emit segment_update -- frontend DocumentaryPlayer can start loading
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
        # Enrich the Veo 2 prompt with period lighting + atmosphere (Change 4)
        enriched_veo2 = _build_enriched_veo2_prompt(
            veo2_scene,
            narrative_role=narrative_role,
            manifest=manifest,
        )
        operation = await _trigger_veo2_generation(
            client=client,
            veo2_prompt=enriched_veo2,
            session_id=session_id,
            scene_id=scene_id,
            bucket_name=bucket_name,
        )
        if operation:
            return (segment_id, scene_id, operation)

    return None


# ---------------------------------------------------------------------------
# VisualDirectorOrchestrator -- Phase V BaseAgent
# ---------------------------------------------------------------------------


class VisualDirectorOrchestrator(BaseAgent):
    """Phase V orchestrator: Imagen 3 image generation and Veo 2 video generation.

    Reads ``VisualDetailManifest`` objects (Phase IV) and ``SegmentScript`` dicts
    (Phase III), generates Imagen 3 frames per segment with temporal accuracy
    injection, lens specs, film stock references, and era art style anchors.
    Optionally fires enriched Veo 2 prompts for segments with dramatic scene
    descriptions. Persists all GCS URIs to Firestore and emits
    ``segment_update(status="complete")`` SSE events.

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
    gemini_rate_limiter: Any = Field(
        default=None,
        description="Optional GlobalRateLimiter for Gemini API call concurrency control.",
    )
    imagen_rate_limiter: Any = Field(
        default=None,
        description="Optional GlobalRateLimiter for Imagen 3 API call concurrency control.",
    )
    sub_agents: list[BaseAgent] = Field(
        default_factory=list,
        description=(
            "Declared for ADK BaseAgent compatibility. "
            "Unused -- all AI calls are made directly via the google-genai client."
        ),
    )

    async def generate_video_background(
        self,
        ctx: InvocationContext,
        scene_index: int,
        segment: dict[str, Any],
    ) -> None:
        """Fire-and-forget: triggers Veo 2 and polls in background.

        Safe to call via ``asyncio.create_task``. Triggers a Veo 2 generation
        for the given segment, polls until complete (or timeout), then updates
        Firestore with the video URL and emits a ``segment_update`` SSE event.

        All exceptions are caught and logged -- this method never propagates
        errors so that calling it as a background task cannot crash the
        pipeline.

        Args:
            ctx: ADK invocation context (for session ID and state access).
            scene_index: Zero-based index of the scene (for logging).
            segment: SegmentScript dict containing at minimum ``id``,
                ``scene_id``, ``veo2_scene``, and optionally ``mood``.
        """
        segment_id: str = segment.get("id", "unknown")
        scene_id: str = segment.get("scene_id", "unknown")
        session_id: str = ctx.session.id
        veo2_scene: str | None = segment.get("veo2_scene")

        if not veo2_scene:
            logger.debug(
                "Veo2 background: no veo2_scene for segment %s, skipping",
                segment_id,
            )
            return

        try:
            # Build Vertex AI client
            client = google_genai.Client(
                vertexai=True,
                project=self.firestore_project,
                location="us-central1",
            )
            db = firestore.AsyncClient(project=self.firestore_project)

            # Resolve narrative role for prompt enrichment
            scene_briefs_raw: list[dict[str, Any]] = ctx.session.state.get(
                "scene_briefs", []
            )
            narrative_role_map: dict[str, str] = {
                b.get("scene_id", ""): b.get("narrative_role", "")
                for b in scene_briefs_raw
            }
            narrative_role = narrative_role_map.get(scene_id, "")

            # Resolve manifest for period lighting enrichment
            manifests: dict[str, dict[str, Any]] = ctx.session.state.get(
                "visual_research_manifest", {}
            )
            manifest = manifests.get(scene_id)

            # Enrich the Veo 2 prompt
            enriched_veo2 = _build_enriched_veo2_prompt(
                veo2_scene,
                narrative_role=narrative_role,
                manifest=manifest,
            )

            # Trigger the Veo 2 generation
            operation = await _trigger_veo2_generation(
                client=client,
                veo2_prompt=enriched_veo2,
                session_id=session_id,
                scene_id=scene_id,
                bucket_name=self.gcs_bucket,
            )

            if operation is None:
                logger.warning(
                    "Veo2 background: trigger failed for scene %d (%s), skipping",
                    scene_index,
                    scene_id,
                )
                await _mark_segment_video_skipped(
                    db, session_id, segment_id, reason="trigger_failed",
                )
                return

            # Poll with hard timeout
            video_uri: str | None = None
            timed_out = False
            try:
                video_uri = await asyncio.wait_for(
                    _poll_veo2_operation(
                        client, operation, segment_id, scene_id,
                    ),
                    timeout=_VEO2_HARD_TIMEOUT_SECONDS,
                )
            except asyncio.TimeoutError:
                timed_out = True
                logger.warning(
                    "Veo2 background: hard timeout (%.0fs) for scene %d (%s)",
                    _VEO2_HARD_TIMEOUT_SECONDS,
                    scene_index,
                    scene_id,
                )

            if not video_uri:
                reason = "timeout" if timed_out else "generation_failed"
                await _mark_segment_video_skipped(
                    db, session_id, segment_id, reason=reason,
                )
                if self.emitter:
                    await self.emitter.emit(
                        "segment_update",
                        build_segment_update_event(
                            segment_id=segment_id,
                            scene_id=scene_id,
                            status="complete",
                        ),
                    )
                logger.info(
                    "Veo2 background: video skipped for scene %d (%s), reason=%s",
                    scene_index,
                    scene_id,
                    reason,
                )
                return

            # Success: update session state, Firestore, and emit SSE
            ctx.session.state.setdefault("video_urls", {})[segment_id] = video_uri

            await _update_segment_video_in_firestore(
                db, session_id, segment_id, video_uri,
            )

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
                "Veo2 background: video attached to scene %d (%s): %s",
                scene_index,
                scene_id,
                video_uri,
            )

        except Exception as exc:
            logger.error(
                "Veo2 background task failed for scene %d (%s): %s",
                scene_index,
                scene_id,
                exc,
                exc_info=True,
            )

    async def _run_async_impl(
        self,
        ctx: InvocationContext,
    ) -> AsyncGenerator[Any, None]:
        """Execute Phase V: announce -> generate images -> update Firestore -> poll Veo 2.

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
        # Phase 3.1 storyboard GCS URIs — dict[scene_id, list[str]].
        # The first URI per scene is used as creative direction context for
        # Imagen 3 prompt construction (Gemini as director, Imagen as cinematographer).
        storyboard_images: dict[str, list[str]] = ctx.session.state.get(
            "storyboard_images", {}
        )

        # Build scene_id -> narrative_role lookup from Phase I scene briefs
        # (narrative_role is on SceneBrief, not on SegmentScript)
        scene_briefs_raw: list[dict[str, Any]] = ctx.session.state.get("scene_briefs", [])
        narrative_role_map: dict[str, str] = {
            b.get("scene_id", ""): b.get("narrative_role", "")
            for b in scene_briefs_raw
        }
        # Build scene_id -> full SceneBrief lookup for temporal accuracy injection
        scene_brief_map: dict[str, dict[str, Any]] = {
            b.get("scene_id", ""): b
            for b in scene_briefs_raw
        }

        if not script_raw:
            logger.error(
                "Phase V: session.state['script'] is empty for session %s. "
                "Ensure Phase III (ScriptAgentOrchestrator) completed successfully.",
                session_id,
            )
            return

        # Test mode: 1 frame per segment (force "opening" role), skip Veo 2
        research_mode: str = ctx.session.state.get("research_mode", "normal")
        is_test_mode = research_mode == "test"
        if is_test_mode:
            narrative_role_map = {k: "opening" for k in narrative_role_map}
            logger.info("Phase V test mode: 1 frame per segment, no Veo 2")

        logger.info(
            "Phase V: generating visuals for %d segments, %d manifests available (mode=%s)",
            len(script_raw),
            len(manifests),
            research_mode,
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
        # 4 frames x N segments: cap concurrent Imagen 3 calls
        # (200 req/min limit -> 8 concurrent keeps well within headroom)
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
        # GCS cache check: identify already-generated frames (Task #16)
        # ------------------------------------------------------------------
        existing_cache: dict[str, str] = await _batch_check_existing_frames(
            bucket_name=self.gcs_bucket,
            session_id=session_id,
            segments=script_raw,
            narrative_role_map=narrative_role_map,
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
            brief = scene_brief_map.get(scene_id)
            # Inject Phase 3.1 storyboard URI as creative direction hint for
            # Imagen 3 prompt construction (first URI per scene, or None).
            storyboard_uris = storyboard_images.get(scene_id, [])
            storyboard_uri: str | None = storyboard_uris[0] if storyboard_uris else None
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
                scene_brief=brief,
                existing_cache=existing_cache,
                imagen_rate_limiter=self.imagen_rate_limiter,
                storyboard_uri=storyboard_uri,
            )

        # ------------------------------------------------------------------
        # Progressive delivery: scene 0 first -> remaining scenes concurrently
        # Phase IV may have already generated images inline for some segments.
        # Check session.state["image_urls"] and skip those -- only generate
        # images for segments that Phase IV did not process inline.
        # ------------------------------------------------------------------
        already_generated: dict[str, list[str]] = ctx.session.state.get(
            "image_urls", {}
        )
        # Background Veo 2 tasks: fire-and-forget per segment.
        # Each task polls independently after that segment's Imagen 3 completes.
        # Tasks are collected only to log completion counts -- they never
        # block the pipeline.
        veo2_background_tasks: list[asyncio.Task[None]] = []
        veo2_launched_count = 0

        def _launch_veo2_poll_background(
            segment_id: str,
            scene_id: str,
            operation: Any,
        ) -> None:
            """Launch a fire-and-forget background task to poll a Veo 2 operation.

            The polling task updates Firestore and emits SSE when the video
            completes (or marks as skipped on timeout/failure).  It never
            blocks the pipeline.
            """
            nonlocal veo2_launched_count

            async def _poll_and_update_bg() -> None:
                """Background coroutine: poll Veo 2 with hard timeout."""
                timed_out = False
                video_uri: str | None = None
                try:
                    video_uri = await asyncio.wait_for(
                        _poll_veo2_operation(
                            client, operation, segment_id, scene_id,
                        ),
                        timeout=_VEO2_HARD_TIMEOUT_SECONDS,
                    )
                except asyncio.TimeoutError:
                    timed_out = True
                    logger.warning(
                        "Veo 2 background hard timeout (%.0fs) for segment %s / scene %s",
                        _VEO2_HARD_TIMEOUT_SECONDS,
                        segment_id,
                        scene_id,
                    )
                except Exception as exc:
                    logger.error(
                        "Veo 2 background poll failed for segment %s: %s",
                        segment_id,
                        exc,
                        exc_info=True,
                    )

                if not video_uri:
                    reason = "timeout" if timed_out else "generation_failed"
                    await _mark_segment_video_skipped(
                        db, session_id, segment_id, reason=reason,
                    )
                    if self.emitter:
                        await self.emitter.emit(
                            "segment_update",
                            build_segment_update_event(
                                segment_id=segment_id,
                                scene_id=scene_id,
                                status="complete",
                            ),
                        )
                    logger.info(
                        "Veo 2 background: video skipped for segment %s (reason=%s)",
                        segment_id,
                        reason,
                    )
                    return

                # Success: update session state, Firestore, and emit SSE
                ctx.session.state.setdefault("video_urls", {})[
                    segment_id
                ] = video_uri
                await _update_segment_video_in_firestore(
                    db, session_id, segment_id, video_uri,
                )
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
                    "Veo 2 background: video attached to segment %s: %s",
                    segment_id,
                    video_uri,
                )

            task = asyncio.create_task(
                _poll_and_update_bg(),
                name=f"veo2_bg_{segment_id}",
            )
            veo2_background_tasks.append(task)
            veo2_launched_count += 1
            logger.info(
                "Launched Veo 2 background poll task for segment %s / scene %s",
                segment_id,
                scene_id,
            )

        # Fire Veo 2 background tasks for segments that Phase IV already
        # processed inline (images done but veo2_scene may need triggering)
        for i, seg in enumerate(script_raw):
            seg_id = seg.get("id", "")
            scene_id_v = seg.get("scene_id", "")
            role_v = narrative_role_map.get(scene_id_v, "")
            veo2_worthy = role_v == "climax" and bool(seg.get("veo2_scene"))
            if seg_id in already_generated and seg.get("veo2_scene") and not veo2_worthy:
                logger.info(
                    "Skipping Veo 2 for segment %s (narrative_role=%s, climax only)",
                    seg_id,
                    role_v,
                )
            if seg_id in already_generated and veo2_worthy:
                scene_id_bg = seg.get("scene_id", "unknown")
                manifest_v = manifests.get(scene_id_bg)
                enriched_veo2 = _build_enriched_veo2_prompt(
                    seg["veo2_scene"],
                    narrative_role=role_v,
                    manifest=manifest_v,
                )
                operation = await _trigger_veo2_generation(
                    client=client,
                    veo2_prompt=enriched_veo2,
                    session_id=session_id,
                    scene_id=scene_id_bg,
                    bucket_name=self.gcs_bucket,
                )
                if operation:
                    _launch_veo2_poll_background(seg_id, scene_id_bg, operation)

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
            # If _run_segment_generation returned a Veo 2 operation, poll it
            # in the background instead of batching
            if isinstance(result, tuple):
                _launch_veo2_poll_background(*result)

            # Remaining pending scenes run concurrently
            if len(pending_image_segs) > 1:
                remaining_results: list[Any] = await asyncio.gather(
                    *[_generate(seg) for seg in pending_image_segs[1:]],
                    return_exceptions=True,
                )
                for r in remaining_results:
                    if isinstance(r, tuple):
                        _launch_veo2_poll_background(*r)
                    elif isinstance(r, Exception):
                        logger.warning(
                            "Phase V: segment generation raised exception: %s", r
                        )
        else:
            logger.info(
                "Phase V: all %d segments already have images from Phase IV inline generation -- skipping Imagen 3",
                len(script_raw),
            )

        # ------------------------------------------------------------------
        # Persist image URL store to session state
        # ------------------------------------------------------------------
        ctx.session.state["image_urls"] = image_url_store

        # ------------------------------------------------------------------
        # Veo 2 background tasks: log launch count, do NOT await them.
        # They run independently and update Firestore + emit SSE on completion.
        # ------------------------------------------------------------------
        if veo2_launched_count:
            logger.info(
                "Phase V: %d Veo 2 background task(s) running for session %s "
                "(fire-and-forget, not blocking pipeline)",
                veo2_launched_count,
                session_id,
            )

        # ------------------------------------------------------------------
        # Final summary (images only -- Veo 2 completes asynchronously)
        # ------------------------------------------------------------------
        t_elapsed = round(time.monotonic() - t_start, 1)
        total_images = sum(len(v) for v in image_url_store.values())
        total_videos = len(ctx.session.state.get("video_urls", {}))

        if self.emitter:
            await self.emitter.emit(
                "stats_update",
                build_stats_update_event(
                    facts_verified=total_images,
                ),
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
                        f"{veo2_launched_count} Veo 2 video(s) generating in background",
                        f"Phase V images completed in {t_elapsed}s",
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

        # Required by ADK BaseAgent -- yield nothing (no sub-agent events)
        return
        yield  # noqa: unreachable -- satisfies AsyncGenerator protocol


# ---------------------------------------------------------------------------
# Factory function
# ---------------------------------------------------------------------------


def build_visual_director_orchestrator(
    emitter: SSEEmitter | None = None,
    gemini_rate_limiter: GlobalRateLimiter | None = None,
    imagen_rate_limiter: GlobalRateLimiter | None = None,
) -> VisualDirectorOrchestrator:
    """Construct a ``VisualDirectorOrchestrator`` from environment variables.

    Required environment variables:
        - ``GCP_PROJECT_ID``:    Google Cloud project ID (Firestore + Vertex AI).
        - ``GCS_BUCKET_NAME``:   GCS bucket for generated images and videos.

    Args:
        emitter: Optional SSE emitter for frontend progress events.
        gemini_rate_limiter: Optional ``GlobalRateLimiter`` for Gemini API calls.
        imagen_rate_limiter: Optional ``GlobalRateLimiter`` for Imagen 3 API calls.

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
        gemini_rate_limiter=gemini_rate_limiter,
        imagen_rate_limiter=imagen_rate_limiter,
    )
