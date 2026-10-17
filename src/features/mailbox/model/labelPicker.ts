import type { Label } from "../../../platform/tauri/bindings";
import { labelPath } from "../../accounts/model/labelTree";

/** How a label reads in the picker: its sidebar path, "Acme / Review". */
export function pickerName(label: Pick<Label, "name">): string {
  return labelPath(label.name).join(" / ") || label.name;
}

/**
 * The labels the picker lists for what's typed: every word must appear
 * (in any order, any case), sorted by name.
 */
export function filterLabels(labels: Label[], text: string): Label[] {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  return labels
    .filter((l) => {
      const name = pickerName(l).toLowerCase();
      return words.every((w) => name.includes(w));
    })
    .toSorted((a, b) => pickerName(a).localeCompare(pickerName(b)));
}

/**
 * The name a new label would get from what's typed, or null when there's
 * nothing typed or a label of that name exists already (any case).
 */
export function newLabelName(labels: Pick<Label, "name">[], text: string): string | null {
  const name = text
    .split("/")
    .map((part) => part.trim())
    .join("/")
    .trim();
  if (!name || name.split("/").some((part) => !part)) return null;
  const taken = labels.some((l) => l.name.toLowerCase() === name.toLowerCase());
  return taken ? null : name;
}
