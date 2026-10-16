# App icon

- `mailboat-icon.svg` is the current icon, tile included. The classic icons in
  `src-tauri/icons/` (Windows, older macOS, the fallback) come from it.
- `mailboat-icon-layer.svg` is the same M without the tile, on Icon Composer's
  1024px canvas. It is the artwork layer of `src-tauri/macos/AppIcon.icon`
  (whose fill is the tile colour), compiled to `src-tauri/macos/Assets.car`.
  On macOS 26+ the system draws that with its glass rim and depth.
- Change either, then run `scripts/build-app-icon.sh` (needs Xcode) to
  regenerate everything.
- `choices/` holds the icons the owner wants to offer in a future Settings
  icon picker: the folded-ribbon M (fold style S4) in 16 colours on a flat
  near-black tile, and the earlier glass icon (`glass-midnight.svg`). The
  current icon is `C03-sky` (tried before: `C13-green`, `C04-cobalt`).
- `sheets/` keeps each design round's comparison sheet (large) and Dock
  strip (real size, dark and light), in order:
  1. Glass variants (M-envelopes and rounded m's); A3 was picked
  2. Tweaks to A3; T2 (brighter, glowing M) was picked
  3. Backgrounds behind T2; B3 (midnight) was picked
  4. Flat, high-contrast tiles; F2 (black, sky M) was picked
  5. F2's M as a folded ribbon, in eight colours
  6. Six ways to shade the fold; S4 (even shading) was picked
  7. S4 in 16 colours; C13 (green) was picked, then C04 (cobalt), then C03 (sky)
