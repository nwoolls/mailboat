import { accelMatches, IS_MAC } from "../../../shared/lib/platform";

/** Pane widths in CSS pixels. The sidebar keeps its width when the window resizes. */
export const SIDEBAR_WIDTH = { initial: 224, min: 180, max: 360 };
export const LIST_WIDTH = { min: 260 };
/**
 * The list's width as a share of the space right of the sidebar, so the
 * list and reader grow and shrink together when the window resizes.
 * About 380px of a typical window by default.
 */
export const LIST_SHARE = { initial: 0.36, min: 0.1, max: 0.9 };
/** The reader can shrink to a narrow right-hand panel, but no further. */
export const READER_MIN_WIDTH = 300;
/** The gap between panes, which is also the splitter's grab strip. */
export const SPLITTER_WIDTH = 8;
/** How far one arrow-key press moves a focused splitter. */
export const KEYBOARD_STEP = 16;

export function clampWidth(width: number, min: number, max: number): number {
  return Math.round(Math.min(Math.max(width, min), Math.max(min, max)));
}

/** Widest the list may get, leaving the splitter and reader their room. */
export function listMaxWidth(panesWidth: number): number {
  return Math.max(LIST_WIDTH.min, panesWidth - SPLITTER_WIDTH - READER_MIN_WIDTH);
}

/** The share of the panes' width a list of `listWidth` pixels takes, within its limits. */
export function listShareFor(listWidth: number, panesWidth: number): number {
  if (!(panesWidth > 0)) return LIST_SHARE.initial;
  const width = clampWidth(listWidth, LIST_WIDTH.min, listMaxWidth(panesWidth));
  return Math.min(LIST_SHARE.max, Math.max(LIST_SHARE.min, width / panesWidth));
}

/** Splitter positions remembered between launches. */
export type SavedLayout = { sidebarWidth: number; listShare: number };
export const DEFAULT_LAYOUT: SavedLayout = {
  sidebarWidth: SIDEBAR_WIDTH.initial,
  listShare: LIST_SHARE.initial,
};
export const LAYOUT_STORAGE_KEY = "prefs.layout";

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** A saved layout, each value kept in bounds; anything unreadable falls back to the default. */
export function parseLayout(saved: string | null): SavedLayout {
  let raw: unknown;
  try {
    raw = saved ? JSON.parse(saved) : null;
  } catch {
    raw = null;
  }
  const value = (raw ?? {}) as Partial<Record<keyof SavedLayout, unknown>>;
  const sidebar = num(value.sidebarWidth);
  const share = num(value.listShare);
  return {
    sidebarWidth:
      sidebar === null
        ? DEFAULT_LAYOUT.sidebarWidth
        : clampWidth(sidebar, SIDEBAR_WIDTH.min, SIDEBAR_WIDTH.max),
    listShare:
      share === null
        ? DEFAULT_LAYOUT.listShare
        : Math.min(LIST_SHARE.max, Math.max(LIST_SHARE.min, share)),
  };
}

/** The panels either side of the list that can be hidden. */
export type SidePanel = "sidebar" | "reader";

/**
 * ⌃⌘S toggles the sidebar (the macOS "Show Sidebar" key in Finder, Mail and
 * Notes); ⌃⌘R toggles the reader. Ctrl+Alt+S and Ctrl+Alt+R on Windows.
 * Matched on the physical key so other keyboard layouts still work.
 */
export function panelToggleFor(
  e: Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
  mac = IS_MAC,
): SidePanel | null {
  if (accelMatches(e, "Ctrl+Cmd+S", mac)) return "sidebar";
  if (accelMatches(e, "Ctrl+Cmd+R", mac)) return "reader";
  return null;
}

/**
 * Which panels are shown and which sidebar folds are open (or, for folds
 * that start open, closed), remembered between launches like the widths.
 */
export type SavedPanels = { sidebarOpen: boolean; readerOpen: boolean; folds: string[] };
export const DEFAULT_PANELS: SavedPanels = { sidebarOpen: true, readerOpen: true, folds: [] };
export const PANELS_STORAGE_KEY = "prefs.panels";

const flag = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);

/** Saved panels; anything missing or unreadable is the default. */
export function parsePanels(saved: string | null): SavedPanels {
  let raw: unknown;
  try {
    raw = saved ? JSON.parse(saved) : null;
  } catch {
    raw = null;
  }
  const value = (raw ?? {}) as Partial<Record<keyof SavedPanels, unknown>>;
  return {
    sidebarOpen: flag(value.sidebarOpen, DEFAULT_PANELS.sidebarOpen),
    readerOpen: flag(value.readerOpen, DEFAULT_PANELS.readerOpen),
    folds: Array.isArray(value.folds)
      ? [...new Set(value.folds.filter((f): f is string => typeof f === "string"))]
      : [],
  };
}

/** The folds with `key` flipped open or closed. */
export function toggledFold(folds: string[], key: string): string[] {
  return folds.includes(key) ? folds.filter((f) => f !== key) : [...folds, key];
}
