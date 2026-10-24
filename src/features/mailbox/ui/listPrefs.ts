import { localStore } from "../../../shared/lib/localStore";
import { LIST_PREFS_KEY, parseListPrefs } from "../model/listPrefs";

/** Settings → List, shared by the window. */
export const listPrefs = localStore(LIST_PREFS_KEY, parseListPrefs);
