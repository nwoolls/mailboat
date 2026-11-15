import type { Label, LabelId } from "../../../platform/tauri/bindings";

/** At most this many label chips on a row; the rest are counted ("+2"). */
export const ROW_LABELS_MAX = 2;

/**
 * The label chips on a conversation's row (owner, 2026-11-14): its own user
 * labels set to show on conversations (Gmail's "Show in message list"),
 * leaving out the label being viewed, whose rows all have it. At most
 * `ROW_LABELS_MAX`, in name order, then how many more there are.
 */
export function rowLabels(
  labelIds: LabelId[],
  byId: ReadonlyMap<LabelId, Label>,
  viewing: LabelId | null,
): { shown: Label[]; more: number } {
  const all = labelIds
    .filter((id) => id !== viewing)
    .map((id) => byId.get(id))
    .filter((l): l is Label => l !== undefined && l.onConversations)
    .toSorted((a, b) => a.name.localeCompare(b.name));
  return { shown: all.slice(0, ROW_LABELS_MAX), more: Math.max(0, all.length - ROW_LABELS_MAX) };
}
