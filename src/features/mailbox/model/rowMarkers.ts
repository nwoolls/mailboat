/**
 * How a row in a multi-account view shows its account and unread state.
 * Temporary: the owner is trying these side by side; the losers go once
 * one is picked.
 * - `bar`: account as a coloured bar at the row's left edge, unread dot kept
 * - `noDot`: no unread dot (unread rows are bold), account dot kept
 * - `avatar`: account as its tiny profile picture, unread dot kept
 */
export type RowMarkers = "bar" | "noDot" | "avatar";

export const ROW_MARKER_OPTIONS: { value: RowMarkers; label: string }[] = [
  { value: "bar", label: "Bar" },
  { value: "noDot", label: "No dot" },
  { value: "avatar", label: "Avatar" },
];

export const ROW_MARKERS_STORAGE_KEY = "mailboat.rowMarkers";

/** The saved choice, or `bar` if nothing (or something unknown) is saved. */
export function parseRowMarkers(saved: string | null): RowMarkers {
  return ROW_MARKER_OPTIONS.some((o) => o.value === saved) ? (saved as RowMarkers) : "bar";
}
