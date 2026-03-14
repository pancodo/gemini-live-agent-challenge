"""
Restyle the Live2D Chitose texture atlas from anime → old bearded professor.

Uses Gemini's image editing to transform the texture while preserving
exact pixel positions of each part (face, eyes, hair, suit, etc.)
so the Live2D mesh/rigging still works.

Strategy:
  1. Crop individual parts from the atlas (face, hair, eyes, mouth, suit)
  2. Restyle each part with Gemini image editing
  3. Paste restyled parts back into the atlas at exact same positions

This preserves UV mapping because each piece stays in the same pixel location.
"""

import sys
import os
import time
from pathlib import Path
from PIL import Image
from google import genai
from google.genai import types

# ── Config ────────────────────────────────────────────────────────

API_KEY = os.environ.get("GOOGLE_API_KEY", "")
MODEL = "gemini-2.5-flash-image"
MAX_RETRIES = 5
RETRY_DELAY = 30  # seconds between retries on rate limit

TEXTURE_PATH = Path(__file__).parent.parent / "frontend" / "public" / "models" / "aldric" / "chitose.2048" / "texture_00.png"
OUTPUT_DIR = Path(__file__).parent.parent / "frontend" / "public" / "models" / "aldric" / "chitose.2048"

# ── Part regions (x, y, w, h) in the 2048x2048 atlas ─────────────
# Each region is a bounding box for a group of related parts.
# We restyle each region independently to preserve layout.

REGIONS = {
    "face_and_features": {
        "box": (0, 0, 530, 700),
        "prompt": (
            "Transform this anime character face and facial features into a "
            "realistic semi-realistic oil painting style of a distinguished elderly professor "
            "in his late 60s. Add visible wrinkles and age lines on the face. "
            "The skin should be warm, weathered, with a slightly tanned complexion. "
            "Add a full well-groomed gray-white beard and mustache to the face oval. "
            "Make the eyebrows thick and gray. Make the eyes look wise and deep-set with "
            "crow's feet wrinkles. The mouth shapes should look natural and realistic, not anime. "
            "Add reading glasses with thin gold frames. "
            "CRITICAL: Keep every element in EXACTLY the same pixel position and size. "
            "Only change the art style and add age/beard details. The transparent/white "
            "background areas must remain exactly as they are. "
            "Do NOT move, resize, or rearrange any parts."
        ),
    },
    "hair": {
        "box": (530, 0, 1024, 500),
        "prompt": (
            "Transform this anime-style hair into realistic semi-realistic oil painting style hair "
            "for a distinguished elderly professor. Change the hair color from brown to "
            "silver-gray with some white streaks. Make the hair texture more realistic — "
            "individual strands visible, slightly wavy, professorial style (neat but slightly "
            "tousled, like an academic). Thicken the hair slightly. "
            "CRITICAL: Keep every hair piece in EXACTLY the same pixel position and size. "
            "Only change the color and art style. Transparent/white areas must stay the same. "
            "Do NOT move, resize, or rearrange any parts."
        ),
    },
    "suit_torso": {
        "box": (0, 700, 620, 1000),
        "prompt": (
            "Transform this anime-style suit jacket into a realistic semi-realistic oil painting "
            "style tweed professor's jacket. Change the dark blue suit to a warm brown/charcoal "
            "tweed pattern with leather elbow patches (if visible). Keep the tie but make it "
            "a burgundy/maroon academic tie. The white shirt stays but should look more textured "
            "and realistic, slightly rumpled like a real professor's. "
            "CRITICAL: Keep every clothing piece in EXACTLY the same pixel position and size. "
            "Only change the art style, colors, and texture. Transparent/white areas must stay the same. "
            "Do NOT move, resize, or rearrange any parts."
        ),
    },
    "suit_parts": {
        "box": (620, 700, 1024, 1000),
        "prompt": (
            "Transform these anime-style clothing parts (sleeves, pants, accessories) into "
            "realistic semi-realistic oil painting style. Change the dark blue to warm brown/charcoal "
            "tweed to match a professor's jacket. The pants should be dark charcoal wool. "
            "Make all fabric textures realistic with visible weave. "
            "CRITICAL: Keep every piece in EXACTLY the same pixel position and size. "
            "Only change the art style. Transparent/white areas must stay the same. "
            "Do NOT move, resize, or rearrange any parts."
        ),
    },
}

# ── Restyle function ──────────────────────────────────────────────

def restyle_region(
    client: genai.Client,
    atlas: Image.Image,
    region_name: str,
    box: tuple[int, int, int, int],
    prompt: str,
) -> Image.Image:
    """Crop a region, send to Gemini for restyling, return the restyled crop."""

    x, y, w, h = box
    crop = atlas.crop((x, y, x + w, y + h))

    # Save temp crop for debugging
    crop_path = OUTPUT_DIR / f"_debug_{region_name}_original.png"
    crop.save(crop_path)
    print(f"  [{region_name}] Cropped {w}x{h} from ({x},{y})", flush=True)

    # Send to Gemini for restyling with retry on rate limit
    for attempt in range(MAX_RETRIES):
        try:
            print(f"  [{region_name}] Sending to {MODEL} (attempt {attempt + 1})...", flush=True)
            response = client.models.generate_content(
                model=MODEL,
                contents=[prompt, crop],
                config=types.GenerateContentConfig(
                    response_modalities=["IMAGE", "TEXT"],
                ),
            )

            # Extract the image from response
            for part in response.parts:
                if part.inline_data is not None:
                    result = part.as_image()
                    # Resize back to exact crop dimensions (Gemini may change size)
                    if result.size != (w, h):
                        print(f"  [{region_name}] Resizing {result.size} -> ({w},{h})")
                        result = result.resize((w, h), Image.LANCZOS)
                    # Save debug
                    result.save(OUTPUT_DIR / f"_debug_{region_name}_restyled.png")
                    print(f"  [{region_name}] Done!")
                    return result

            raise RuntimeError(f"No image in response for '{region_name}'")

        except Exception as e:
            if "429" in str(e) or "RESOURCE_EXHAUSTED" in str(e):
                wait = RETRY_DELAY * (attempt + 1)
                print(f"  [{region_name}] Rate limited. Waiting {wait}s...")
                time.sleep(wait)
            else:
                raise

    raise RuntimeError(f"Max retries exceeded for region '{region_name}'")


# ── Main ──────────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("Live2D Texture Restyler - Anime to Old Professor")
    print("=" * 60)

    # Load atlas
    atlas = Image.open(TEXTURE_PATH).convert("RGBA")
    print(f"Loaded texture: {atlas.size}")

    # Backup original
    backup_path = OUTPUT_DIR / "texture_00_original_backup.png"
    if not backup_path.exists():
        atlas.save(backup_path)
        print(f"Backed up original to {backup_path.name}")

    # Init Gemini client (AI Studio, not Vertex)
    client = genai.Client(api_key=API_KEY)
    print(f"Using model: {MODEL}", flush=True)

    # Create output atlas (copy of original)
    output = atlas.copy()

    # Process each region sequentially with delays between
    region_items = list(REGIONS.items())
    for i, (name, region) in enumerate(region_items):
        print(f"\nProcessing: {name} ({i+1}/{len(region_items)})")
        try:
            restyled = restyle_region(
                client, atlas, name, region["box"], region["prompt"]
            )
            x, y, w, h = region["box"]
            output.paste(restyled, (x, y))
            # Delay between regions to avoid rate limits
            if i < len(region_items) - 1:
                print("  Waiting 15s before next region...")
                time.sleep(15)
        except Exception as e:
            print(f"  [{name}] FAILED after all retries: {e}")
            print(f"  [{name}] Keeping original region")

    # Save result
    output_path = OUTPUT_DIR / "texture_00.png"
    output.save(output_path)
    print(f"\n{'=' * 60}")
    print(f"Saved restyled texture to: {output_path}")
    print(f"Original backed up at: {backup_path.name}")
    print(f"Debug crops saved as _debug_*.png")
    print(f"{'=' * 60}")


if __name__ == "__main__":
    main()
