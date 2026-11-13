import { localStore } from "../../../shared/lib/localStore";
import { parseStyle, TOYBOX_STYLE_KEY } from "../model/style";
import { moveGlowSwitch, parseToy, TOY_PREFS_KEY } from "../model/toys";
import { FLAGS_STORAGE_KEY } from "../../../shared/lib/featureFlags";

// The glow's old switch becomes the toy it now is, once (`moveGlowSwitch`).
try {
  const moved = moveGlowSwitch(
    localStorage.getItem(TOY_PREFS_KEY),
    localStorage.getItem(FLAGS_STORAGE_KEY),
  );
  if (moved) {
    localStorage.setItem(TOY_PREFS_KEY, JSON.stringify(moved.toy));
    localStorage.setItem(FLAGS_STORAGE_KEY, moved.flags);
  }
} catch {
  // Storage unavailable: the defaults apply.
}

/** Which toy the empty view has (the glow among them); window-only, like the Toybox switches. */
export const emptyToy = localStore(TOY_PREFS_KEY, parseToy);

/** Pixel art or ASCII art (so far the glow and the pond follow it). */
export const toyboxStyle = localStore(TOYBOX_STYLE_KEY, parseStyle);
