/**
 * Small things to play with over an empty list (Settings → Toybox),
 * tried after researching empty states (Milestone 8): calm, optional,
 * never in the way of the icon and words.
 */
export type ToyId = "none" | "glow" | "ripples" | "bubbles" | "sky";

export const TOYS: readonly { id: ToyId; label: string; description: string }[] = [
  { id: "none", label: "None", description: "Just the icon and words." },
  {
    id: "glow",
    label: "Glow",
    description: "A soft glow drifts behind the empty view and follows the pointer.",
  },
  {
    id: "ripples",
    label: "Pond",
    description:
      "Move the pointer over the empty view and the water stirs faintly. Click and rings spread out, like a stone dropped in still water.",
  },
  {
    id: "bubbles",
    label: "Bubble wrap",
    description:
      "A sheet of bubbles to pop, one click each, or hold and drag across a row. Pop them all and a fresh sheet comes.",
  },
  {
    id: "sky",
    label: "Sky",
    description:
      "A quiet sky behind the view that follows the time of day: dawn, noon, dusk and night, with the sun or tonight's moon on its way across. Click for a shooting star, or a cloud by day.",
  },
];

export const TOY_PREFS_KEY = "prefs.emptyToy";

/** What an empty list has until another toy is chosen, as it had the glow before it was a toy. */
export const DEFAULT_TOY: ToyId = "glow";

/** The saved toy, or the default. */
export function parseToy(raw: string | null): ToyId {
  let saved: unknown = null;
  try {
    saved = raw ? JSON.parse(raw) : null;
  } catch {
    // Fall through to the default.
  }
  return TOYS.find((t) => t.id === saved)?.id ?? DEFAULT_TOY;
}

/**
 * The glow was a switch of its own (`emptyGlow` in the Toybox switches,
 * `prefs.featureFlags`) until it became a toy (owner, 2026-11-13). Given
 * the saved toy and switches as stored, what to store instead, or null
 * when there's nothing to move: a toy chosen stays; with none chosen, the
 * glow if it was on (or never turned off), else none. The switches are
 * stored again without `emptyGlow`, so this happens once.
 */
export function moveGlowSwitch(
  toyRaw: string | null,
  flagsRaw: string | null,
): { toy: ToyId; flags: string } | null {
  let flags: Record<string, unknown>;
  try {
    const parsed: unknown = flagsRaw ? JSON.parse(flagsRaw) : null;
    if (!parsed || typeof parsed !== "object" || !("emptyGlow" in parsed)) return null;
    flags = { ...(parsed as Record<string, unknown>) };
  } catch {
    return null;
  }
  const glowWasOn = flags.emptyGlow !== false;
  delete flags.emptyGlow;
  let saved: unknown = null;
  try {
    saved = toyRaw ? JSON.parse(toyRaw) : null;
  } catch {
    // As if none was chosen.
  }
  const chosen = TOYS.find((t) => t.id === saved && t.id !== "none")?.id;
  return { toy: chosen ?? (glowWasOn ? "glow" : "none"), flags: JSON.stringify(flags) };
}
