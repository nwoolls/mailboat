/**
 * Small things to play with over an empty list (Settings → Toybox),
 * tried after researching empty states (Milestone 8): calm, optional,
 * never in the way of the icon and words.
 */
export type ToyId = "none" | "ripples" | "bubbles" | "sky";

export const TOYS: readonly { id: ToyId; label: string; description: string }[] = [
  { id: "none", label: "None", description: "Just the icon and words." },
  {
    id: "ripples",
    label: "Pond",
    description: "Click the empty view and rings spread out, like a stone dropped in still water.",
  },
  {
    id: "bubbles",
    label: "Bubble wrap",
    description: "A sheet of bubbles to pop, one click each. Pop them all and a fresh sheet comes.",
  },
  {
    id: "sky",
    label: "Sky",
    description:
      "A quiet sky behind the view that follows the time of day: dawn, noon, dusk and night, with the sun or moon on its way across.",
  },
];

export const TOY_PREFS_KEY = "mailboat.emptyToy";

/** The saved toy, or none. */
export function parseToy(raw: string | null): ToyId {
  let saved: unknown = null;
  try {
    saved = raw ? JSON.parse(raw) : null;
  } catch {
    // Fall through to none.
  }
  return TOYS.find((t) => t.id === saved)?.id ?? "none";
}
