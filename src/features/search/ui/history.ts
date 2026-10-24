import { localStore } from "../../../shared/lib/localStore";
import { HISTORY_KEY, parseHistory, remember } from "../model/history";

/** Recent searches, shared by the window. */
export const searchHistory = localStore(HISTORY_KEY, parseHistory);

/** Saves a search that was used (Return, or a conversation opened from it). */
export function rememberSearch(text: string) {
  const next = remember(searchHistory.get(), text);
  if (next !== searchHistory.get()) searchHistory.set(next);
}
