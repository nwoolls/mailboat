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
    imageCacheMb: 500,
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

const ids = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
const row = (s: AppSettings, id: string, accounts = 2) =>
  leavesRows(s, ids(accounts)).find((r) => r.id === id)!;

describe("what leaves the computer", () => {
  it("lists the five places, in order", () => {
    expect(leavesRows(settings(), ids(2)).map((r) => r.id)).toEqual([
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
      "writing help, and translation Apple can't do (Claude)",
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

  it("takes anything but Apple Intelligence as a cloud provider, so a new one is disclosed", () => {
    expect(isCloudProvider("claude")).toBe(true);
    expect(isCloudProvider("chatgpt")).toBe(true);
    expect(isCloudProvider("some-new-provider")).toBe(true);
    expect(isCloudProvider("apple")).toBe(false);
    expect(isCloudProvider(null)).toBe(false);
    expect(isCloudProvider(undefined)).toBe(false);
  });

  it("treats a missing reader mode as automatic, the default", () => {
    const ai = { readerProvider: "claude", writingProvider: "apple" } as AiSettings;
    expect(cloudUses(ai)).toEqual(["the summary above a conversation, automatic (Claude)"]);
  });

  it("says recent mail is downloaded on arrival, and older mail when opened", () => {
    const load = row(settings(), "images");
    expect(load.when).toContain("As recent mail arrives (the last two weeks)");
    expect(load.when).toContain("Older mail, and an image that failed to download");
    expect(row(settings({ imagePrefetch: false }), "images").when).toBe("When you open an email.");
  });

  it("says a blocked setting loads only for senders you've allowed", () => {
    const held = row(settings({ remoteImages: "block" }), "images");
    expect(held.when).toContain("Only for senders you've allowed");
    expect(held.when).not.toBe("When you open an email.");
    expect(held.now).toContain("Images are blocked until you allow a sender.");
    const later = row(settings({ remoteImages: "block", imagePrefetch: false }), "images");
    expect(later.when).toBe("Only when you open an email from a sender you've allowed.");
  });

  it("says how much of the downloaded images is kept, and what happens beyond it", () => {
    const now = row(settings({ imageCacheMb: 1000 }), "images").now;
    expect(now).toContain("kept up to 1000 MB");
    expect(now).toContain("least recently shown are removed and load again");
  });

  it("always mentions Spam, Trash and the sender's own choice", () => {
    for (const remoteImages of ["load", "correspondents", "block"] as const) {
      const now = row(settings({ remoteImages }), "images").now;
      expect(now).toContain("A choice you saved for a sender wins, except in Spam");
      expect(now).toContain("In Trash, only allowed senders load");
    }
  });

  it("says a search can reach Google and that installing tells GitHub the kind of computer", () => {
    expect(row(settings(), "google").gets).toContain("your search words");
    expect(row(settings(), "updates").gets).toContain("Installing an update also tells GitHub");
    expect(row(settings({ autoCheckUpdates: false }), "updates").when).toBe(
      "When you press Check for updates or install an update.",
    );
  });

  it("follows the update setting and channel", () => {
    expect(row(settings(), "updates").when).toBe(
      "At launch and about once a day, and when you press Check for updates or install.",
    );
    const off = row(settings({ autoCheckUpdates: false, updateChannel: "beta" }), "updates");
    expect(off.when).toBe("When you press Check for updates or install an update.");
    expect(off.now).toBe("Not checking automatically, on the Beta channel.");
  });

  it("counts only existing accounts, and drafts only where mail can also be read", () => {
    const odd = settings({ mcp: { read: [1, 9], drafts: [2, 1, 9] } as AppSettings["mcp"] });
    expect(row(odd, "aiApps", 2).now).toBe("Can read 1 of 2 accounts, and save drafts for 1.");
    const noRead = settings({ mcp: { read: [1], drafts: [2] } as AppSettings["mcp"] });
    expect(row(noRead, "aiApps", 2).now).toBe("Can read 1 of 2 accounts, and save drafts for 0.");
    const gone = settings({ mcp: { read: [7], drafts: [7] } as AppSettings["mcp"] });
    expect(row(gone, "aiApps", 0).now).toBe("Off for every account.");
  });

  it("counts the accounts AI apps may read", () => {
    expect(row(settings(), "aiApps").now).toBe("Off for every account.");
    const on = settings({ mcp: { read: [1, 2], drafts: [2] } as AppSettings["mcp"] });
    expect(row(on, "aiApps", 3).now).toBe("Can read 2 of 3 accounts, and save drafts for 1.");
  });

  it("points each row at the section where it is changed", () => {
    const where = Object.fromEntries(leavesRows(settings(), ids(1)).map((r) => [r.id, r.section]));
    expect(where).toEqual({
      google: "accounts",
      images: "viewing",
      updates: "general",
      cloudAi: "ai",
      aiApps: "ai",
    });
  });
});
