import { describe, expect, it } from "vitest";
import type { ProviderStatus } from "../../../platform/tauri/bindings";
import {
  type AiChoices,
  aiChoices,
  isReady,
  leavesMac,
  offered,
  qualityChoices,
  statusLine,
} from "./providers";

const ai: AiChoices = {
  connected: ["chatgpt"],
  listSummaries: "apple",
  readerSummary: "auto",
  readerProvider: "apple",
  writingProvider: "apple",
  writingQuality: "best",
  chatgptModel: null,
};

describe("providers", () => {
  it("offers Apple plus whatever was connected, in a fixed order", () => {
    expect(offered(ai)).toEqual(["apple", "chatgpt"]);
    expect(offered({ ...ai, connected: ["chatgpt", "claude"] })).toEqual([
      "apple",
      "chatgpt",
      "claude",
    ]);
  });

  it("fills in Rust's defaults, keeping an explicit off", () => {
    expect(aiChoices(undefined).listSummaries).toBe("apple");
    expect(aiChoices({ ai: { listSummaries: null } } as never).listSummaries).toBeNull();
    expect(aiChoices({ ai: { connected: ["claude"] } } as never).writingProvider).toBe("apple");
  });

  it("describes each state in plain words", () => {
    const claude: ProviderStatus = { provider: "claude", state: "ready", account: "n@x.com" };
    expect(statusLine(claude, true)).toBe("Connected as n@x.com.");
    expect(statusLine(claude, false)).toBe("Signed in, not used by Mailboat yet.");
    expect(statusLine({ provider: "chatgpt", state: "notInstalled" }, false)).toContain("Codex");
    expect(
      statusLine({ provider: "apple", state: "unavailable", reason: "Turn it on." }, false),
    ).toBe("Turn it on.");
    expect(statusLine(undefined, false)).toBe("Checking…");
  });

  it("offers each provider's own model choice for writing", () => {
    expect(qualityChoices("claude")?.map((c) => c.label)).toEqual(["Haiku", "Sonnet", "Opus"]);
    expect(qualityChoices("chatgpt")).toBeNull();
    expect(aiChoices(undefined).chatgptModel).toBeNull();
    expect(qualityChoices("apple")).toBeNull();
    expect(aiChoices(undefined).writingQuality).toBe("best");
  });

  it("knows which ones keep mail on the Mac", () => {
    expect(leavesMac("apple")).toBe(false);
    expect(leavesMac("claude")).toBe(true);
    expect(isReady([{ provider: "apple", state: "ready", account: null }], "apple")).toBe(true);
    expect(isReady([], "apple")).toBe(false);
  });
});
