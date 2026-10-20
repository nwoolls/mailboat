import { localStore } from "../../../shared/lib/localStore";
import { PANELS_STORAGE_KEY, parsePanels, toggledFold } from "../model/panes";

/** Shown panels and open sidebar folds, remembered between launches. */
export const panels = localStore(PANELS_STORAGE_KEY, parsePanels);

export function setSidebarOpen(open: boolean) {
  panels.set({ ...panels.get(), sidebarOpen: open });
}

export function setSavedReaderOpen(open: boolean) {
  panels.set({ ...panels.get(), readerOpen: open });
}

/** Opens or closes a sidebar fold. */
export function toggleFold(key: string) {
  const now = panels.get();
  panels.set({ ...now, folds: toggledFold(now.folds, key) });
}
