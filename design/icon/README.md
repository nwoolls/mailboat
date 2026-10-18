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
  8. Round three (2026-10-17, not picked yet): the M as one ribbon folded
     over at its top corners, like an envelope's flap, so the folds and
     shadows sit left and right and the V is one unbroken piece. "Now" is
     today's icon for comparison. E1–E3 fold at 41°; E4 and E6 at 50°
     (a deeper flap); E5 keeps square stem tops with the flap laid over
     them. In E1, E2, E4 and E5 the flap folds over the front and shadows
     the stems; in E3 and E6 it tucks behind and the stems shadow it. The
     flap is darker (the ribbon's back) in all but E1. Sources are in
     `envelope/`
  9. The owner's steer on round 8: keep Now's square-tipped shape, fold
     the V over the front (as E1), and shade what's behind a little
     darker (as E3). The V is one piece, shadowing the sides only at the
     top corners. N1, N2: the V darker; N3, N4: the sides darker and the
     V bright. N1, N3 keep Now's arm ends (a square cut just inside each
     side); N2, N4 square them off to the sides' top corners. Sources in
     `envelope/`
  10. N4 was closest. The owner wants the overlapping parts to meet edge
     to edge at the top corners, like a real fold-over envelope (the
     ribbon needn't be straight if unfolded). The V's ends now share the
     sides' top and outer edges, so no side pokes out beside the fold.
     N5: the V as wide as the sides; N6: the V's end is exactly the top
     edge, so it's slimmer; N7: N5, steeper
