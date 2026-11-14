import { localStore } from "../../../shared/lib/localStore";
import { parseStyle, TOYBOX_STYLE_KEY } from "../model/style";
import {
  GLOW_MOVED_KEY,
  LAST_TOY_KEY,
  moveGlowSwitch,
  parseLastToy,
  parseToy,
  TOY_PREFS_KEY,
} from "../model/toys";
import { FLAGS_STORAGE_KEY } from "../../../shared/lib/featureFlags";

// The glow's old switch becomes the toy it now is, once (`moveGlowSwitch`).
try {
  const moved = moveGlowSwitch(
    localStorage.getItem(TOY_PREFS_KEY),
    localStorage.getItem(FLAGS_STORAGE_KEY),
    localStorage.getItem(GLOW_MOVED_KEY) !== null,
  );
  if (moved) {
    localStorage.setItem(TOY_PREFS_KEY, JSON.stringify(moved.toy));
    localStorage.setItem(FLAGS_STORAGE_KEY, moved.flags);
    localStorage.setItem(GLOW_MOVED_KEY, "1");
  }
} catch {
  // Storage unavailable: the defaults apply.
}

/** Which toy the empty view has (the glow among them); window-only, like the Toybox switches. */
export const emptyToy = localStore(TOY_PREFS_KEY, parseToy);

/** The toy to bring back when the empty view's toy is switched on again. */
export const lastToy = localStore(LAST_TOY_KEY, parseLastToy);

/** Switches the empty view's toy off ("none"), or back on to the one it had. */
export function setToyOn(on: boolean) {
  const toy = emptyToy.get();
  if (on) {
    if (toy === "none") emptyToy.set(lastToy.get());
  } else if (toy !== "none") {
    lastToy.set(toy);
    emptyToy.set("none");
  }
}

/** Pixel art or ASCII art (the toys and the screensavers follow it). */
export const toyboxStyle = localStore(TOYBOX_STYLE_KEY, parseStyle);
