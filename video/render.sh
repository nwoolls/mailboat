#!/bin/bash
# Renders the clips and puts their copies where they're used:
#   video/out/                      the masters (1920x1080, 60 fps; ignored by git)
#   website/video/                  the Swipes card's clip, per theme: a 1280px MP4
#   website/images/                 and its still (WebP), for before it plays
#   docs/images/loops/              the dark clip for FEATURES.md: MP4 and GIF
# Needs ffmpeg and cwebp (brew install ffmpeg webp), Python 3 with Pillow, and
# the Xcode command line tools (the light backdrop is a frame of macOS's own
# Sonoma wallpaper, made here and never committed, as for the screenshots).
# usage: video/render.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/.." && pwd)"
cd "$here"

# The light backdrop and the blurred copies the window stands on.
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

mkdir -p out "$repo/website/video" "$repo/docs/images/loops"
for theme in dark light; do
  id=SwipeArchive; [ "$theme" = light ] && id=SwipeArchiveLight
  bunx remotionb render src/index.ts "$id" "out/swipe-archive-$theme.mp4"
  # The website's copy: 1280 wide, no sound, quick to start.
  ffmpeg -y -loglevel error -i "out/swipe-archive-$theme.mp4" -an -vf "scale=1280:-2:flags=lanczos" \
    -c:v libx264 -preset slow -crf 26 -pix_fmt yuv420p -movflags +faststart \
    "$repo/website/video/swipe-archive-$theme.mp4"
  # Its still: the shapes just apart, the button showing.
  ffmpeg -y -loglevel error -ss 6.8 -i "out/swipe-archive-$theme.mp4" -frames:v 1 -vf "scale=1280:-2:flags=lanczos" out/still-$theme.png
  cwebp -quiet -q 82 out/still-$theme.png -o "$repo/website/images/swipe-archive-$theme.webp"
done

# FEATURES.md: the dark clip, as the other loops are.
cp out/swipe-archive-dark.mp4 "$repo/docs/images/loops/swipe-archive-closeup.mp4"
ffmpeg -y -loglevel error -i out/swipe-archive-dark.mp4 -an \
  -vf "fps=15,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=4" \
  -loop 0 "$repo/docs/images/loops/swipe-archive-closeup.gif"
ls -la "$repo/website/video" "$repo/docs/images/loops"/swipe-archive-closeup.*
