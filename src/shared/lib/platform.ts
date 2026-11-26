/**
 * Which system the window runs on, and the keyboard differences that
 * follow. The app was built on the Mac; on Windows and Linux Ctrl takes
 * the place of ⌘, and the Mac's ⌃ in a two-modifier shortcut (⌃⌘S)
 * becomes Alt (Ctrl+Alt+S), as Windows apps pair them.
 */

/** The systems the app runs on, as `data-platform` names them on the page. */
export type Platform = "mac" | "windows" | "linux";

/**
 * Read from the web view's user agent: "Macintosh" in the Mac's WebKit,
 * "Windows" in WebView2, "X11" or "Linux" in WebKitGTK.
 */
export function detectPlatform(userAgent: string): Platform {
  if (/Mac|darwin/.test(userAgent)) return "mac";
  if (/Windows|win32/.test(userAgent)) return "windows";
  return "linux";
}

export function detectMac(userAgent: string): boolean {
  return detectPlatform(userAgent) === "mac";
}

export const PLATFORM: Platform =
  typeof navigator === "undefined" ? "windows" : detectPlatform(navigator.userAgent);

export const IS_MAC = PLATFORM === "mac";

/**
 * The system, as a sentence names it: "System follows macOS". Linux has
 * many desktops, each with its own settings, so it is "your desktop".
 */
export function systemName(platform: Platform = PLATFORM): string {
  return { mac: "macOS", windows: "Windows", linux: "your desktop" }[platform];
}

/** The menu item that shows a file in the system's file manager. */
export function revealLabel(platform: Platform = PLATFORM): string {
  return {
    mac: "Show in Finder",
    windows: "Show in File Explorer",
    linux: "Show in Folder",
  }[platform];
}

/** The key shortcuts are built on: ⌘ on the Mac, Ctrl elsewhere. */
export function primaryKey(e: Pick<KeyboardEvent, "metaKey" | "ctrlKey">, mac = IS_MAC): boolean {
  return mac ? e.metaKey : e.ctrlKey;
}

/** Keys whose names differ between the platforms' labels. */
const KEY_NAMES: Record<string, [mac: string, other: string]> = {
  Enter: ["↩", "Enter"],
  Backspace: ["⌫", "Backspace"],
  Delete: ["⌦", "Delete"],
  Space: ["Space", "Space"],
};

/**
 * How a shortcut in Tauri's accelerator form ("Shift+Cmd+R") reads on
 * screen: ⇧⌘R on the Mac, Ctrl+Shift+R elsewhere. `Cmd` is the primary
 * key; `Ctrl` is the Mac's ⌃, which is Alt elsewhere.
 */
export function accelLabel(accel: string, mac = IS_MAC): string {
  const parts = accel.split("+");
  const key = parts.pop() ?? "";
  const named = KEY_NAMES[key];
  const keyName = named ? named[mac ? 0 : 1] : key.length === 1 ? key.toUpperCase() : key;
  if (mac) {
    const symbols: Record<string, string> = { Ctrl: "⌃", Alt: "⌥", Shift: "⇧", Cmd: "⌘" };
    const mods = ["Ctrl", "Alt", "Shift", "Cmd"].filter((m) => parts.includes(m));
    return mods.map((m) => symbols[m]).join("") + keyName;
  }
  const mods = [
    parts.includes("Cmd") && "Ctrl",
    (parts.includes("Ctrl") || parts.includes("Alt")) && "Alt",
    parts.includes("Shift") && "Shift",
  ].filter(Boolean);
  return [...mods, keyName].join("+");
}

/**
 * Whether a key press is the accelerator, by physical key for letters and
 * digits (so other keyboard layouts still work), with exactly its
 * modifiers. Mapped as `accelLabel` shows it.
 */
export function accelMatches(
  e: Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
  accel: string,
  mac = IS_MAC,
): boolean {
  const parts = accel.split("+");
  const key = parts.pop() ?? "";
  const has = (m: string) => parts.includes(m);
  const want = mac
    ? { meta: has("Cmd"), ctrl: has("Ctrl"), alt: has("Alt") }
    : { meta: false, ctrl: has("Cmd"), alt: has("Ctrl") || has("Alt") };
  if (
    e.metaKey !== want.meta ||
    e.ctrlKey !== want.ctrl ||
    e.altKey !== want.alt ||
    e.shiftKey !== has("Shift")
  )
    return false;
  if (/^[A-Za-z]$/.test(key)) return e.code === `Key${key.toUpperCase()}`;
  if (/^[0-9]$/.test(key)) return e.code === `Digit${key}`;
  return e.key === key;
}
