import type { Rect } from "../../screensaver/model/scene";

/** A sheet of bubble wrap: bubbles on a staggered grid, some popped. */
export type Sheet = {
  /** Each bubble's centre, in px from the sheet's top left. */
  centres: { x: number; y: number }[];
  popped: boolean[];
  radius: number;
  /** Each bubble's size and its film's wrinkles, a little different each (0 to 1). */
  quirks: number[];
};

/** Bubble size and spacing, in px. */
export const BUBBLE_RADIUS = 16.5;
export const BUBBLE_PITCH = 45;

/**
 * A full sheet for an area, rows offset by half a bubble as real wrap
 * is. Bubbles that would sit over anything in `keepClear` (the icon and
 * words) are left out, so the sheet frames them.
 */
export function sheetFor(
  width: number,
  height: number,
  keepClear: Rect[] = [],
  pitch = BUBBLE_PITCH,
): Sheet {
  const centres: { x: number; y: number }[] = [];
  const rowStep = pitch * 0.866;
  const rows = Math.max(0, Math.floor((height - pitch / 2) / rowStep));
  const cols = Math.max(0, Math.floor((width - pitch) / pitch));
  const left = (width - cols * pitch) / 2;
  const top = (height - (rows - 1) * rowStep) / 2;
  const gap = BUBBLE_RADIUS + 6;
  const clear = (x: number, y: number) =>
    !keepClear.some((r) => x > r.x0 - gap && x < r.x1 + gap && y > r.y0 - gap && y < r.y1 + gap);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const x = left + c * pitch + (r % 2 ? pitch / 2 : pitch / 4);
      const y = top + r * rowStep;
      if (clear(x, y)) centres.push({ x, y });
    }
  return {
    centres,
    popped: centres.map(() => false),
    radius: BUBBLE_RADIUS,
    // Steady per position, so a resize doesn't reshuffle them.
    quirks: centres.map((c) => hash(Math.round(c.x) * 7919 + Math.round(c.y) * 104729)),
  };
}

/**
 * A sheet for ASCII art: bubbles on the character grid (`cw` × `ch` px
 * cells), each 5 columns by 3 rows, rows offset by half a bubble, so every
 * bubble is drawn the same and none overlap. Centres are cell centres.
 */
export function gridSheetFor(
  width: number,
  height: number,
  keepClear: Rect[],
  cw: number,
  ch: number,
  ox: number,
  oy: number,
): Sheet {
  const centres: { x: number; y: number }[] = [];
  const across = 6;
  const down = 3;
  const cols = Math.floor((width - ox) / cw);
  const rows = Math.floor((height - oy) / ch);
  const gap = cw * 1.5;
  const clear = (x: number, y: number) =>
    !keepClear.some(
      (r) =>
        x > r.x0 - gap - cw * 2.5 &&
        x < r.x1 + gap + cw * 2.5 &&
        y > r.y0 - ch * 2 &&
        y < r.y1 + ch * 2,
    );
  for (let r = 1, line = 0; r < rows - 1; r += down, line++)
    for (let c = 2 + (line % 2 ? across / 2 : 0); c < cols - 2; c += across) {
      const x = ox + (c + 0.5) * cw;
      const y = oy + (r + 0.5) * ch;
      if (clear(x, y)) centres.push({ x, y });
    }
  return {
    centres,
    popped: centres.map(() => false),
    radius: cw * 2.5,
    quirks: centres.map((c) => hash(Math.round(c.x) * 7919 + Math.round(c.y) * 104729)),
  };
}

/** The unpopped bubble under a point, if any. */
export function bubbleAt(sheet: Sheet, x: number, y: number): number | null {
  const i = sheet.centres.findIndex(
    (c, n) => !sheet.popped[n] && (c.x - x) ** 2 + (c.y - y) ** 2 <= sheet.radius ** 2,
  );
  return i === -1 ? null : i;
}

/** The sheet with bubble `i` popped. */
export function pop(sheet: Sheet, i: number): Sheet {
  return { ...sheet, popped: sheet.popped.map((p, n) => p || n === i) };
}

export function allPopped(sheet: Sheet): boolean {
  return sheet.popped.length > 0 && sheet.popped.every(Boolean);
}

/** A steady pseudo-random number in [0, 1) for a seed. */
function hash(seed: number): number {
  const s = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
}
