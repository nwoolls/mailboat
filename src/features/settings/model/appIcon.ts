/**
 * Settings → Appearance → App icon. The choices are named by their files
 * in `design/icon/choices/` (e.g. "C10-orange"). The built-in icon is
 * C17 (system blue); choosing it saves "no choice", so the Dock shows the
 * built-in icon with the glass rim macOS draws for it.
 */
export const BUILT_IN_ICON = "C17-system-blue";

/** Which choice is showing, for a saved setting (none: the built-in one). */
export function shownIcon(saved: string | null | undefined): string {
  return saved ?? BUILT_IN_ICON;
}

/** What to save for a picked choice. */
export function iconSetting(choice: string): string | null {
  return choice === BUILT_IN_ICON ? null : choice;
}

/** A choice's name for people: "C10-orange" → "Orange". */
export function iconLabel(choice: string): string {
  const words = choice.replace(/^C\d+-/, "").replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
