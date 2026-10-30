import { describe, expect, it } from "vitest";
import {
  clientFileFromPaste,
  consoleUrl,
  currentStep,
  explainSignInError,
  explainSyncError,
  FRESH,
  gcloudCommands,
  isSyncing,
  makeProjectId,
  nextStage,
  parseProgress,
  plainError,
  showContinueNote,
  showOnboarding,
  stepLinkLabel,
  stepsFor,
  toggleStep,
} from "./onboarding";

describe("parseProgress", () => {
  it("starts fresh, and not started, with nothing saved", () => {
    expect(parseProgress(null)).toEqual(FRESH);
    expect(parseProgress("not json")).toEqual({ ...FRESH, started: true });
  });

  it("keeps what's valid and drops what isn't", () => {
    const p = parseProgress(
      JSON.stringify({
        stage: "accounts",
        path: "gcloud",
        done: ["users", "publish", "nonsense", "branding"],
        projectId: "mail-abc123",
        finished: false,
      }),
    );
    expect(p).toEqual({
      stage: "accounts",
      path: "gcloud",
      done: ["branding", "users"],
      projectId: "mail-abc123",
      finished: false,
      started: true,
    });
    expect(parseProgress(JSON.stringify({ stage: "x", projectId: "BAD ID" }))).toMatchObject({
      stage: "welcome",
      projectId: null,
    });
  });
});

describe("showOnboarding", () => {
  it("shows with no accounts, and after the first until finished", () => {
    expect(showOnboarding(0, FRESH)).toBe(true);
    expect(showOnboarding(0, { ...FRESH, started: true, finished: true })).toBe(true);
    expect(showOnboarding(1, { ...FRESH, started: true })).toBe(true);
    expect(showOnboarding(1, { ...FRESH, started: true, finished: true })).toBe(false);
  });

  it("never shows to someone who had accounts before it existed", () => {
    expect(showOnboarding(2, FRESH)).toBe(false);
  });
});

describe("the note that says you can continue", () => {
  const state = (accountId: number, status: string, lastSyncAt: number | null) =>
    ({ accountId, status, errorKind: null, errorMessage: null, lastSyncAt }) as never;

  it("counts an account as syncing until its first pass has finished", () => {
    expect(isSyncing(undefined)).toBe(true);
    expect(isSyncing(state(1, "syncing", null))).toBe(true);
    expect(isSyncing(state(1, "idle", null))).toBe(true);
    expect(isSyncing(state(1, "backoff", 5))).toBe(true);
    expect(isSyncing(state(1, "idle", 5))).toBe(false);
  });

  it("doesn't call a failed account syncing: it needs the person, not time", () => {
    expect(isSyncing(state(1, "error", null))).toBe(false);
    expect(isSyncing(state(1, "authError", null))).toBe(false);
  });

  it("shows while any account is still syncing, and goes once all are done", () => {
    const accounts = [{ id: 1 }, { id: 2 }];
    expect(showContinueNote(accounts, [state(1, "idle", 5), state(2, "syncing", null)])).toBe(true);
    expect(showContinueNote(accounts, [state(1, "idle", 5), state(2, "idle", 6)])).toBe(false);
    expect(showContinueNote([], [])).toBe(false);
  });
});

describe("nextStage", () => {
  it("goes in order, past Google when a client is already set up", () => {
    expect(nextStage("welcome", false)).toBe("google");
    expect(nextStage("welcome", true)).toBe("accounts");
    expect(nextStage("google", true)).toBe("accounts");
    expect(nextStage("accounts", true)).toBe("yours");
    expect(nextStage("yours", true)).toBeNull();
  });
});

describe("guided steps", () => {
  it("walks the steps in order, the gcloud path skipping the first two", () => {
    expect(currentStep([], "guide")).toBe("project");
    expect(currentStep(["project"], "guide")).toBe("apis");
    expect(currentStep([], "gcloud")).toBe("branding");
    expect(currentStep(["project", "apis", "branding", "users", "client"], "guide")).toBeNull();
    expect(stepsFor("gcloud")).toEqual(["branding", "users", "client"]);
    expect(stepsFor("guide")).toHaveLength(5);
  });

  it("ticks and unticks, keeping the steps' order", () => {
    expect(toggleStep(["apis"], "project")).toEqual(["project", "apis"]);
    expect(toggleStep(["project", "apis"], "project")).toEqual(["apis"]);
  });

  it("opens each step's console page, on the project once known", () => {
    expect(consoleUrl("project", "p-123456")).toBe(
      "https://console.cloud.google.com/projectcreate",
    );
    expect(consoleUrl("apis", null)).toBe(
      "https://console.cloud.google.com/flows/enableapi?apiid=gmail.googleapis.com,people.googleapis.com,calendar-json.googleapis.com",
    );
    expect(consoleUrl("apis", "p-123456")).toMatch(
      /calendar-json\.googleapis\.com&project=p-123456$/,
    );
    expect(consoleUrl("users", "p-123456")).toBe(
      "https://console.cloud.google.com/auth/audience?project=p-123456",
    );
  });
});

describe("stepLinkLabel", () => {
  it("names the page each step opens", () => {
    expect(stepLinkLabel("users")).toBe("Open Test users");
    expect(stepLinkLabel("client")).toBe("Open Clients");
  });
});

describe("gcloud", () => {
  it("makes a valid project ID from the app's name", () => {
    const id = makeProjectId("Mail Boat!", () => 0.5);
    expect(id).toBe("mail-boat-iiiiii");
    expect(parseProgress(JSON.stringify({ projectId: id })).projectId).toBe(id);
    expect(makeProjectId("123", () => 0)).toBe("mail-000000");
  });

  it("creates the project and turns on all three APIs, in two commands", () => {
    // Two lines, because `&&` fails in Windows PowerShell 5.1 (owner, 2026-10-30).
    expect(gcloudCommands("mail-abc123", 'Ma"il')).toEqual([
      'gcloud projects create mail-abc123 --name="Mail"',
      "gcloud services enable gmail.googleapis.com people.googleapis.com calendar-json.googleapis.com --project=mail-abc123",
    ]);
  });
});

describe("clientFileFromPaste", () => {
  it("builds the file Google downloads, trimmed", () => {
    expect(JSON.parse(clientFileFromPaste(" id.apps.googleusercontent.com\n", " s "))).toEqual({
      installed: {
        client_id: "id.apps.googleusercontent.com",
        client_secret: "s",
        redirect_uris: ["http://localhost"],
      },
    });
  });
});

describe("messages", () => {
  it("drops Rust's category prefix", () => {
    expect(plainError(new Error("invalid input: This is a Web client."))).toBe(
      "This is a Web client.",
    );
    expect(plainError("plain")).toBe("plain");
  });

  it("explains sign-in failures in terms of the Google steps", () => {
    expect(explainSignInError("token error: invalid_client: Unauthorized").step).toBe("client");
    expect(explainSignInError("Google returned: org_internal").message).toMatch(/External/);
    // A cancelled sign-in, and "Access blocked" (which only ever shows as the wait
    // running out): both point at Test users, never at publishing.
    for (const message of [
      "Google returned: access_denied",
      "sign-in required: sign-in timed out",
    ]) {
      const advice = explainSignInError(message);
      expect(advice.step).toBe("users");
      expect(advice.message).toMatch(/Test users/);
      expect(advice.message).not.toMatch(/publish/i);
    }
    // Rust's own plain message (a missing mail permission) is shown as it is.
    expect(explainSignInError("The app wasn't given permission to read your mail.")).toEqual({
      message: "The app wasn't given permission to read your mail.",
      step: null,
    });
  });

  it("explains a first sync the APIs or tick boxes stopped", () => {
    expect(
      explainSyncError("Google API error 403: Gmail API has not been used in project 1")?.step,
    ).toBe("apis");
    expect(explainSyncError("Request had insufficient authentication scopes.")?.message).toMatch(
      /Select all/,
    );
    expect(explainSyncError("network error: offline")).toBeNull();
    expect(explainSyncError(null)).toBeNull();
  });
});
