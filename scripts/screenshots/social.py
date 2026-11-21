"""Puts a new dark main picture into GitHub's social preview.

The preview (docs/images/social-preview.png, 1280x640) is the app icon, the
name, the tagline and "Free and open source · macOS and Windows" on a dark
background, with the dark main picture (hero-dark.png) as a card at the
right edge. That left half was laid out by hand once and doesn't change, so
this keeps it and pastes the new main picture where the old one was: at
640,96, scaled to 0.665, with a rounded top-left corner. (Measured from the
first preview by fitting the old main picture onto it.)

usage: python3 social.py <hero-dark.png> <social-preview.png>
The preview is changed in place; the owner uploads it in the repository's
settings (Social preview).
"""
import sys

from PIL import Image, ImageDraw

SCALE = 0.665
AT = (640, 96)
RADIUS = 20

hero_path, preview_path = sys.argv[1], sys.argv[2]
preview = Image.open(preview_path).convert("RGB")
hero = Image.open(hero_path).convert("RGB")
hero = hero.resize((round(hero.width * SCALE), round(hero.height * SCALE)), Image.LANCZOS)

# The card's rounded corner, drawn at 4x and scaled down for a smooth edge.
big = Image.new("L", (hero.width * 4, hero.height * 4), 0)
ImageDraw.Draw(big).rounded_rectangle((0, 0, big.width - 1, big.height - 1), RADIUS * 4, fill=255)
mask = big.resize(hero.size, Image.LANCZOS)

preview.paste(hero, AT, mask)
preview.save(preview_path, optimize=True)
print(f"updated {preview_path}")
