/** Pane widths in CSS pixels. Not persisted yet (see docs/ROADMAP.md). */
export const SIDEBAR_WIDTH = { initial: 224, min: 180, max: 360 };
export const LIST_WIDTH = { initial: 380, min: 260 };
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
