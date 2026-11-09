import { describe, expect, it } from "vitest";
import type {
  AiSettings,
  AppSettings_Serialize as AppSettings,
} from "../../../platform/tauri/bindings";
import { cloudUses, isCloudProvider, leavesRows } from "./privacy";

// Only the fields the page reads; the rest of the settings don't matter here.
function settings(over: Partial<AppSettings> = {}): AppSettings {
  return {
    remoteImages: "load",
    imagePrefetch: true,
    autoCheckUpdates: true,
    updateChannel: "stable",
    ai: {
      listSummaries: "apple",
      readerSummary: "auto",
      readerProvider: "apple",
      writingProvider: "apple",
    },
    mcp: { read: [], drafts: [] },
    ...over,
  } as AppSettings;
}

const row = (s: AppSettings, id: string, accounts = 2) =>
  leavesRows(s, accounts).find((r) => r.id === id)!;

describe("what leaves the computer", () => {
  it("lists the five places, in order", () => {
    expect(leavesRows(settings(), 2).map((r) => r.id)).toEqual([
      "google",
      "images",
      "updates",
      "cloudAi",
      "aiApps",
    ]);
  });

  it("says nothing goes to a cloud model when everything runs on the Mac", () => {
    const r = row(settings(), "cloudAi");
    expect(r.when).toBe("Never.");
    expect(r.now).toContain("Nothing is set to a cloud provider");
  });

  it("names each part of AI that is set to Claude or ChatGPT", () => {
    const ai = {
      listSummaries: "claude",
      readerSummary: "button",
      readerProvider: "chatgpt",
      writingProvider: "claude",
    } as AiSettings;
    expect(cloudUses(ai)).toEqual([
      "one-line summaries in the list (Claude)",
      "the summary above a conversation, when you press Summarize (ChatGPT)",
      "writing help (Claude)",
    ]);
    expect(row(settings({ ai }), "cloudAi").when).toBe("Only for what is set to it.");
  });

  it("leaves out a summary that is off, even with a cloud provider chosen", () => {
    const ai = {
      listSummaries: null,
      readerSummary: "off",
      readerProvider: "claude",
      writingProvider: "apple",
    } as AiSettings;
    expect(cloudUses(ai)).toEqual([]);
  });

  it("knows which providers are cloud ones", () => {
    expect(isCloudProvider("claude")).toBe(true);
    expect(isCloudProvider("chatgpt")).toBe(true);
    expect(isCloudProvider("apple")).toBe(false);
    expect(isCloudProvider(null)).toBe(false);
  });

  it("follows the remote image setting and the download on arrival", () => {
    expect(row(settings(), "images").when).toContain("As mail arrives");
    const held = row(settings({ remoteImages: "block" }), "images");
    expect(held.when).toBe("When you open an email. Never in Spam.");
    expect(held.now).toBe("Images are blocked until you allow a sender.");
    const late = row(settings({ imagePrefetch: false }), "images");
    expect(late.when).toContain("When you open an email");
  });

  it("follows the update setting and channel", () => {
    expect(row(settings(), "updates").when).toBe("At launch and about once a day.");
    const off = row(settings({ autoCheckUpdates: false, updateChannel: "beta" }), "updates");
    expect(off.when).toBe("Only when you press Check for updates.");
    expect(off.now).toBe("Not checking automatically, on the Beta channel.");
  });

  it("counts the accounts AI apps may read", () => {
    expect(row(settings(), "aiApps").now).toBe("Off for every account.");
    const on = settings({ mcp: { read: [1, 2], drafts: [2] } as AppSettings["mcp"] });
    expect(row(on, "aiApps", 3).now).toBe("Can read 2 of 3 accounts, and save drafts for 1.");
  });

  it("points each row at the section where it is changed", () => {
    const where = Object.fromEntries(leavesRows(settings(), 1).map((r) => [r.id, r.section]));
    expect(where).toEqual({
      google: "accounts",
      images: "viewing",
      updates: "general",
      cloudAi: "ai",
      aiApps: "ai",
    });
  });
});
