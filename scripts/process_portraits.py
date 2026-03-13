"""
Post-process portrait images for the Living Portrait system.

1. Crop bottom to remove Gemini watermark star
2. Create pixel-difference overlays for mouth and eyes
   (only changed pixels remain, rest becomes transparent)
3. Resize to 512x512 for optimal loading

This ensures pixel-perfect blending — when the mouth overlay is drawn
at varying alpha, only the actual mouth pixels change. No ghosting.
"""

from pathlib import Path
from PIL import Image
import numpy as np

INPUT_DIR = Path(__file__).parent.parent / "frontend" / "public" / "portraits"
ERAS = ["default", "ancient", "modern"]
CROP_BOTTOM = 60   # pixels to crop from bottom (removes star watermark)
CROP_TOP = 40      # pixels to crop from top (tighter framing)
CROP_SIDES = 30    # pixels to crop from each side
OUTPUT_SIZE = 512
# Pixel difference threshold — below this, pixels are considered identical
DIFF_THRESHOLD = 25


def create_difference_overlay(base: Image.Image, variant: Image.Image, threshold: int = DIFF_THRESHOLD) -> Image.Image:
    """
    Create an overlay image that only contains pixels where base and variant differ.
    Identical pixels become fully transparent.
    """
    base_arr = np.array(base).astype(np.int16)
    var_arr = np.array(variant).astype(np.int16)

    # Compute per-pixel color difference (max across RGB channels)
    diff = np.abs(base_arr[:, :, :3] - var_arr[:, :, :3]).max(axis=2)

    # Create overlay: variant pixels where difference exceeds threshold, transparent elsewhere
    overlay = np.array(variant).copy()
    mask = diff <= threshold
    overlay[mask, 3] = 0  # Make identical pixels transparent

    return Image.fromarray(overlay)


def process_era(era: str) -> None:
    era_dir = INPUT_DIR / era
    base_path = era_dir / "base.png"
    mouth_path = era_dir / "mouth.png"
    eyes_path = era_dir / "eyes.png"

    if not base_path.exists():
        print(f"  [{era}] No base.png found, skipping")
        return

    # Load originals
    base_orig = Image.open(base_path).convert("RGBA")
    mouth_orig = Image.open(mouth_path).convert("RGBA") if mouth_path.exists() else None
    eyes_orig = Image.open(eyes_path).convert("RGBA") if eyes_path.exists() else None

    w, h = base_orig.size
    print(f"  [{era}] Original size: {w}x{h}")

    # Crop box: remove watermark from bottom, tighten framing
    crop_box = (CROP_SIDES, CROP_TOP, w - CROP_SIDES, h - CROP_BOTTOM)
    print(f"  [{era}] Crop box: {crop_box}")

    base_cropped = base_orig.crop(crop_box).resize((OUTPUT_SIZE, OUTPUT_SIZE), Image.LANCZOS)

    if mouth_orig:
        mouth_cropped = mouth_orig.crop(crop_box).resize((OUTPUT_SIZE, OUTPUT_SIZE), Image.LANCZOS)
        mouth_overlay = create_difference_overlay(base_cropped, mouth_cropped)
        # Count how many pixels differ
        mouth_arr = np.array(mouth_overlay)
        n_diff = (mouth_arr[:, :, 3] > 0).sum()
        total = OUTPUT_SIZE * OUTPUT_SIZE
        print(f"  [{era}] Mouth overlay: {n_diff}/{total} pixels differ ({n_diff/total*100:.1f}%)")
    else:
        mouth_overlay = None

    if eyes_orig:
        eyes_cropped = eyes_orig.crop(crop_box).resize((OUTPUT_SIZE, OUTPUT_SIZE), Image.LANCZOS)
        eyes_overlay = create_difference_overlay(base_cropped, eyes_cropped)
        eyes_arr = np.array(eyes_overlay)
        n_diff = (eyes_arr[:, :, 3] > 0).sum()
        total = OUTPUT_SIZE * OUTPUT_SIZE
        print(f"  [{era}] Eyes overlay: {n_diff}/{total} pixels differ ({n_diff/total*100:.1f}%)")
    else:
        eyes_overlay = None

    # Save processed images (overwrite originals)
    base_cropped.save(base_path, optimize=True)
    print(f"  [{era}] Saved base.png ({base_path.stat().st_size // 1024}KB)")

    if mouth_overlay:
        mouth_overlay.save(mouth_path, optimize=True)
        print(f"  [{era}] Saved mouth.png ({mouth_path.stat().st_size // 1024}KB)")

    if eyes_overlay:
        eyes_overlay.save(eyes_path, optimize=True)
        print(f"  [{era}] Saved eyes.png ({eyes_path.stat().st_size // 1024}KB)")


def main():
    print("=" * 60)
    print("Portrait Post-Processor")
    print("=" * 60)

    for era in ERAS:
        print(f"\nProcessing: {era}")
        process_era(era)

    print(f"\n{'=' * 60}")
    print("Done! Portraits cropped, resized, and overlays created.")
    print(f"{'=' * 60}")


if __name__ == "__main__":
    main()
