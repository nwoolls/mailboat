import { localStore } from "../../../shared/lib/localStore";
import { parseToy, TOY_PREFS_KEY } from "../model/toys";

/** Which toy the empty view has; window-only, like the Toybox switches. */
export const emptyToy = localStore(TOY_PREFS_KEY, parseToy);
