"""
Generate Living Portrait assets using Gemini image generation/editing.

For each era (default, ancient, modern):
  1. Generate a base portrait (mouth closed, eyes open) via Gemini
  2. Edit with Gemini to create mouth-open variant
  3. Edit with Gemini to create eyes-closed variant

Usage:
  set GOOGLE_API_KEY=your_key
  python scripts/generate_portraits.py
"""

import os
import sys
import time
from pathlib import Path
from google import genai
from google.genai import types
from PIL import Image

API_KEY = os.environ.get("GOOGLE_API_KEY", "")
MODEL = "gemini-2.5-flash-image"
OUTPUT_DIR = Path(__file__).parent.parent / "frontend" / "public" / "portraits"
SIZE = 512
MAX_RETRIES = 5
RETRY_DELAY = 20

# ── Era Prompts ──────────────────────────────────────────────

BASE_DESCRIPTION = (
    "A distinguished elderly professor historian in his late 60s. "
    "He has a full well-groomed gray-white beard, deep-set wise eyes with "
    "crow's feet wrinkles, thick gray eyebrows, and thin gold-framed reading glasses. "
    "Warm, weathered skin with a slightly tanned complexion. "
    "Oil painting style with warm museum lighting. "
    "Head and shoulders portrait, facing slightly left, looking at the viewer. "
    "Rich painterly brushstrokes, classical portrait composition. "
    "Dark warm background with subtle vignette. "
    "Square format, highly detailed."
)

ERAS = {
    "default": {
        "costume": "Wearing a warm brown tweed jacket with leather elbow patches, a crisp white shirt, and a burgundy bow tie.",
    },
    "ancient": {
        "costume": "Wearing a draped white Roman toga with a gold fibula clasp, a subtle laurel wreath resting on his gray hair. Weathered marble columns faintly visible in the background.",
    },
    "modern": {
        "costume": "Wearing a sharp dark charcoal suit with a subtle pinstripe, a navy silk tie, and modern wire-frame glasses. Clean, professional look with warm office lighting in the background.",
    },
}


def generate_image(client: genai.Client, prompt: str, era: str, variant: str, reference: Image.Image | None = None) -> Image.Image:
    """Generate or edit an image using Gemini."""
    for attempt in range(MAX_RETRIES):
        try:
            print(f"  [{era}/{variant}] {'Editing' if reference else 'Generating'} (attempt {attempt + 1})...", flush=True)

            contents = [prompt]
            if reference:
                contents = [prompt, reference]

            response = client.models.generate_content(
                model=MODEL,
                contents=contents,
                config=types.GenerateContentConfig(
                    response_modalities=["IMAGE", "TEXT"],
                ),
            )

            for part in response.parts:
                if part.inline_data is not None:
                    result = part.as_image()
                    if result.size != (SIZE, SIZE):
                        result = result.resize((SIZE, SIZE), Image.LANCZOS)
                    print(f"  [{era}/{variant}] Done!", flush=True)
                    return result

            raise RuntimeError("No image in response")

        except Exception as e:
            if "429" in str(e) or "RESOURCE_EXHAUSTED" in str(e):
                wait = RETRY_DELAY * (attempt + 1)
                print(f"  [{era}/{variant}] Rate limited, waiting {wait}s...", flush=True)
                time.sleep(wait)
            else:
                print(f"  [{era}/{variant}] Error: {e}", flush=True)
                if attempt < MAX_RETRIES - 1:
                    time.sleep(RETRY_DELAY)
                else:
                    raise

    raise RuntimeError(f"Max retries for {era}/{variant}")


def main():
    if not API_KEY:
        print("ERROR: Set GOOGLE_API_KEY environment variable")
        sys.exit(1)

    print("=" * 60)
    print("Living Portrait Generator")
    print("=" * 60)

    client = genai.Client(api_key=API_KEY)

    for era, config in ERAS.items():
        era_dir = OUTPUT_DIR / era
        era_dir.mkdir(parents=True, exist_ok=True)

        print(f"\n--- Era: {era} ---", flush=True)

        # Step 1: Generate base
        base_path = era_dir / "base.png"
        if base_path.exists() and base_path.stat().st_size > 10000:
            print(f"  [{era}/base] Already exists, skipping", flush=True)
            base = Image.open(base_path).convert("RGBA")
        else:
            base_prompt = (
                f"Generate an image: {BASE_DESCRIPTION} {config['costume']} "
                "His mouth is relaxed and gently closed. His eyes are open and alert."
            )
            base = generate_image(client, base_prompt, era, "base")
            base.save(base_path)
            print(f"  Saved to {base_path}", flush=True)
            time.sleep(8)

        # Step 2: Mouth-open variant via editing
        mouth_path = era_dir / "mouth.png"
        if mouth_path.exists() and mouth_path.stat().st_size > 10000:
            print(f"  [{era}/mouth] Already exists, skipping", flush=True)
        else:
            mouth_prompt = (
                "Edit this portrait: open the man's mouth slightly as if he is speaking mid-sentence. "
                "His lips should be parted and you can see his teeth slightly. "
                "Keep EVERYTHING else pixel-identical: same face, same eyes (open), same clothing, "
                "same background, same lighting, same oil painting style. ONLY change the mouth."
            )
            mouth = generate_image(client, mouth_prompt, era, "mouth", reference=base)
            mouth.save(mouth_path)
            print(f"  Saved to {mouth_path}", flush=True)
            time.sleep(10)

        # Step 3: Eyes-closed variant via editing
        eyes_path = era_dir / "eyes.png"
        if eyes_path.exists() and eyes_path.stat().st_size > 10000:
            print(f"  [{era}/eyes] Already exists, skipping", flush=True)
        else:
            eyes_prompt = (
                "Edit this portrait: gently close the man's eyes as if he is mid-blink. "
                "His eyelids should be softly shut, relaxed. "
                "Keep EVERYTHING else pixel-identical: same face, same mouth (closed), same beard, "
                "same clothing, same background, same lighting, same oil painting style. ONLY change the eyes."
            )
            eyes = generate_image(client, eyes_prompt, era, "eyes", reference=base)
            eyes.save(eyes_path)
            print(f"  Saved to {eyes_path}", flush=True)
            time.sleep(10)

    print(f"\n{'=' * 60}")
    print("All portraits generated!")
    print(f"Output: {OUTPUT_DIR}")
    print(f"{'=' * 60}")


if __name__ == "__main__":
    main()
