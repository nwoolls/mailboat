#!/bin/bash
# The backdrops the clips and trailers stand on, in video/public/: the
# sunset (committed) and macOS's own Sonoma wallpaper (a frame of it, made
# here and never committed), each at 1920x1080 with a blurred copy.
# Needs the Xcode command line tools and Python 3 with Pillow.
# usage: video/backdrops.sh   (render.sh and render-trailers.sh run it)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/.." && pwd)"
cd "$here"
if [ ! -f public/sonoma.png ]; then
  tmp="$(mktemp -d)"
  swiftc -O -o "$tmp/frame" "$repo/scripts/screenshots/frame.swift"
  "$tmp/frame" "/System/Library/Desktop Pictures/.wallpapers/Sonoma/Sonoma Graphic Light Landscape.mov" public/sonoma.png 2
  rm -rf "$tmp"
fi
python3 - <<'PY'
from PIL import Image, ImageEnhance, ImageFilter
for name in ("sunset", "sonoma"):
    image = Image.open(f"public/{name}.png").convert("RGB").resize((1920, 1080))
    image.save(f"public/{name}.png", optimize=True)
    blurred = ImageEnhance.Color(image.filter(ImageFilter.GaussianBlur(70))).enhance(1.25)
    blurred.save(f"public/{name}-blur.png", optimize=True)
PY
