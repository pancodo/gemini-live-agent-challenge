"""Shared visual style functions for consistent period-accurate imagery.

Provides a portable ``build_style_block()`` that any image-generating component
can call to get consistent period-accurate style terms.  Used by:

  - ``visual_director_orchestrator.py`` (Phase V Imagen 3)
  - ``illustrate.py`` (live illustrations via Gemini interleaved output)
  - ``narrative_director_agent.py`` (Phase 3.1 storyboard)

The constants here mirror those in ``visual_director_orchestrator.py`` so that
every visual output in the system shares the same cinematic vocabulary.
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# Film stock references
# ---------------------------------------------------------------------------

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
# Atmospheric depth suffix
# ---------------------------------------------------------------------------

_ATMOSPHERE_SUFFIX: str = (
    "dust motes drifting in light beams, atmospheric depth, "
    "slight haze between foreground and background"
)

# ---------------------------------------------------------------------------
# Narrative-role driven visual styling
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# Public helpers
# ---------------------------------------------------------------------------


def detect_film_stock(mood: str, era: str, title: str) -> str:
    """Return the appropriate film stock reference based on mood/era/title.

    Scans the combined text for tungsten keywords (night, interior, etc.).
    Falls back to daylight film stock when no tungsten signal is detected.
    """
    combined = f"{mood} {era} {title}".lower()
    if any(kw in combined for kw in _TUNGSTEN_KEYWORDS):
        return _TUNGSTEN_FILM
    return _DAYLIGHT_FILM


def build_atmosphere_suffix(narrative_role: str) -> str:
    """Return narrative-role-appropriate atmospheric styling.

    Args:
        narrative_role: One of ``opening``, ``rising_action``, ``climax``,
            ``resolution``, ``coda``, or empty string for default.

    Returns:
        A combined prefix + suffix string suitable for prompt injection.
    """
    style = _NARRATIVE_ROLE_STYLES.get(narrative_role, _DEFAULT_STYLE)
    return f"{style['prefix']} {style['suffix']}"


def build_style_block(
    *,
    visual_bible: str,
    era: str,
    mood: str,
    title: str,
    narrative_role: str = "",
    scene_brief: dict | None = None,
) -> str:
    """Build a portable style block for any image-generating prompt.

    Combines film stock, atmospheric styling, period profile data, and the
    visual bible into a structured multi-line string that can be appended
    to any Imagen 3 or Gemini interleaved-output prompt.

    Args:
        visual_bible: The session's visual bible string (may be empty).
        era: Free-form era description (e.g. "Ottoman Empire, 16th century").
        mood: Mood descriptor (e.g. "cinematic", "dramatic", "contemplative").
        title: Segment or scene title.
        narrative_role: Position in documentary arc (opening, climax, etc.).
        scene_brief: Optional scene brief dict for additional context.

    Returns:
        A multi-line ``STYLE TERMS`` block ready for prompt injection.
    """
    film_stock = detect_film_stock(mood, era, title)
    atmosphere = build_atmosphere_suffix(narrative_role)

    # Try to get period profile if historical_period_profiles is available
    period_info = ""
    try:
        from .historical_period_profiles import (
            detect_period_key,
            HISTORICAL_PERIOD_PROFILES,
        )

        period_key = detect_period_key(era)
        if period_key and period_key in HISTORICAL_PERIOD_PROFILES:
            profile = HISTORICAL_PERIOD_PROFILES[period_key]
            period_info = f"- Period: {profile.get('period_label', period_key)}"
            palette = profile.get("color_palette")
            if palette:
                palette_str = ", ".join(palette[:5]) if isinstance(palette, list) else str(palette)
                period_info += f", palette: {palette_str}"
            arch = profile.get("architecture")
            if arch:
                arch_str = arch[0] if isinstance(arch, list) and arch else str(arch)
                period_info += f", architecture: {arch_str}"
    except (ImportError, Exception):
        pass

    lines = [
        "STYLE TERMS (apply these exactly):",
        f"- Visual Bible: {visual_bible[:400]}" if visual_bible else "- Visual Bible: (none)",
        f"- Film stock: {film_stock}",
        f"- Atmosphere: {atmosphere}",
    ]
    if period_info:
        lines.append(period_info)
    if era:
        lines.append(f"- Historical era: {era}")

    return "\n".join(lines)
