"""Historical period visual reference profiles for AI documentary image generation.

Provides period-accurate visual vocabulary for Imagen 3 prompt construction.
Each profile contains architecture, clothing, materials, lighting, color palettes,
art style references, environmental markers, and era-specific negative prompt additions.

Used by VisualDirectorOrchestrator (Phase V) to enrich image prompts beyond what
web research alone provides, grounding them in verified art-historical vocabulary.
"""
from __future__ import annotations

# ---------------------------------------------------------------------------
# Period Profiles
# ---------------------------------------------------------------------------

HISTORICAL_PERIOD_PROFILES: dict[str, dict] = {

    "ottoman_empire": {
        "period_label": "Ottoman Empire, 16th-19th century",
        "date_range": (1453, 1922),
        "architecture": [
            "domed mosques with cascading semi-domes and pencil-thin minarets",
            "Iznik tile-covered interior walls with cobalt-blue, turquoise, and coral-red floral motifs",
            "pointed horseshoe arches with alternating voussoir stones in cream and dark red",
            "covered bazaars (bedesten) with vaulted stone ceilings and small high windows",
            "carved marble fountains (sebil) with bronze grilles and calligraphic inscriptions",
            "wooden lattice screens (mashrabiya) on residential upper floors",
            "courtyard gardens with geometric water channels and cypress trees",
            "hammam bathhouses with star-pierced domed ceilings casting spots of light",
            "caravanserai with arched stone porticos surrounding open courtyards",
            "muqarnas (honeycomb vaulting) in doorway niches and dome transitions",
        ],
        "clothing": [
            "layered kaftans with silk brocade and fur-trimmed collars",
            "voluminous salvar (harem trousers) in white linen or cotton",
            "turbans wound in large folds around a tall inner cap (men, pre-1826)",
            "red fez cap with black tassel (men, 1826-1925)",
            "entari (long robe) cinched with a broad sash at the waist",
            "embroidered waistcoats (yelek) over linen shirts",
            "leather pointed-toe slippers (yemeni) in red or yellow",
        ],
        "materials_textures": [
            "glazed Iznik ceramic tiles with raised coral-red slip",
            "carved white marble with deep-relief arabesques",
            "hammered copper and brass vessels with tinned interiors",
            "silk ikat fabrics with blurred-edge geometric patterns",
            "mother-of-pearl inlay on dark walnut wood",
            "hand-knotted wool carpets with medallion and prayer-niche designs",
        ],
        "lighting": [
            "shafts of light through small pierced dome openings onto stone floors",
            "oil lamps (kandil) hanging from chains, warm amber glow",
            "candlelight from bronze chandeliers reflected on glazed tilework",
            "dappled courtyard light filtered through plane tree canopy",
            "deep shadow in bazaar corridors with occasional high clerestory light",
        ],
        "color_palette": [
            "Iznik cobalt blue", "turquoise green", "coral red / Armenian bole",
            "cream/ivory limestone", "deep burgundy velvet", "gold leaf and gold thread",
            "warm sandstone", "cypress green",
        ],
        "art_style_references": [
            "in the style of 19th-century Orientalist painters, warm saturated palette, meticulous architectural detail",
            "Jean-Leon Gerome's photorealistic Orientalist technique — precise light, archaeological detail",
            "like a hand-tinted photograph from 1880s Istanbul, sepia base with selective color washes",
        ],
        "era_markers_negative": [
            "electric lights", "power lines", "paved asphalt roads",
            "plate glass windows", "printed posters with Latin alphabet",
            "automobiles", "bicycles", "concrete", "steel beams",
        ],
        "crowd_description": [
            "merchants in turbans and kaftans arranging bolts of silk on wooden stalls",
            "porters (hamal) bent under large bundles secured with rope on their backs",
            "craftsmen seated cross-legged at low workbenches in bazaar workshops",
        ],
    },

    "medieval_europe": {
        "period_label": "Medieval Europe, 11th-14th century",
        "date_range": (1000, 1400),
        "architecture": [
            "Romanesque thick-walled churches with round arches and barrel vaults",
            "Gothic cathedrals with pointed arches, ribbed vaults, and flying buttresses",
            "stone castles with crenellated battlements and arrow-slit windows",
            "timber-framed market halls with open ground-floor arcades",
            "cloistered monasteries with arched walkways around a central garden",
            "thatched-roof wattle-and-daub cottages with exposed timber framing",
        ],
        "clothing": [
            "long wool tunics (cotte) belted at the waist",
            "hooded cloaks (mantle) fastened with a brooch at the shoulder",
            "simple linen coifs and wimples covering women's hair",
            "monks in undyed wool habits with rope belts and tonsured heads",
        ],
        "materials_textures": [
            "rough-hewn limestone with visible chisel marks",
            "heavy oak timbers with adze marks and wooden peg joints",
            "hand-forged iron hardware — hinges, door studs, candleholders",
            "coarse-woven wool and undyed linen fabrics",
            "rush-strewn stone floors in great halls",
        ],
        "lighting": [
            "firelight from a central hearth casting upward shadows",
            "beeswax candles in iron candelabra, warm yellow-orange pools",
            "colored light streaming through stained glass windows onto stone floors",
            "torchlight on castle walls — flickering orange against dark stone",
        ],
        "color_palette": [
            "undyed wool gray-brown", "limestone cream", "dark oak brown",
            "iron rust", "moss green", "madder red (expensive, nobility only)",
            "woad blue", "parchment yellow", "charcoal black",
        ],
        "art_style_references": [
            "like a Flemish Masters oil painting — Van Eyck's luminous glazing, extraordinary material detail",
            "illuminated manuscript style — flat perspective, gold leaf, jewel-toned pigments",
            "historical reconstruction by Angus McBride — accurate detail with warm naturalistic light",
        ],
        "era_markers_negative": [
            "glass windows (except churches)", "chimneys (before 12th century)",
            "printed books", "gunpowder weapons (before 14th century)",
            "tomatoes, potatoes, maize (New World crops)",
        ],
        "crowd_description": [
            "hooded figures in wool cloaks filing through a cathedral doorway",
            "market vendors behind wooden trestle tables piled with root vegetables",
            "monks in brown habits walking in single file along a cloister",
        ],
    },

    "victorian_england": {
        "period_label": "Victorian England, 1837-1901",
        "date_range": (1837, 1901),
        "architecture": [
            "red-brick terraced houses with white stone lintels and iron railings",
            "cast-iron and glass structures — railway stations, market halls",
            "Gothic Revival church spires and pointed-arch windows with tracery",
            "industrial factories with tall brick chimneys belching dark smoke",
            "ornate cast-iron street lamps with glass globes",
        ],
        "clothing": [
            "men's top hats (silk, tall) and bowler hats (rounded, felt)",
            "frock coats, waistcoats with watch chains, high starched collars",
            "women's crinolines and bustles under layered skirts with petticoats",
            "working-class flat caps, heavy boots, canvas or wool trousers",
        ],
        "materials_textures": [
            "red brick with white mortar pointing in Flemish bond pattern",
            "cobblestones and granite setts, often wet and glistening",
            "soot-stained stone facades with dark patina",
            "gaslight glass globes with brass fittings",
            "coal dust on every surface in industrial areas",
        ],
        "lighting": [
            "gaslight — warm yellow-green glow reflected on wet cobblestones",
            "fog-diffused gaslight creating haloes around street lamps",
            "factory interiors lit by high dirty windows with dust-mote shafts",
            "candlelight on polished mahogany surfaces, deep shadows beyond",
        ],
        "color_palette": [
            "soot black", "red brick", "London fog gray", "gas lamp amber",
            "dark bottle green", "deep plum/aubergine", "Prussian blue", "tarnished brass",
        ],
        "art_style_references": [
            "daguerreotype photograph circa 1850 — mirror-like silver, extraordinary sharp detail, warm gold-toned highlights",
            "John Atkinson Grimshaw's Victorian nocturnes — wet reflective pavements, amber gaslight haloes in fog",
            "sepia-toned albumen print, 1870s — warm brown tones, soft focus at edges",
        ],
        "era_markers_negative": [
            "electric street lights (before 1880s)", "neon signs",
            "automobiles", "tarmac roads (before 1900s)",
            "concrete buildings", "plastic", "synthetic fabrics",
        ],
        "crowd_description": [
            "figures in top hats and frock coats striding past shop fronts",
            "women in bonnets and shawls at a market stall selling apples",
            "factory workers in flat caps streaming through mill gates",
        ],
    },

    "ancient_rome_greece": {
        "period_label": "Ancient Greece and Rome, 800 BC - 476 AD",
        "date_range": (-800, 476),
        "architecture": [
            "marble temples with Doric columns — fluted shafts, no base, plain capitals",
            "Roman forums with colonnaded porticos, basilicas, and central open plazas",
            "Roman concrete domes with oculus openings",
            "triumphal arches with relief-carved spandrels and attic inscriptions",
            "colonnaded stoas lining agora marketplaces",
            "terracotta-tiled roofs on stone and brick buildings",
        ],
        "clothing": [
            "Roman toga — large semicircular white wool cloth draped over left shoulder",
            "Greek chiton — lightweight linen tunic pinned at shoulders, belted at waist",
            "leather caligae military sandals with hobnailed soles",
            "laurel wreaths and diadems as ceremonial headwear",
        ],
        "materials_textures": [
            "Pentelic marble — warm cream-white with faint golden veins (NOTE: statues were painted, not plain white)",
            "Roman opus reticulatum — diamond-pattern brick and concrete walls",
            "terracotta — roof tiles, oil lamps, amphora storage vessels",
            "mosaic floors — small tesserae of colored stone and glass",
            "fresco-painted plaster walls in deep Pompeian red, black, and ochre",
            "travertine limestone — cream-colored, pitted surface",
        ],
        "lighting": [
            "Mediterranean sunlight — harsh, high-contrast shadows at midday",
            "olive oil lamps (lucerna) — small warm flames, multiple placed on stands",
            "sunlight through the Pantheon oculus moving across curved interior walls",
            "golden hour — warm horizontal light, long shadows, amber atmosphere",
        ],
        "color_palette": [
            "Pompeian red / cinnabar", "Egyptian blue", "marble cream (weathered)",
            "ochre yellow", "terracotta orange", "Tyrian purple (imperial only)",
            "charcoal fresco black", "gold leaf",
        ],
        "art_style_references": [
            "Lawrence Alma-Tadema painting — meticulous marble textures, Mediterranean light",
            "Pompeian wall fresco style — architectural trompe l'oeil, deep perspective, Pompeian red",
            "archaeological reconstruction illustration — accurate detail, warm natural light, slight patina",
        ],
        "era_markers_negative": [
            "stirrups on horses (not Classical antiquity)", "pointed Gothic arches",
            "paper, printed books, bound spines", "plate armor (much later than Roman)",
            "chimneys, plate glass windows",
            "white unpainted marble statues (they were polychrome painted)",
        ],
        "crowd_description": [
            "toga-clad figures debating in the shade of a colonnaded stoa",
            "merchants arranging pottery and amphorae on stone market tables",
            "robed philosophers walking along a garden path in conversation",
        ],
    },

    "ancient_egypt": {
        "period_label": "Ancient Egypt, 3100 BC - 30 BC",
        "date_range": (-3100, -30),
        "architecture": [
            "massive stone temples with battered (sloping) walls and cavetto cornice moldings",
            "hypostyle halls with towering papyrus-bud and lotus columns",
            "pylons — monumental trapezoidal gateway walls flanking temple entrances",
            "obelisks — tall monolithic granite needles with gold-tipped pyramidions",
            "mudbrick houses with flat roofs and narrow ventilation slots",
        ],
        "clothing": [
            "men's white linen kilts (shendyt) wrapped and pleated at the waist",
            "women's sheath dresses of fine white linen, sometimes pleated",
            "broad beaded collars (wesekh) in blue, red, green, and gold",
            "pharaonic headdresses — nemes cloth, double crown",
            "priests in leopard-skin mantles over white linen",
        ],
        "materials_textures": [
            "limestone ashlar blocks fitted without mortar, smooth-dressed faces",
            "red granite — polished to mirror finish for obelisks",
            "sun-dried mudbrick with straw binder, plastered and whitewashed",
            "gold leaf applied over carved wooden furniture",
            "faience — glazed ceramic in turquoise blue-green",
            "alabaster (calcite) — translucent carved vessels and lamps",
        ],
        "lighting": [
            "blazing desert sun creating razor-sharp shadows on monumental stone",
            "oil lamps in alabaster bowls casting warm translucent glow",
            "Nile-reflected golden light at dawn and dusk",
            "deep temple interior lit by reflected light and narrow clerestory slots",
        ],
        "color_palette": [
            "desert sand gold", "Egyptian blue (cuprorivaite)", "malachite green",
            "red ochre", "white gypsum", "gold / electrum", "turquoise faience",
        ],
        "art_style_references": [
            "like a David Roberts lithograph — Romantic grand scale, warm amber light, precise archaeological detail",
            "Egyptian wall painting conventions — composite view, flat color, hierarchical scale",
            "archaeological reconstruction — intact painted surfaces, vivid mineral pigments on fresh limestone",
        ],
        "era_markers_negative": [
            "iron tools (before Late Period)", "horses and chariots (before New Kingdom)",
            "coined money (before ~500 BC)", "arched doorways, domes (not Egyptian)",
            "alphabetic writing", "paper, printed text",
        ],
        "crowd_description": [
            "workers in white linen kilts hauling stone blocks on wooden sledges",
            "procession of robed priests carrying shrine on poles, seen in profile",
            "scribes seated cross-legged with papyrus scrolls under a columned portico",
        ],
    },

    "colonial_americas": {
        "period_label": "Colonial Americas, 17th-18th century",
        "date_range": (1600, 1780),
        "architecture": [
            "clapboard-sided timber houses with steep-pitched roofs and central brick chimneys",
            "Georgian-style brick mansions with symmetrical facades",
            "whitewashed Spanish colonial churches with bell towers and thick adobe walls",
            "wooden wharves and piers with mooring posts extending into harbors",
            "defensive palisade walls of sharpened timber logs around settlements",
        ],
        "clothing": [
            "men's breeches (knee-length), waistcoats, and long coats with large cuffs",
            "tricorn hats (three-cornered) in black felt",
            "women's stays (corsets), petticoats, and full skirts in homespun wool or linen",
            "frontier clothing — buckskin leggings, hunting shirts, fur caps",
        ],
        "materials_textures": [
            "hand-hewn oak and pine timber with visible adze marks and wooden pegs",
            "handmade red clay bricks in irregular sizes",
            "whitewashed lime plaster over lath or adobe",
            "hand-blown glass in small panes with visible bubbles and waviness",
            "hemp rope and canvas sails in harbor scenes",
        ],
        "lighting": [
            "candlelight from beeswax or tallow candles in tin or pewter holders",
            "fireplace as primary light source — warm orange glow",
            "lantern light on harbor docks — oil lamps in pierced-tin lanterns",
            "natural daylight through small multi-pane windows with wavy glass",
        ],
        "color_palette": [
            "raw timber brown", "whitewash cream", "brick red", "salt-spray gray",
            "indigo blue (imported dye)", "forest green", "pewter gray", "iron black",
        ],
        "art_style_references": [
            "Dutch Golden Age harbor scene — Vermeer-like light, meticulous ship rigging detail",
            "like a John Singleton Copley painting — sharp realism, domestic interiors, textile textures",
            "hand-colored engraving from a period travel journal — precise linework, selective watercolor washes",
        ],
        "era_markers_negative": [
            "gas lamps, electric lights", "paved roads, concrete, asphalt",
            "steam engines, factories", "photography",
            "plate glass, large windows", "telegraph or telephone poles",
        ],
        "crowd_description": [
            "dockworkers in rolled sleeves and leather aprons hauling barrels from a longboat",
            "figures in tricorn hats and long coats on a wooden boardwalk past shop fronts",
            "silhouetted sailors on ship rigging against a sunset harbor sky",
        ],
    },
}


# ---------------------------------------------------------------------------
# Mood → Lighting translation (Imagen 3 optimized)
# ---------------------------------------------------------------------------

MOOD_LIGHTING_MAP: dict[str, str] = {
    "solemn": (
        "low-key lighting, single source from above, deep shadows, muted palette, "
        "narrow tonal range, somber blue-gray atmosphere"
    ),
    "triumphant": (
        "golden hour backlight, warm lens flare, high-key fill light, "
        "saturated golds and warm ambers, upward-tilted framing"
    ),
    "foreboding": (
        "overcast diffused light, cold blue-grey tones, heavy shadows, "
        "low-hanging mist, flat shadowless illumination"
    ),
    "intimate": (
        "soft candlelight, warm amber glow from a single near source, "
        "shallow depth of field, close framing, deep shadows beyond"
    ),
    "epic": (
        "dramatic side-light, storm clouds in background, volumetric god rays, "
        "vast scale, wide-angle distortion, deep foreground-to-background layering"
    ),
    "mysterious": (
        "chiaroscuro, single shaft of light cutting through darkness, "
        "dust motes floating in beam, deep blacks with no fill light"
    ),
    "tragic": (
        "flat overcast diffused light, desaturated muted palette, "
        "empty negative space, low-angle framing, cool blue-grey tones"
    ),
    "wonder": (
        "volumetric golden light, warm atmospheric haze, upward camera angle, "
        "radiant soft-box quality, warm amber fill bouncing off light surfaces"
    ),
    "cinematic": (
        "golden hour or pre-golden hour, warm directional sidelight, "
        "natural atmospheric depth, shallow depth of field, anamorphic bokeh"
    ),
    "reflective": (
        "diffused natural light from above or side, soft shadows with visible gradients, "
        "interior north light quality, quiet atmosphere, even tonal range"
    ),
    "dramatic": (
        "high-contrast chiaroscuro, single strong directional source, "
        "deep shadows, bright highlights, Rembrandt lighting quality"
    ),
    "scholarly": (
        "diffused north window light, even soft illumination, "
        "no harsh shadows, interior intellectual atmosphere, cool neutral tones"
    ),
}


# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------


def detect_period_key(era: str) -> str | None:
    """Attempt to map a free-form era string to a profile key.

    Args:
        era: Free-form era string from SceneBrief (e.g. "18th century Ottoman Macedonia").

    Returns:
        A key into HISTORICAL_PERIOD_PROFILES, or None if no match found.
    """
    era_lower = era.lower()
    if any(k in era_lower for k in ("ottoman", "turkish", "sultanate")):
        return "ottoman_empire"
    if any(k in era_lower for k in ("medieval", "middle ages", "gothic", "romanesque", "crusade")):
        return "medieval_europe"
    if any(k in era_lower for k in ("victorian", "industrial revolution", "19th century england", "british empire")):
        return "victorian_england"
    if any(k in era_lower for k in ("roman", "greek", "classical antiquity", "ancient rome", "ancient greece")):
        return "ancient_rome_greece"
    if any(k in era_lower for k in ("egypt", "pharaoh", "hieroglyph", "nile")):
        return "ancient_egypt"
    if any(k in era_lower for k in ("colonial", "puritan", "pilgrim", "new world", "settler", "plantation", "1600", "1700")):
        return "colonial_americas"
    return None


def get_period_negative_prompt_additions(era: str) -> str:
    """Return era-specific negative prompt additions for a given era string.

    Args:
        era: Free-form era string from SceneBrief.

    Returns:
        Comma-separated negative prompt additions, or empty string.
    """
    key = detect_period_key(era)
    if not key:
        return ""
    markers = HISTORICAL_PERIOD_PROFILES[key].get("era_markers_negative", [])
    return ", ".join(markers)


def get_mood_lighting(mood: str) -> str:
    """Return Imagen 3-optimized lighting directive for a given mood string.

    Args:
        mood: Mood string from SegmentScript (cinematic/reflective/dramatic/scholarly
              or extended vocabulary).

    Returns:
        Lighting directive string for embedding in Imagen 3 prompts.
    """
    return MOOD_LIGHTING_MAP.get(mood.lower(), MOOD_LIGHTING_MAP["cinematic"])
