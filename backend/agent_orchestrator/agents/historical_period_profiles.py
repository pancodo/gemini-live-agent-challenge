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

    # ------------------------------------------------------------------
    # Expanded period profiles (Task #7)
    # ------------------------------------------------------------------

    "islamic_golden_age": {
        "period_label": "Islamic Golden Age, 750-1258",
        "date_range": (750, 1258),
        "architecture": [
            "horseshoe arches with alternating red and white voussoirs",
            "muqarnas honeycomb vaulting in dome transitions and niches",
            "geometric tilework in zellige mosaic patterns",
            "mashrabiya lattice screens on upper-floor windows",
            "hypostyle prayer halls with rows of columns and double arches",
            "courtyard gardens with geometric water channels and fountains",
        ],
        "clothing": [
            "flowing robes (thawb) in white linen or cotton",
            "layered turbans in white or colored silk wound around a cap",
            "embroidered caftans with wide sleeves and sash belts",
            "leather pointed-toe slippers (babouche)",
        ],
        "materials_textures": [
            "luster ceramics with iridescent gold and copper glazes",
            "carved stucco arabesques with deep relief",
            "hammered brass astrolabes and scientific instruments",
            "hand-knotted wool and silk carpets with medallion designs",
            "calligraphic inscriptions in Kufic and Naskh scripts on stone",
        ],
        "lighting": [
            "shafts of light through pierced stone screens onto tile floors",
            "oil lamps in brass holders casting warm amber glow",
            "dappled courtyard light filtered through citrus tree canopy",
            "deep shadow in covered souks with occasional clerestory light",
        ],
        "color_palette": [
            "cobalt blue", "turquoise green", "ivory cream", "gold leaf",
            "indigo", "lapis lazuli blue", "terracotta", "saffron yellow",
        ],
        "art_style_references": [
            "Persian miniature painting — flat perspective, jewel-toned pigments, gold leaf borders",
            "meticulous geometric precision of Islamic decorative arts",
            "archaeological reconstruction — vibrant original painted surfaces, pristine tilework",
        ],
        "era_markers_negative": [
            "Ottoman pencil minarets", "printed Latin text", "concrete",
            "plate glass windows", "electric lights", "paved asphalt roads",
            "automobiles", "steel beams",
        ],
        "crowd_description": [
            "scholars in turbans and flowing robes debating around manuscripts in a library",
            "craftsmen seated cross-legged at low workbenches hammering brass",
            "merchants arranging spices and textiles on wooden stalls in a covered souk",
        ],
    },

    "east_asian_imperial": {
        "period_label": "East Asian Imperial, 618-1912",
        "date_range": (618, 1912),
        "architecture": [
            "dougong interlocking bracket sets supporting wide eaves",
            "curved glazed ceramic roofs with ridge ornaments and dragon finials",
            "lacquered vermillion timber columns on raised stone platforms",
            "courtyard compounds with symmetrical hall arrangements along central axes",
            "moon gates and garden rockeries with winding paths",
            "pagodas with tiered eaves diminishing upward",
        ],
        "clothing": [
            "hanfu robes with wide sleeves, crossed-collar wrap, and sash belt",
            "silk brocade court robes with embroidered dragon or phoenix roundels",
            "scholar's cap (futou or wushamao) in black gauze",
            "embroidered silk slippers with upturned toes",
        ],
        "materials_textures": [
            "blue-and-white porcelain with cobalt underglaze decoration",
            "carved jade — translucent green nephrite with polished surfaces",
            "lacquerware — deep glossy red and black with gold inlay",
            "silk brocade with woven metallic gold threads",
            "rice paper with ink-wash calligraphy and seal stamps",
        ],
        "lighting": [
            "soft diffused light through rice paper window screens",
            "lantern light from silk-covered bamboo frames — warm orange glow",
            "morning mist on garden ponds reflecting pavilion silhouettes",
            "dramatic side light through courtyard openings onto polished stone floors",
        ],
        "color_palette": [
            "vermillion red", "imperial yellow", "jade green", "cobalt blue",
            "lacquer black", "gold leaf", "celadon green", "ink wash grey",
        ],
        "art_style_references": [
            "Song dynasty ink-wash landscape painting — atmospheric perspective, misty mountains",
            "Ming dynasty court painting — precise detail, rich color, formal composition",
            "ukiyo-e woodblock print influence — bold outlines, flat color, dynamic composition",
        ],
        "era_markers_negative": [
            "Western-style architecture", "glass windows (before late Qing)",
            "printed Western text", "concrete", "electric lights",
            "automobiles", "Western clothing",
        ],
        "crowd_description": [
            "officials in embroidered silk robes filing through a palace gateway",
            "scholars in dark robes and caps seated at low tables with ink and brush",
            "market vendors behind wooden stalls displaying porcelain and silk",
        ],
    },

    "indian_subcontinent": {
        "period_label": "Indian Subcontinent, 320-1857",
        "date_range": (320, 1857),
        "architecture": [
            "pietra dura marble inlay with semi-precious stone floral patterns",
            "red sandstone jali pierced screens with geometric patterns",
            "onion domes and bulbous cupolas with lotus finials",
            "shikhara temple towers with curvilinear profiles and carved niches",
            "stepped wells (stepwells/vav) with geometric descending galleries",
            "chhatri domed pavilions on pillared bases",
        ],
        "clothing": [
            "draped cotton or silk dhoti and angavastram (shoulder cloth) for men",
            "richly embroidered Mughal court jama — long tunic with tied fastenings",
            "silk sari with zari gold-thread borders and pallav end piece",
            "jeweled turbans with aigrette plume holders and gemstone centrepieces",
        ],
        "materials_textures": [
            "white Makrana marble — polished, translucent in thin sections",
            "red Agra sandstone — carved with deep-relief floral and geometric motifs",
            "lapis lazuli, carnelian, jade, and malachite inlay in marble",
            "hand-knotted silk carpets with floral medallion patterns",
            "hammered silver and gold with kundan gemstone settings",
        ],
        "lighting": [
            "blazing South Asian sunlight creating sharp shadows on white marble",
            "oil lamps (diyas) in brass holders casting warm pools of amber light",
            "filtered light through jali screens creating geometric shadow patterns",
            "golden hour light reflecting off marble domes and water channels",
        ],
        "color_palette": [
            "white marble", "red sandstone", "lapis lazuli blue", "carnelian red",
            "jade green", "gold leaf", "turmeric yellow", "indigo",
        ],
        "art_style_references": [
            "Mughal miniature painting — precise naturalistic detail, jewel tones, gold borders",
            "Rajput court painting — vivid color, emotional expression, architectural backdrops",
            "archaeological reconstruction — pristine surfaces, original painted decoration visible",
        ],
        "era_markers_negative": [
            "British colonial architecture", "railways", "telegraph poles",
            "printed English text", "concrete", "electric lights",
            "Western clothing", "plate glass windows",
        ],
        "crowd_description": [
            "court figures in embroidered jamas and jeweled turbans seated on cushions",
            "devotees in white dhoti and sari approaching a temple gateway",
            "craftsmen carving stone in a workshop under a pillared pavilion",
        ],
    },

    "mesoamerican": {
        "period_label": "Mesoamerican Civilizations, 2000 BC - 1533 AD",
        "date_range": (-2000, 1533),
        "architecture": [
            "stepped pyramids with steep stairways and flat-topped temple platforms",
            "corbeled arches in narrow stone passageways",
            "ball courts with sloping stone walls and carved stone rings",
            "palaces with interior courtyards and carved stone lintels",
            "raised causeways connecting island cities across lake water",
        ],
        "clothing": [
            "cotton loincloths (maxtlatl) and tilma cloaks for men",
            "quetzal feather headdresses with jade and gold ornaments",
            "jade earplugs, lip plugs, and pectoral ornaments",
            "woven huipil tunics with geometric embroidered patterns",
        ],
        "materials_textures": [
            "carved limestone with deep-relief glyphs and figures",
            "obsidian — polished black volcanic glass for blades and mirrors",
            "jade — polished deep green stone for masks and jewelry",
            "painted stucco on temple facades in vivid mineral pigments",
            "hand-woven cotton and agave fiber textiles",
        ],
        "lighting": [
            "tropical sunlight creating harsh shadows on white limestone pyramids",
            "torch and pine-resin firelight in dark temple interiors",
            "jungle-filtered light with dappled green shadows",
            "dawn light on pyramid summits above morning mist",
        ],
        "color_palette": [
            "Maya blue (indigo + palygorskite)", "jade green", "obsidian black",
            "cinnabar red", "limestone cream", "gold", "quetzal green",
        ],
        "art_style_references": [
            "Maya polychrome ceramic painting — narrative scenes, fine linework, vivid pigments",
            "archaeological reconstruction — intact painted facades, pristine carved stone",
            "Aztec codex illustration style — bold outlines, flat color, symbolic composition",
        ],
        "era_markers_negative": [
            "horses", "cattle", "iron tools or weapons", "wheeled vehicles",
            "true arches", "steel", "glass windows", "printed text",
            "European clothing", "brick construction",
        ],
        "crowd_description": [
            "priests in feathered headdresses ascending pyramid steps with offerings",
            "merchants carrying bundles on tumplines through a market plaza",
            "artisans seated on mats carving jade with stone tools",
        ],
    },

    "sub_saharan_african": {
        "period_label": "Sub-Saharan African Civilizations, 300-1900",
        "date_range": (300, 1900),
        "architecture": [
            "dry-stone chevron-patterned walls of Great Zimbabwe",
            "mud-brick mosques with toron wooden spikes protruding from walls",
            "circular thatched-roof rondavels with plastered walls",
            "Swahili coast coral-stone houses with carved wooden doors",
            "Ethiopian rock-hewn churches carved from living volcanic tuff",
        ],
        "clothing": [
            "wrapped cotton or bark-cloth garments draped at the shoulder",
            "kente cloth — hand-woven silk and cotton strips in geometric patterns",
            "beaded jewelry and brass neck rings",
            "embroidered boubou robes with wide sleeves and matching trousers",
        ],
        "materials_textures": [
            "dry-stacked granite blocks fitted without mortar",
            "sun-dried mud brick (banco) with annual plaster renewal",
            "Benin bronze plaques — lost-wax cast, detailed relief figures",
            "hand-woven raffia and cotton textiles with resist-dyed patterns",
            "hammered gold jewelry — Ashanti goldweights and ornaments",
        ],
        "lighting": [
            "intense equatorial sunlight casting deep shadows on laterite earth",
            "firelight from central hearths in enclosed compounds",
            "golden savanna light at dawn and dusk — long horizontal shadows",
            "filtered light through thatched roofs creating spotted patterns",
        ],
        "color_palette": [
            "ochre brown", "laterite red", "indigo blue", "kente gold",
            "mud plaster cream", "charcoal black", "baobab grey", "savanna green",
        ],
        "art_style_references": [
            "archaeological reconstruction — intact painted surfaces, original decoration",
            "Benin bronze aesthetic — precise relief carving, formal composition",
            "National Geographic archaeological illustration — accurate detail, warm light",
        ],
        "era_markers_negative": [
            "European colonial architecture", "printed text in European languages",
            "concrete", "electric lights", "automobiles",
            "Western clothing", "plate glass windows",
        ],
        "crowd_description": [
            "figures in wrapped garments and beaded jewelry approaching stone enclosure walls",
            "craftsmen casting bronze in clay molds near a furnace",
            "traders in embroidered robes with bundles of goods at a market crossroads",
        ],
    },

    "byzantine": {
        "period_label": "Byzantine Empire, 330-1453",
        "date_range": (330, 1453),
        "architecture": [
            "pendentive domes on massive square bases with clerestory windows",
            "gold mosaic tesserae covering interior domes, apse, and walls",
            "marble revetment panels in opus sectile geometric patterns",
            "narthex entrance halls with bronze doors and carved marble capitals",
            "fortified circuit walls with towers and crenellated battlements",
        ],
        "clothing": [
            "imperial purple silk dalmatic robes with gold embroidered bands (clavi)",
            "jeweled diadems and pearl pendilia hanging beside the face",
            "draped chlamys cloaks fastened with jeweled fibulae at the shoulder",
            "monks in undyed dark wool habits with rope belts",
        ],
        "materials_textures": [
            "gold glass mosaic tesserae set at slight angles for shimmer",
            "porphyry — imperial dark purple-red stone, polished to mirror finish",
            "cloisonne enamel — gold wire cells filled with vitreous color",
            "silk roundels with woven imperial eagle or lion motifs",
            "carved ivory diptychs and reliquary panels",
        ],
        "lighting": [
            "golden light from hundreds of oil lamps reflected off mosaic tesserae",
            "shafts of light through clerestory windows catching incense smoke",
            "candlelight on polished marble and gold surfaces — warm shimmer",
            "filtered light through thin alabaster window panels",
        ],
        "color_palette": [
            "gold dominant", "Tyrian purple", "lapis lazuli blue", "crimson silk red",
            "porphyry purple-red", "marble white", "deep green malachite", "ivory cream",
        ],
        "art_style_references": [
            "Byzantine mosaic style — gold ground, frontal figures, hierarchical scale, jeweled colors",
            "icon painting tradition — formal composition, symbolic color, gold leaf background",
            "archaeological reconstruction — intact mosaic and painted surfaces, full imperial splendor",
        ],
        "era_markers_negative": [
            "Gothic pointed arches (Western, not Byzantine)", "printed books",
            "plate glass windows", "concrete", "Western medieval armor styles",
            "Renaissance perspective painting", "minarets (Ottoman addition)",
        ],
        "crowd_description": [
            "robed figures in jeweled dalmatics processing through a mosaic-lined narthex",
            "monks in dark habits filing through a cloister carrying censers",
            "courtiers in silk robes and pearl diadems flanking an imperial throne",
        ],
    },

    "viking_norse": {
        "period_label": "Viking and Norse, 793-1066",
        "date_range": (793, 1066),
        "architecture": [
            "tarred timber longhouses with turf roofs and curved walls",
            "stave churches with dragon-head finials and interlocking timber frames",
            "runestones — tall carved granite markers with serpentine Urnes-style ornament",
            "timber-palisaded trading posts with earthen ramparts",
            "ship sheds and beaching ramps along fjord shorelines",
        ],
        "clothing": [
            "wool tunics over linen undershirts belted at the waist",
            "fur-trimmed cloaks fastened with penannular brooches",
            "leather shoes and boots with wrapped leg bindings (winningas)",
            "conical helmets with nasal guards — NO horns (Victorian myth)",
        ],
        "materials_textures": [
            "tarred oak timber with visible adze marks and iron nail heads",
            "pattern-welded iron blades with flowing wave patterns",
            "carved bone and antler combs, pins, and gaming pieces",
            "amber — translucent golden-orange beads and pendants",
            "hand-woven wool with tablet-woven decorative borders",
        ],
        "lighting": [
            "longhouse hearth fire — central flame casting upward shadows on rafters",
            "cold northern light — low-angle sun, long blue shadows on snow",
            "oil lamps in soapstone bowls with flickering wicks",
            "dramatic aurora borealis — green curtains over dark landscape",
        ],
        "color_palette": [
            "tar black", "iron grey", "amber gold", "raw timber brown",
            "turf green", "bone white", "hearth fire orange", "fjord blue-grey",
        ],
        "art_style_references": [
            "Bayeux Tapestry narrative style — flat figures, bold outlines, sequential scenes",
            "archaeological reconstruction — weathered timber, authentic materials, Northern light",
            "Romantic Nordic landscape painting — dramatic skies, fjords, stark beauty",
        ],
        "era_markers_negative": [
            "horned helmets (Victorian myth)", "plate armor (much later)",
            "Gothic architecture", "printed books", "concrete",
            "electric lights", "glass windows (rare, only very wealthy)",
        ],
        "crowd_description": [
            "warriors in wool tunics and fur cloaks gathered around a beached longship",
            "women in brooched apron dresses weaving at upright looms in a longhouse",
            "figures in hooded cloaks examining carved runestones along a path",
        ],
    },

    "renaissance_europe": {
        "period_label": "Renaissance Europe, 1350-1650",
        "date_range": (1350, 1650),
        "architecture": [
            "rusticated stone palazzi with arched ground-floor arcades and corniced rooflines",
            "classical orders — Doric, Ionic, Corinthian columns on facades and loggias",
            "Brunelleschi-style domes with octagonal double-shell construction",
            "loggia galleries with round arches overlooking piazzas",
            "timber-framed Tudor manor houses with tall brick chimneys and mullioned windows",
        ],
        "clothing": [
            "silk velvet doublets with slashed sleeves revealing contrasting lining",
            "ruff collars — starched white linen in elaborate figure-eight pleats",
            "men's hose and codpiece (15th-16th century) in contrasting colors",
            "women's structured bodices with wide skirts over farthingale frames",
            "berets and flat caps with feather plumes and jeweled brooches",
        ],
        "materials_textures": [
            "Carrara marble — white with fine grey veining, polished to satin finish",
            "oil paint on wooden panel and canvas — visible brushwork, glazing layers",
            "gilt bronze — fire-gilded cast metal with warm golden surface",
            "hand-blown Murano glass — clear cristallo and colored millefiori",
            "tooled leather book bindings with gold-stamped decoration",
        ],
        "lighting": [
            "north window studio light — even diffused illumination, soft shadows",
            "candlelight from silver candelabra on polished wooden surfaces",
            "golden hour Mediterranean light streaming through arched windows",
            "chiaroscuro — dramatic single-source illumination against deep shadow",
        ],
        "color_palette": [
            "Venetian red", "ultramarine blue", "gold leaf", "verdaccio green",
            "raw sienna", "lead white", "lamp black", "Tyrian purple (rare, expensive)",
        ],
        "art_style_references": [
            "Italian Renaissance painting — linear perspective, sfumato, anatomical precision",
            "Northern Renaissance detail — Van Eyck luminous oil technique, meticulous textiles",
            "Vermeer interior light — soft diffusion, domestic intimacy, optical precision",
        ],
        "era_markers_negative": [
            "Baroque excess and heavy gilding (later period)",
            "Neoclassical symmetry (18th century)", "gas lamps, electric lights",
            "concrete, steel, plate glass", "printed photographs",
            "industrial machinery", "automobiles",
        ],
        "crowd_description": [
            "merchants in velvet doublets and flat caps examining ledgers at a counting table",
            "courtiers in slashed sleeves and ruff collars gathered in a loggia",
            "artists in paint-stained smocks working at easels in a north-lit studio",
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

    # --- Priority-ordered matching (more specific before more general) ---

    # Byzantine BEFORE Roman (to avoid "eastern roman" matching "roman")
    if any(k in era_lower for k in ("byzantine", "byzantium", "eastern roman", "justinian", "theodora")):
        return "byzantine"
    # Renaissance BEFORE medieval (to avoid "14th century" overlap)
    if any(k in era_lower for k in ("renaissance", "medici", "tudor", "elizabethan", "gutenberg", "florence")):
        return "renaissance_europe"
    if any(k in era_lower for k in ("ottoman", "turkish", "sultanate")):
        return "ottoman_empire"
    if any(k in era_lower for k in ("islamic golden age", "abbasid", "umayyad", "house of wisdom", "al-andalus", "cordoba", "caliphate")):
        return "islamic_golden_age"
    if any(k in era_lower for k in ("tang", "song", "ming", "qing", "forbidden city", "hanfu", "imperial china", "imperial japan", "shogun")):
        return "east_asian_imperial"
    if any(k in era_lower for k in ("mughal", "gupta", "taj mahal", "rajput", "akbar", "shah jahan", "chola", "vijayanagara")):
        return "indian_subcontinent"
    if any(k in era_lower for k in ("aztec", "maya", "inca", "tenochtitlan", "machu picchu", "quetzalcoatl", "mesoameric", "olmec", "toltec")):
        return "mesoamerican"
    if any(k in era_lower for k in ("mali empire", "great zimbabwe", "timbuktu", "mansa musa", "axum", "benin", "songhai", "swahili")):
        return "sub_saharan_african"
    if any(k in era_lower for k in ("viking", "norse", "varangian", "rune", "longship")):
        return "viking_norse"
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


def detect_period(text: str) -> str | None:
    """Detect historical period from document text using keyword matching.

    Checks against all profile detect keywords with priority ordering to
    avoid false positives (e.g. "byzantine" before "roman", "renaissance"
    before "medieval").

    Args:
        text: Free-form text (visual_bible + scene text, document OCR, etc.)

    Returns:
        A key into HISTORICAL_PERIOD_PROFILES, or ``None`` if no match found.
    """
    text_lower = text.lower()

    # Priority order: more specific periods before broader ones to prevent
    # false positives (e.g. "eastern roman" should match byzantine, not roman).
    _DETECT_KEYWORDS: dict[str, list[str]] = {
        "byzantine": ["byzantine", "byzantium", "eastern roman", "justinian", "theodora"],
        "renaissance_europe": ["renaissance", "medici", "tudor", "elizabethan", "gutenberg", "florence"],
        "islamic_golden_age": ["abbasid", "umayyad", "house of wisdom", "al-andalus", "cordoba"],
        "east_asian_imperial": ["tang", "song", "ming", "qing", "forbidden city", "hanfu"],
        "indian_subcontinent": ["mughal", "gupta", "taj mahal", "rajput", "akbar", "shah jahan"],
        "mesoamerican": ["aztec", "maya", "inca", "tenochtitlan", "machu picchu", "quetzalcoatl"],
        "sub_saharan_african": ["mali empire", "great zimbabwe", "timbuktu", "mansa musa", "axum", "benin"],
        "viking_norse": ["viking", "norse", "varangian", "rune", "longship"],
        "ottoman_empire": ["ottoman", "turkish", "sultanate"],
        "medieval_europe": ["medieval", "middle ages", "gothic", "romanesque", "crusade"],
        "victorian_england": ["victorian", "industrial revolution", "british empire"],
        "ancient_rome_greece": ["roman", "greek", "classical antiquity", "ancient rome", "ancient greece"],
        "ancient_egypt": ["egypt", "pharaoh", "hieroglyph", "nile"],
        "colonial_americas": ["colonial", "puritan", "pilgrim", "new world"],
    }

    priority_order = [
        "byzantine", "renaissance_europe", "islamic_golden_age",
        "east_asian_imperial", "indian_subcontinent", "mesoamerican",
        "sub_saharan_african", "viking_norse", "ottoman_empire",
        "medieval_europe", "victorian_england", "ancient_rome_greece",
        "ancient_egypt", "colonial_americas",
    ]

    for key in priority_order:
        keywords = _DETECT_KEYWORDS[key]
        if any(kw in text_lower for kw in keywords):
            return key

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
