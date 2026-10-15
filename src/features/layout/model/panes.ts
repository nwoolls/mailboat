/** Pane widths in CSS pixels. Not persisted yet (see docs/ROADMAP.md). */
export const SIDEBAR_WIDTH = { initial: 224, min: 180, max: 360 };
export const LIST_WIDTH = { initial: 380, min: 260 };
/** The reader can shrink to a narrow right-hand panel, but no further. */
export const READER_MIN_WIDTH = 300;
/** How far one arrow-key press moves a focused splitter. */
export const KEYBOARD_STEP = 16;

export function clampWidth(width: number, min: number, max: number): number {
  return Math.round(Math.min(Math.max(width, min), Math.max(min, max)));
}

/** Widest the list may get inside a panel, leaving the reader its minimum. */
export function listMaxWidth(panelWidth: number): number {
  return Math.max(LIST_WIDTH.min, panelWidth - READER_MIN_WIDTH);
}
