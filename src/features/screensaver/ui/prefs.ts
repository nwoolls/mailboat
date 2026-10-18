import { localStore } from "../../../shared/lib/localStore";
import { parsePrefs, SCREENSAVER_PREFS_KEY } from "../model/catalog";

/** Which screensaver plays and its palette; window-only, like the flags. */
export const screensaverPrefs = localStore(SCREENSAVER_PREFS_KEY, parsePrefs);
