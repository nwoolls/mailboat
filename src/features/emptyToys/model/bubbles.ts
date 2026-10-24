/** A sheet of bubble wrap: bubbles on a staggered grid, some popped. */
export type Sheet = {
  /** Each bubble's centre, in px from the sheet's top left. */
  centres: { x: number; y: number }[];
  popped: boolean[];
  radius: number;
};

/** Bubble size and spacing, in px. */
export const BUBBLE_RADIUS = 11;
export const BUBBLE_PITCH = 30;
/** After the last pop, the fresh sheet comes this much later (ms). */
export const REFILL_MS = 900;

/** A full sheet for an area, rows offset by half a bubble as real wrap is. */
export function sheetFor(width: number, height: number, pitch = BUBBLE_PITCH): Sheet {
  const centres: { x: number; y: number }[] = [];
  const rowStep = pitch * 0.866;
  const rows = Math.max(0, Math.floor((height - pitch / 2) / rowStep));
  const cols = Math.max(0, Math.floor((width - pitch) / pitch));
  const left = (width - cols * pitch) / 2;
  const top = (height - (rows - 1) * rowStep) / 2;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      centres.push({ x: left + c * pitch + (r % 2 ? pitch / 2 : pitch / 4), y: top + r * rowStep });
  return { centres, popped: centres.map(() => false), radius: BUBBLE_RADIUS };
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
