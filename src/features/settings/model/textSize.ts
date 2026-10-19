/**
 * Text size for the conversation list and the reader (Settings →
 * Appearance). Window-only. Applied as CSS `zoom` on the rows' text, the
 * reader's headers and inside each email's frame (see `ThreadList`,
 * `ThreadReader`, `MessageFrame`), since the app's text sizes are fixed
 * pixels.
 */
export type TextSize = "small" | "default" | "large" | "larger";

export const TEXT_SIZES: readonly { value: TextSize; label: string; zoom: number }[] = [
  { value: "small", label: "Small", zoom: 0.9 },
  { value: "default", label: "Default", zoom: 1 },
  { value: "large", label: "Large", zoom: 1.15 },
  { value: "larger", label: "Larger", zoom: 1.3 },
];

export const TEXT_SIZE_STORAGE_KEY = "mailboat.textSize";

/** What was saved, or the default if nothing (or nonsense) was. */
export function parseTextSize(raw: string | null): TextSize {
  let saved: unknown;
  try {
    saved = raw ? JSON.parse(raw) : null;
  } catch {
    saved = null;
  }
  return TEXT_SIZES.find((s) => s.value === saved)?.value ?? "default";
}

/** How much bigger (or smaller) than the default it draws text. */
export function textZoom(size: TextSize): number {
  return TEXT_SIZES.find((s) => s.value === size)?.zoom ?? 1;
}
