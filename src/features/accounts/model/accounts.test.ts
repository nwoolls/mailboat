import { describe, expect, it } from "vitest";
import type { AccountSyncState } from "../../../platform/tauri/bindings";
import { accountInitial, syncAttention, syncBadge, syncHint, upsertSyncState } from "./accounts";

const state = (accountId: number, status: AccountSyncState["status"]): AccountSyncState => ({
  accountId,
  status,
  errorKind: null,
  errorMessage: null,
  lastSyncAt: null,
});

describe("accounts", () => {
  it("initials prefer the display name", () => {
    expect(accountInitial({ email: "me@gmail.com", displayName: "jordan" })).toBe("J");
    expect(accountInitial({ email: "work@work.example.com", displayName: null })).toBe("W");
  });

  it("an auth error asks the user to sign in again", () => {
    expect(syncBadge(state(1, "authError"))).toEqual({
      tone: "error",
      label: "Google signed you out · sign in again",
    });
    expect(syncBadge(undefined).tone).toBe("ok");
    expect(syncBadge({ ...state(1, "backoff"), errorKind: "rate_limited" }).label).toMatch(
      /slow down/,
    );
    expect(syncBadge(state(1, "backoff")).label).toBe("Retrying soon");
  });

  it("hover text adds the last sync time when up to date", () => {
    const synced = { ...state(1, "idle"), lastSyncAt: new Date(2026, 9, 15, 15, 12).getTime() };
    expect(syncHint(synced, "en-US")).toBe("Up to date · last synced Oct 15, 3:12 PM");
    expect(syncHint(state(1, "idle"))).toBe("Up to date");
    expect(syncHint(state(1, "authError"))).toBe("Google signed you out · sign in again");
  });

  it("only retries and errors call for attention, errors first", () => {
    expect(syncAttention([state(1, "idle"), state(2, "syncing")])).toBeNull();
    expect(syncAttention([state(1, "backoff"), state(2, "idle")])).toBe("warn");
    expect(syncAttention([state(1, "backoff"), state(2, "error")])).toBe("error");
  });

  it("status events replace only their own account's entry", () => {
    const list = [state(1, "idle"), state(2, "idle")];
    const next = upsertSyncState(list, state(2, "authError"));
    expect(next.map((s) => s.status)).toEqual(["idle", "authError"]);
  });
});
