import { localStore } from "../../../shared/lib/localStore";
import { COMPOSING_PREFS_KEY, parseComposingPrefs } from "../model/composingPrefs";

/** Settings → Composing, shared by the window. */
export const composingPrefs = localStore(COMPOSING_PREFS_KEY, parseComposingPrefs);
