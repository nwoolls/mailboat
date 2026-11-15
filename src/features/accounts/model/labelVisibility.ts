import type { Label } from "../../../platform/tauri/bindings";

/**
 * Which labels show with the others in the sidebar and which go in its
 * closed Hidden fold, as each label's Gmail setting says: Always shows,
 * "Only with unread mail" shows while it has some, Hidden never does.
 * Hidden ones stay one click away, where their menu can show them again.
 */
export function splitByVisibility(
  labels: Label[],
  unreadOf: (label: Label) => number,
): { shown: Label[]; hidden: Label[] } {
  const shown: Label[] = [];
  const hidden: Label[] = [];
  for (const label of labels) {
    const visible =
      label.sidebar === "show" || (label.sidebar === "showIfUnread" && unreadOf(label) > 0);
    (visible ? shown : hidden).push(label);
  }
  return { shown, hidden };
}
