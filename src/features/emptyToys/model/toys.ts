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
      "A sheet of bubbles to pop. Click one, or hold and drag across a row. Each pop bursts into confetti, quick pops in a row burst bigger, and when they're all popped a fresh sheet inflates.",
  },
  {
    id: "sky",
    label: "Sky",
    description:
      "Mountains and fields under a sky that follows the time of day: dawn, noon, dusk and night, with the sun or tonight's moon moving across it. Click for a shooting star at night, or a cloud by day.",
  },
];

export const TOY_PREFS_KEY = "prefs.emptyToy";

/**
 * The toy to bring back when "Something to play with" is switched on
 * again (Settings → Toybox): the one it had when switched off.
 */
export const LAST_TOY_KEY = "prefs.emptyToyLast";

/** The saved toy to bring back; never "none", the glow if there isn't one. */
export function parseLastToy(raw: string | null): ToyId {
  const toy = parseToy(raw);
  return toy === "none" ? DEFAULT_TOY : toy;
}

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

/** Set once the glow's old switch has been moved into the toy (`moveGlowSwitch`). */
export const GLOW_MOVED_KEY = "prefs.glowMoved";

/**
 * The glow was a switch of its own (`emptyGlow` in the Toybox switches,
 * `prefs.featureFlags`) until it became a toy (owner, 2026-11-13). Given
 * the saved toy and switches as stored, and whether this has run before
 * (`GLOW_MOVED_KEY`), what to store instead, or null when it has run: a
 * toy chosen stays; with none chosen, the glow if it was on, else none.
 * The switch was on by default, so switches never saved (or unreadable)
 * mean it was on: going by whether `emptyGlow` was saved missed those, and
 * a "None" chosen with the switches untouched lost the glow it showed.
 * The switches are stored again without `emptyGlow`.
 */
export function moveGlowSwitch(
  toyRaw: string | null,
  flagsRaw: string | null,
  moved: boolean,
): { toy: ToyId; flags: string } | null {
  if (moved) return null;
  let flags: Record<string, unknown> = {};
  try {
    const parsed: unknown = flagsRaw ? JSON.parse(flagsRaw) : null;
    if (parsed && typeof parsed === "object") flags = { ...(parsed as Record<string, unknown>) };
  } catch {
    // Unreadable: as if never saved, the defaults.
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
