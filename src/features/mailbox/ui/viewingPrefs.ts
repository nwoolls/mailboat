import { localStore } from "../../../shared/lib/localStore";
import { parseViewingPrefs, VIEWING_PREFS_KEY } from "../model/viewingPrefs";

/** Settings → Viewing, shared by the window. */
export const viewingPrefs = localStore(VIEWING_PREFS_KEY, parseViewingPrefs);
