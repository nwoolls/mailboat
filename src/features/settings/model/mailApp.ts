import type { DefaultMailApp } from "../../../platform/tauri/bindings";
import { IS_MAC } from "../../../shared/lib/platform";
import { APP_NAME } from "../../../shared/lib/brand";

/**
 * What Settings → General says about email links, and the button that
 * makes the app the default (none when it already is, or can't be). On
 * Windows an app can't make itself the default: the button opens Windows'
 * Default apps page, where the owner picks the app.
 */
export function defaultMailAppRow(
  app: DefaultMailApp,
  mac = IS_MAC,
): { description: string; action?: string } {
  const action = mac ? `Make ${APP_NAME} the default` : "Choose in Windows Settings";
  const system = mac ? "macOS" : "Windows";
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
