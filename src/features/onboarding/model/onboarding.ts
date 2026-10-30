import type { AccountSyncState } from "../../../platform/tauri/bindings";

/**
 * The first-launch flow (Milestone 12): welcome, set up the user's own
 * Google Cloud project (a private OAuth client that stays in Testing),
 * add Gmail accounts, make it yours. Pure logic here; the screens are in
 * `../ui`.
 */

/** The flow's stages, in order; the rail on the left lists them. */
export const STAGES = ["welcome", "google", "accounts", "yours"] as const;
export type Stage = (typeof STAGES)[number];

/** How the user sets up Google Cloud: guided cards, Google's command-line tool, or a file they have. */
export type GooglePath = "guide" | "gcloud" | "have";

/** Progress, kept in the web view's storage so quitting halfway resumes. */
export type Progress = {
  stage: Stage;
  /** Chosen on the Google stage; null until then. */
  path: GooglePath | null;
  /** The guided steps ticked "Done". */
  done: GuideStepId[];
  /** The `gcloud` path's project ID, made up once so the command is stable. */
  projectId: string | null;
  /** Finished (or skipped to the end): the inbox shows from now on. */
  finished: boolean;
  /**
   * Whether anything was saved yet. Only onboarding saves progress, so
   * someone who had accounts before it existed never sees it.
   */
  started: boolean;
};

export const ONBOARDING_KEY = "onboarding";

export const FRESH: Progress = {
  stage: "welcome",
  path: null,
  done: [],
  projectId: null,
  finished: false,
  started: false,
};

/** Saved progress; anything missing or unknown is a fresh start. */
export function parseProgress(raw: string | null): Progress {
  let saved: Record<string, unknown> = {};
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === "object") saved = parsed as Record<string, unknown>;
  } catch {
    // A broken value starts over.
  }
  const stage = STAGES.find((s) => s === saved.stage) ?? FRESH.stage;
  const path = (["guide", "gcloud", "have"] as const).find((p) => p === saved.path) ?? null;
  const done = Array.isArray(saved.done)
    ? GUIDE_STEP_IDS.filter((id) => (saved.done as unknown[]).includes(id))
    : [];
  const projectId =
    typeof saved.projectId === "string" && PROJECT_ID.test(saved.projectId)
      ? saved.projectId
      : null;
  return {
    stage,
    path,
    done,
    projectId,
    finished: saved.finished === true,
    started: raw !== null,
  };
}

/**
 * Whether the window shows onboarding instead of the mail: always with no
 * accounts, and after the first sign-in until the flow is finished.
 */
export function showOnboarding(accountCount: number, progress: Progress): boolean {
  if (accountCount === 0) return true;
  return progress.started && !progress.finished;
}

/**
 * Whether an account's mail is still coming in: nothing known yet, a sync
 * under way or retrying, or its first pass not finished. A failed account
 * isn't syncing: it needs the person, not time.
 */
export function isSyncing(state: AccountSyncState | undefined): boolean {
  if (!state) return true;
  if (state.status === "error" || state.status === "authError") return false;
  return state.status !== "idle" || state.lastSyncAt == null;
}

/**
 * Whether to tell the person they needn't wait: some account is still
 * syncing, and syncing carries on after they continue.
 */
export function showContinueNote(
  accounts: readonly { id: number }[],
  states: readonly AccountSyncState[],
): boolean {
  return accounts.some((a) => isSyncing(states.find((s) => s.accountId === a.id)));
}

/**
 * The stage after `stage`, or null at the end. Past Google when a client
 * is already set up (signing in again after removing every account, or
 * the env-var client), unless the user went there on purpose.
 */
export function nextStage(stage: Stage, configured: boolean): Stage | null {
  if (stage === "welcome" && configured) return "accounts";
  return STAGES[STAGES.indexOf(stage) + 1] ?? null;
}

// --- Google Cloud --------------------------------------------------------

/** The guided steps, one card each, in order. */
export const GUIDE_STEP_IDS = ["project", "apis", "branding", "users", "client"] as const;
export type GuideStepId = (typeof GUIDE_STEP_IDS)[number];

/** The APIs the app uses: mail, address suggestions, invitations. */
export const APIS = [
  "gmail.googleapis.com",
  "people.googleapis.com",
  "calendar-json.googleapis.com",
] as const;

const CONSOLE = "https://console.cloud.google.com";

/**
 * The Google Cloud console page for a step. With a project ID (the `gcloud`
 * path knows it) the page opens on that project; without one, the console
 * stays on the project last opened, which is the one just created.
 */
export function consoleUrl(step: GuideStepId, projectId: string | null): string {
  const path = {
    project: "/projectcreate",
    apis: `/flows/enableapi?apiid=${APIS.join(",")}`,
    branding: "/auth/overview",
    // The Audience page: test users, and the publishing status that stays "Testing".
    users: "/auth/audience",
    client: "/auth/clients/create",
  }[step];
  if (!projectId || step === "project") return CONSOLE + path;
  return `${CONSOLE}${path}${path.includes("?") ? "&" : "?"}project=${projectId}`;
}

/** The first step not yet ticked, or null when all are. */
export function currentStep(done: readonly GuideStepId[], path: GooglePath | null) {
  const skipped = path === "gcloud" ? ["project", "apis"] : [];
  return GUIDE_STEP_IDS.find((id) => !done.includes(id) && !skipped.includes(id)) ?? null;
}

/** The steps the chosen path shows (`gcloud` does the first two itself). */
export function stepsFor(path: GooglePath | null): GuideStepId[] {
  return path === "gcloud"
    ? GUIDE_STEP_IDS.filter((id) => id !== "project" && id !== "apis")
    : [...GUIDE_STEP_IDS];
}

/** What the button to a step's Google Cloud page says. */
export function stepLinkLabel(step: GuideStepId): string {
  return {
    project: "Open Google Cloud",
    apis: "Open the APIs page",
    branding: "Open the sign-in screen settings",
    users: "Open Test users",
    client: "Open Clients",
  }[step];
}

/** Ticks (or unticks) a step. */
export function toggleStep(done: readonly GuideStepId[], step: GuideStepId): GuideStepId[] {
  return done.includes(step)
    ? done.filter((id) => id !== step)
    : GUIDE_STEP_IDS.filter((id) => id === step || done.includes(id));
}

// Google: 6 to 30 lowercase letters, digits or hyphens, starting with a
// letter and not ending with a hyphen.
const PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

/** A project ID for the `gcloud` path: the app's name and a random tail. */
export function makeProjectId(appName: string, random: () => number): string {
  const base =
    appName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/^[^a-z]+/, "")
      .slice(0, 20) || "mail";
  let tail = "";
  while (tail.length < 6) tail += Math.floor(random() * 36).toString(36);
  return `${base}-${tail}`;
}

/**
 * The commands that create the project and turn on the APIs, to run one at
 * a time. Two, not one joined with `&&`: Windows PowerShell 5.1 (the
 * default) doesn't know `&&`, and cmd (the Cloud SDK Shell) doesn't know
 * `;`, so no single line works in every shell.
 */
export function gcloudCommands(projectId: string, appName: string): [string, string] {
  return [
    `gcloud projects create ${projectId} --name="${appName.replace(/["\\$`]/g, "")}"`,
    `gcloud services enable ${APIS.join(" ")} --project=${projectId}`,
  ];
}

/**
 * A client file from a pasted client ID and secret (Google's "client
 * created" popup shows both), in the shape Google downloads, for Rust to
 * check like any other.
 */
export function clientFileFromPaste(clientId: string, clientSecret: string): string {
  return JSON.stringify({
    installed: {
      client_id: clientId.trim(),
      client_secret: clientSecret.trim(),
      redirect_uris: ["http://localhost"],
    },
  });
}

// --- Messages --------------------------------------------------------------

/** An error's message without Rust's category prefix ("invalid input: …"). */
export function plainError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^(invalid input|sign-in required|configuration error): /, "");
}

/**
 * What to tell the user about a problem, and the Google Cloud page that
 * fixes it (opened with `consoleUrl`), when there is one.
 */
export type Advice = { message: string; step: GuideStepId | null };

/** How long a sign-in waits before the screen mentions Google's "Access blocked". */
export const BLOCKED_HINT_MS = 20_000;

/**
 * A sign-in that failed, explained in terms of the Google Cloud steps.
 * Google's error codes are in the message. Google's "Access blocked" page
 * (an address that isn't a test user) never comes back to the app, so that
 * one shows up here only as the wait running out.
 */
export function explainSignInError(message: string): Advice {
  if (/invalid_client|unauthorized_client|deleted_client/.test(message))
    return {
      message:
        "Google didn’t recognise the OAuth client in your credentials file. It may have been deleted, or the file is from another project. You’ll need a new Desktop app OAuth client and its credentials file.",
      step: "client",
    };
  if (/org_internal/.test(message))
    return {
      message:
        "The project’s audience is set to Internal, which only lets in accounts from your own Google Workspace organisation. Change it to External on the Audience page.",
      step: "users",
    };
  if (/access_denied/.test(message))
    return {
      message:
        "Google said no. That’s what pressing Cancel does: sign in again and press Continue. If Google showed “Access blocked” instead, add this address under Test users first.",
      step: "users",
    };
  if (/timed out/.test(message))
    return {
      message:
        "Sign-in wasn’t finished in time. If Google showed “Access blocked”, add this address under Test users, then try again.",
      step: "users",
    };
  return { message, step: null };
}

/**
 * An account's first sync that failed, explained when it's something the
 * Google Cloud steps cover. Null when it's anything else (shown as it is).
 */
export function explainSyncError(message: string | null): Advice | null {
  if (!message) return null;
  if (/has not been used|is disabled|SERVICE_DISABLED|accessNotConfigured/.test(message))
    return {
      message:
        "Google says the Gmail API isn’t turned on in your project. Turn on the APIs, wait a minute, and it will sync by itself.",
      step: "apis",
    };
  if (/insufficient|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(message))
    return {
      message:
        "Google didn’t allow reading this account’s mail: a permission box was left empty. Sign in again and tick “Select all”.",
      step: null,
    };
  return null;
}
