# App icon

- `mailboat-icon.svg` is the current icon. Every size in `src-tauri/icons/`
  is generated from it with `bun tauri icon design/icon/mailboat-icon.svg`;
  delete the `android/` and `ios/` folders it creates (desktop only).
- `choices/` holds the icons the owner wants to offer in a future Settings
  icon picker: the folded-ribbon M (fold style S4) in 16 colours on a flat
  near-black tile, and the earlier glass icon (`glass-midnight.svg`). The
  current icon is `C13-green`.
- `sheets/` keeps each design round's comparison sheet (large) and Dock
  strip (real size, dark and light), in order:
  1. Glass variants (M-envelopes and rounded m's); A3 was picked
  2. Tweaks to A3; T2 (brighter, glowing M) was picked
  3. Backgrounds behind T2; B3 (midnight) was picked
  4. Flat, high-contrast tiles; F2 (black, sky M) was picked
  5. F2's M as a folded ribbon, in eight colours
  6. Six ways to shade the fold; S4 (even shading) was picked
  7. S4 in 16 colours; C13 (green) is the current icon
