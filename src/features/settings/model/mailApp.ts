import type { DefaultMailApp } from "../../../platform/tauri/bindings";

/**
 * What Settings → General says about email links, and the button that
 * makes Mailboat the default (none when it already is, or can't be).
 */
export function defaultMailAppRow(app: DefaultMailApp): { description: string; action?: string } {
  switch (app.kind) {
    case "this":
      return { description: "Mailboat is your default email reader: email links open here." };
    case "otherCopy":
      // macOS keeps the default by app ID, which every copy shares, and
      // chooses the copy itself: a button couldn't change it.
      return {
        description: `Mailboat is your default email reader. macOS sends email links to the copy at ${app.path}.`,
      };
    case "other":
      return { description: `${app.name} opens email links.`, action: "Make Mailboat the default" };
    case "none":
      return { description: "No app opens email links yet.", action: "Make Mailboat the default" };
    case "unsupported":
      return { description: "Not available on this system yet." };
  }
}
