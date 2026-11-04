#!/bin/bash
# Builds the capture helpers and the two wallpapers into $OUT (default
# /tmp/shots). Run once; needs the Xcode command line tools and bun.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
OUT="${OUT:-/tmp/shots}"
mkdir -p "$OUT/bin" "$OUT/bg"

for tool in backdrop windows mouse frame scroll drag swipe; do
  swiftc -O -o "$OUT/bin/$tool" "$here/$tool.swift"
done

# Dark: the sunset picture. Light: macOS's own Sonoma (a frame of its video).
(cd "$repo" && bun "$here/render.mjs" "$here/wallpapers/sunset.svg" "$OUT/bg/sunset.png")
"$OUT/bin/frame" "/System/Library/Desktop Pictures/.wallpapers/Sonoma/Sonoma Graphic Light Landscape.mov" "$OUT/bg/sonoma.png" 2 \
  || echo "no Sonoma wallpaper here: put any picture at $OUT/bg/sonoma.png"
echo "built in $OUT"
