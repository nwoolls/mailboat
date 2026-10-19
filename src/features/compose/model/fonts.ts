/** Gmail's font choices, with the stacks Gmail sends. */
export const FONTS: [label: string, family: string][] = [
  ["Sans Serif", "Arial, Helvetica, sans-serif"],
  ["Serif", "'Times New Roman', Times, serif"],
  ["Fixed width", "monospace"],
  ["Wide", "'Arial Black', sans-serif"],
  ["Narrow", "'Arial Narrow', sans-serif"],
  ["Comic Sans MS", "'Comic Sans MS', sans-serif"],
  ["Garamond", "Garamond, serif"],
  ["Georgia", "Georgia, serif"],
  ["Tahoma", "Tahoma, sans-serif"],
  ["Trebuchet MS", "'Trebuchet MS', sans-serif"],
  ["Verdana", "Verdana, sans-serif"],
];

/** Gmail's four sizes; "Normal" leaves the reader's default. */
export const SIZES: [label: string, size: string][] = [
  ["Small", "10px"],
  ["Normal", ""],
  ["Large", "18px"],
  ["Huge", "32px"],
];

/**
 * The text style new messages start in (Settings → Composing). Empty
 * strings are "no choice": the reader's own default, as before.
 */
export type TextStyle = { font: string; size: string };

export const PLAIN_STYLE: TextStyle = { font: "", size: "" };

/** CSS for the style, or nothing when it's the plain default. */
export function styleCss(style: TextStyle): string {
  return [style.font && `font-family:${style.font}`, style.size && `font-size:${style.size}`]
    .filter(Boolean)
    .join(";");
}
