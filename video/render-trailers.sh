#!/bin/bash
# Renders the trailers (TRAILERS.md) and puts their copies where they're used:
#   video/out/<name>.mp4             the masters (1920x1080, 60 fps; ignored by git)
#   website/video/<name>.mp4         1280 wide, with sound, quick to start
#   website/images/trailer.webp      the main trailer's still: its end card,
#                                    the poster before it plays and the picture
#                                    a shared link shows
# Needs the music and the takes (TRAILERS.md), ffmpeg and cwebp. About ten
# minutes per trailer. Watch each one before committing it.
# usage: video/render-trailers.sh [Trailer TrailerToybox TrailerGmail TrailerFast]
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/.." && pwd)"
cd "$here"

name_of() {
  case "$1" in
    Trailer) echo trailer ;;
    TrailerToybox) echo trailer-toybox ;;
    TrailerGmail) echo trailer-gmail ;;
    TrailerFast) echo trailer-fast ;;
    *) echo "unknown trailer: $1" >&2; exit 1 ;;
  esac
}

ids=("$@")
[ ${#ids[@]} -gt 0 ] || ids=(Trailer TrailerToybox TrailerGmail TrailerFast)
mkdir -p out "$repo/website/video" "$repo/website/images"
for id in "${ids[@]}"; do
  name="$(name_of "$id")"
  bunx remotionb render src/index.ts "$id" "out/$name.mp4"
  ffmpeg -y -loglevel error -i "out/$name.mp4" -vf "scale=1280:-2:flags=lanczos" \
    -c:v libx264 -preset slow -crf 24 -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart \
    "$repo/website/video/$name.mp4"
  if [ "$name" = trailer ]; then
    # The end card, fully drawn, before the fade.
    ffmpeg -y -loglevel error -ss 26 -i "out/$name.mp4" -frames:v 1 -vf "scale=1280:-2:flags=lanczos" out/trailer-still.png
    cwebp -quiet -q 82 out/trailer-still.png -o "$repo/website/images/trailer.webp"
  fi
done
ls -la "$repo/website/video"/trailer*.mp4 "$repo/website/images/trailer.webp"
