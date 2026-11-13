import { localStore } from "../../../shared/lib/localStore";
import { parseStyle, TOYBOX_STYLE_KEY } from "../model/style";
import { parseToy, TOY_PREFS_KEY } from "../model/toys";

/** Which toy the empty view has; window-only, like the Toybox switches. */
export const emptyToy = localStore(TOY_PREFS_KEY, parseToy);

/** Pixel art or ASCII art (so far only the glow follows it). */
export const toyboxStyle = localStore(TOYBOX_STYLE_KEY, parseStyle);
