#!/bin/bash
# Copies the gallery pictures from $OUT/gallery/<theme>/ into
# docs/images/features/<name>-<theme>.png, each converted to the plain sRGB
# profile (no display-specific profile embedded). Look at every picture first:
# nothing from a real desktop or a real mailbox may go into the repository.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
OUT="${OUT:-/tmp/shots}"
profile="/System/Library/ColorSync/Profiles/sRGB Profile.icc"
dest="$repo/docs/images/features"
mkdir -p "$dest"
for theme in dark light; do
  for file in "$OUT/gallery/$theme"/*.png; do
    [ -e "$file" ] || continue
    name="$(basename "$file" .png)"
    cp "$file" "$dest/$name-$theme.png"
    sips --matchTo "$profile" "$dest/$name-$theme.png" >/dev/null
  done
done
python3 "$here/optimize.py" "$dest"   # lossless; every file is checked pixel for pixel

# Short loops, if any were recorded: the gif for a page, the mp4 for a post.
loops="$repo/docs/images/loops"
if ls "$OUT"/loops/*.mp4 >/dev/null 2>&1; then
  mkdir -p "$loops"
  cp "$OUT"/loops/*.gif "$OUT"/loops/*.mp4 "$loops/"
fi
echo "installed into $dest"
