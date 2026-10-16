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
export const LAYOUT_STORAGE_KEY = "mailboat.layout";

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
 * Notes); ⌃⌘R toggles the reader. Matched on the physical key so other
 * keyboard layouts still work.
 */
export function panelToggleFor(
  e: Pick<KeyboardEvent, "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
): SidePanel | null {
  if (!e.metaKey || !e.ctrlKey || e.altKey || e.shiftKey) return null;
  if (e.code === "KeyS") return "sidebar";
  if (e.code === "KeyR") return "reader";
  return null;
}
