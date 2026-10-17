#!/bin/sh
# Renders each icon in design/icon/choices/ to a 512px PNG in
# src-tauri/icons/choices/, which Settings → Appearance → App icon puts on
# the Dock. (Tauri's renderer draws the SVG filters, i.e. the fold shadows.)
# Run from the repository root after changing a choice:
#   scripts/build-icon-choices.sh
set -e
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p src-tauri/icons/choices
for svg in design/icon/choices/*.svg; do
  name="$(basename "$svg" .svg)"
  bun tauri icon "$svg" -o "$tmp/$name" --png 512 >/dev/null
  cp "$tmp/$name/512x512.png" "src-tauri/icons/choices/$name.png"
done
echo "Rendered $(ls design/icon/choices/*.svg | wc -l | tr -d ' ') icon choices."
