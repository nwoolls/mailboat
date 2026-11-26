import type { DefaultMailApp } from "../../../platform/tauri/bindings";
import { PLATFORM, type Platform } from "../../../shared/lib/platform";
import { APP_NAME } from "../../../shared/lib/brand";

/**
 * What Settings → General says about email links, and the button that
 * makes the app the default (none when it already is, or can't be). On
 * Windows an app can't make itself the default: the button opens Windows'
 * Default apps page, where the owner picks the app. On Linux the button
 * sets it, as on the Mac; an AppImage has no desktop entry of its own, so
 * it reads as not installed.
 */
export function defaultMailAppRow(
  app: DefaultMailApp,
  platform: Platform = PLATFORM,
): { description: string; action?: string } {
  const action =
    platform === "windows" ? "Choose in Windows Settings" : `Make ${APP_NAME} the default`;
  const system = platform === "windows" ? "Windows" : "macOS";
  switch (app.kind) {
    case "this":
      return { description: `${APP_NAME} is your default email reader: email links open here.` };
    case "otherCopy":
      // macOS keeps the default by app ID, which every copy shares, and
      // chooses the copy itself: a button couldn't change it. Windows
      // starts the copy its installer registered.
      return {
        description: `${APP_NAME} is your default email reader. ${system} sends email links to the copy at ${app.path}.`,
      };
    case "other":
      return { description: `${app.name} opens email links.`, action };
    case "none":
      return { description: "No app opens email links yet.", action };
    case "notInstalled":
      return { description: `Install ${APP_NAME} to open email links with it.` };
    case "unsupported":
      return { description: "Not available on this system yet." };
  }
}
