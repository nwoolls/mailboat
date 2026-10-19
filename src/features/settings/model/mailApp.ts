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
      return {
        description: `Another copy of Mailboat opens email links (${app.path}).`,
        action: "Use this copy",
      };
    case "other":
      return { description: `${app.name} opens email links.`, action: "Make Mailboat the default" };
    case "none":
      return { description: "No app opens email links yet.", action: "Make Mailboat the default" };
    case "unsupported":
      return { description: "Not available on this system yet." };
  }
}
