#!/usr/bin/env bash
# Makes the website's screenshots: WebP copies of the Demo-mode images in
# docs/images, a fraction of the PNGs' size. Run it after re-capturing
# those screenshots, and commit what it writes to website/images/.
# Needs cwebp (brew install webp).
set -euo pipefail
cd "$(dirname "$0")/.."

out=website/images
rm -rf "$out/cards" "$out/full" "$out"/*.webp
mkdir -p "$out/cards" "$out/full"

webp() { # <source png> <destination webp> [extra cwebp arguments]
  local src=$1 dst=$2
  shift 2
  cwebp -quiet -q 82 "$@" "$src" -o "$dst"
}

# Full size (the hero and the two spotlight sections):
# name in docs/images (without -dark/-light.png) -> name on the site
for pair in "hero:hero" "features/write-with-ai:write-with-ai" "features/screensaver:inbox-zero"; do
  for theme in dark light; do
    webp "docs/images/${pair%%:*}-$theme.png" "$out/${pair##*:}-$theme.webp"
  done
done

# Feature cards, one per section of docs/FEATURES.md (write-with-ai and
# screensaver have the full-size spotlight sections above instead): half size for the card,
# and full size (cards/ -> full/) for the zoomed view a click opens.
for name in rules vacation signatures invitation conversation ai-apps ai \
  toybox screensaver-settings \
  inbox codes search palette list shortcuts keyboard appearance; do
  for theme in dark light; do
    webp "docs/images/features/$name-$theme.png" "$out/cards/$name-$theme.webp" -resize 800 0
    webp "docs/images/features/$name-$theme.png" "$out/full/$name-$theme.webp"
  done
done

du -sh "$out"
