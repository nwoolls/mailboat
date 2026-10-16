/**
 * How a row in a multi-account view shows its account and unread state.
 * Temporary: the owner is trying these side by side; the losers go once
 * one is picked. All keep the account mark quiet so the unread dot (solid
 * accent) stays the one thing that stands out.
 * - `glassBar`: account as a faint, glowing bar at the row's very edge
 * - `ring`: account as a hollow ring next to the sender; unread stays solid
 * - `glassDot`: account as a soft glassy dot; no unread dot (bold text only)
 */
export type RowMarkers = "glassBar" | "ring" | "glassDot";

export const ROW_MARKER_OPTIONS: { value: RowMarkers; label: string }[] = [
  { value: "glassBar", label: "Glass bar" },
  { value: "ring", label: "Ring" },
  { value: "glassDot", label: "Glass dot" },
];

export const ROW_MARKERS_STORAGE_KEY = "mailboat.rowMarkers";

/** The saved choice, or `glassBar` if nothing (or something unknown) is saved. */
export function parseRowMarkers(saved: string | null): RowMarkers {
  return ROW_MARKER_OPTIONS.some((o) => o.value === saved) ? (saved as RowMarkers) : "glassBar";
}

/** `color` at `percent` strength over whatever is behind it. */
export function tint(color: string, percent: number): string {
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`;
}
