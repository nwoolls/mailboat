# App icon

- `mailboat-icon.svg` is the current icon, tile included. The classic icons in
  `src-tauri/icons/` (Windows, older macOS, the fallback) come from it.
- `mailboat-icon-layer.svg` is the same M without the tile, on Icon Composer's
  1024px canvas. It is the artwork layer of `src-tauri/macos/AppIcon.icon`
  (whose fill is the tile colour), compiled to `src-tauri/macos/Assets.car`.
  On macOS 26+ the system draws that with its glass rim and depth.
- Change either, then run `scripts/build-app-icon.sh` (needs Xcode) to
  regenerate everything.
- `choices/` holds the icons offered in Settings → Appearance → App icon
  (run `scripts/build-icon-choices.sh` after changing one, to re-render the
  PNGs the Dock uses; the order Settings shows them in is set in
  `src-tauri/src/app_icon.rs`): the folded-ribbon M (fold style S4) in 16 colours on a flat
  near-black tile. The earlier glass icon (`glass-midnight.svg`, now in
  this folder) was offered too, until the owner dropped it as the odd one
  out (2026-10-17). The
  current icon is `C17-system-blue` (tried before: `C13-green`, `C04-cobalt`,
  `C03-sky`). C17 is Apple's system blue, added after the sheet: macOS renders
  it within a few points of Mail's icon blue.
- `sheets/` keeps each design round's comparison sheet (large) and Dock
  strip (real size, dark and light), in order:
  1. Glass variants (M-envelopes and rounded m's); A3 was picked
  2. Tweaks to A3; T2 (brighter, glowing M) was picked
  3. Backgrounds behind T2; B3 (midnight) was picked
  4. Flat, high-contrast tiles; F2 (black, sky M) was picked
  5. F2's M as a folded ribbon, in eight colours
  6. Six ways to shade the fold; S4 (even shading) was picked
  7. S4 in 16 colours; C13 (green) was picked, then C04 (cobalt), C03 (sky) and
     finally C17 (system blue, not on the sheet)
