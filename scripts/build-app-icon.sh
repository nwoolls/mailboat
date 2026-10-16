#!/bin/sh
# Regenerates every app icon from design/icon/:
#   mailboat-icon.svg        -> src-tauri/icons/* (classic icons: Windows, older
#                            macOS, and the fallback inside the macOS app)
#   mailboat-icon-layer.svg  -> the artwork layer of src-tauri/macos/AppIcon.icon,
#                            compiled with Xcode's actool into
#                            src-tauri/macos/Assets.car (macOS 26+: the system
#                            draws the tile with its glass rim and depth)
# Needs Xcode (for actool). Run from the repository root: scripts/build-app-icon.sh
set -e
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

bun tauri icon design/icon/mailboat-icon.svg
rm -rf src-tauri/icons/android src-tauri/icons/ios

# Icon Composer ignores SVG filters, so render the layer (with its fold
# shadows) to a PNG first.
bun tauri icon design/icon/mailboat-icon-layer.svg -o "$tmp/layer" --png 1024 >/dev/null
cp "$tmp/layer/1024x1024.png" src-tauri/macos/AppIcon.icon/Assets/m.png

mkdir -p "$tmp/car"
xcrun actool src-tauri/macos/AppIcon.icon --compile "$tmp/car" \
  --app-icon AppIcon --enable-on-demand-resources NO --development-region en \
  --target-device mac --platform macosx --minimum-deployment-target 11.0 \
  --output-partial-info-plist "$tmp/partial.plist" >/dev/null
cp "$tmp/car/Assets.car" src-tauri/macos/Assets.car
echo "Icons regenerated; restart \`bun tauri dev\` to see them."
