/** Where the app is with updating itself, as the window sees it. */
export type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "upToDate" }
  /** A newer version is there. `error` is why the last try to install it failed. */
  | { kind: "available"; version: string; notes: string | null; error?: string }
  | {
      kind: "installing";
      version: string;
      notes: string | null;
      downloaded: number;
      total: number | null;
    }
  /** A look somebody asked for couldn't be made. */
  | { kind: "failed"; message: string };

/** What the Settings → About row says. */
export function describeUpdate(state: UpdateState): string {
  switch (state.kind) {
    case "idle":
      return "Not checked yet in this session.";
    case "checking":
      return "Checking…";
    case "upToDate":
      return "You have the latest version.";
    case "available":
      return state.error
        ? `Version ${state.version} is available, but it couldn’t be installed: ${state.error}`
        : `Version ${state.version} is available.`;
    case "installing":
      return `Downloading version ${state.version}…`;
    case "failed":
      return state.message;
  }
}

/** The download's progress as a whole percent, or null while the size isn't known. */
export function percent(downloaded: number, total: number | null): number | null {
  if (total === null || total <= 0) return null;
  return Math.min(100, Math.max(0, Math.round((downloaded / total) * 100)));
}

/** Whether "Check for updates" can be pressed: not while one is going on. */
export function canCheck(state: UpdateState): boolean {
  return state.kind !== "checking" && state.kind !== "installing";
}

/**
 * Whether the top-right notice shows: an update the person hasn't put off
 * with "Later" (for this version, until the next launch), and always while
 * one is installing.
 */
export function showNotice(state: UpdateState, dismissed: ReadonlySet<string>): boolean {
  if (state.kind === "installing") return true;
  return state.kind === "available" && !dismissed.has(state.version);
}

/** The release notes cut to a few short lines for the notice. */
export function notesPreview(notes: string | null, maxLines = 4, maxChars = 280): string | null {
  const lines = (notes ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  if (lines.length === 0) return null;
  let text = lines.slice(0, maxLines).join("\n");
  const cut = lines.length > maxLines || text.length > maxChars;
  if (text.length > maxChars) text = text.slice(0, maxChars).trimEnd();
  return cut ? `${text}…` : text;
}
