"""
Generate placeholder portrait PNGs for the Living Portrait system.
These are simple colored rectangles with text — replace with real
Imagen 3 portraits before demo.
"""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

OUTPUT_DIR = Path(__file__).parent.parent / "frontend" / "public" / "portraits"

ERAS = {
    "default": {"bg": (60, 45, 30), "label": "Professor\n(Default)"},
    "ancient": {"bg": (70, 55, 35), "label": "Professor\n(Ancient)"},
    "modern": {"bg": (40, 40, 50), "label": "Professor\n(Modern)"},
}

SIZE = 512


def make_placeholder(era: str, variant: str, bg_color: tuple[int, int, int]) -> Image.Image:
    """Create a simple placeholder image."""
    img = Image.new("RGBA", (SIZE, SIZE), (*bg_color, 255))
    draw = ImageDraw.Draw(img)

    # Draw a circle for the "head"
    cx, cy = SIZE // 2, SIZE // 2 - 30
    r = 120
    draw.ellipse(
        [cx - r, cy - r, cx + r, cy + r],
        fill=(180, 150, 120, 255),
        outline=(200, 170, 140, 255),
        width=3,
    )

    # Draw "shoulders"
    draw.rectangle(
        [cx - 160, cy + r - 10, cx + 160, SIZE],
        fill=(100, 80, 60, 255),
    )

    if variant == "mouth":
        # Draw open mouth
        draw.ellipse(
            [cx - 20, cy + 30, cx + 20, cy + 55],
            fill=(120, 50, 50, 255),
        )
    elif variant == "eyes":
        # Draw closed eyes (lines instead of circles)
        draw.line([cx - 40, cy - 15, cx - 15, cy - 15], fill=(60, 40, 30, 255), width=3)
        draw.line([cx + 15, cy - 15, cx + 40, cy - 15], fill=(60, 40, 30, 255), width=3)
    else:
        # Draw open eyes
        draw.ellipse([cx - 40, cy - 25, cx - 15, cy - 5], fill=(60, 40, 30, 255))
        draw.ellipse([cx + 15, cy - 25, cx + 40, cy - 5], fill=(60, 40, 30, 255))

    # Label
    try:
        font = ImageFont.truetype("arial.ttf", 24)
    except OSError:
        font = ImageFont.load_default()
    draw.text(
        (SIZE // 2, SIZE - 40),
        f"{era} / {variant}",
        fill=(200, 180, 160, 255),
        anchor="mb",
        font=font,
    )

    return img


def main() -> None:
    for era, config in ERAS.items():
        era_dir = OUTPUT_DIR / era
        era_dir.mkdir(parents=True, exist_ok=True)

        for variant in ("base", "mouth", "eyes"):
            img = make_placeholder(era, variant, config["bg"])
            path = era_dir / f"{variant}.png"
            img.save(path)
            print(f"Created {path}")

    print("\nDone! Replace these with real Imagen 3 portraits.")


if __name__ == "__main__":
    main()
