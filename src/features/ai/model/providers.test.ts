import { describe, expect, it } from "vitest";
import type { ProviderStatus } from "../../../platform/tauri/bindings";
import {
  type AiChoices,
  aiChoices,
  canSummarize,
  canWrite,
  isReady,
  leavesMac,
  offered,
  qualityChoices,
  readerChoice,
  statusLine,
  trainingNote,
  summaryTrainingProviders,
  writingTrainingProviders,
} from "./providers";
import { APP_NAME } from "../../../shared/lib/brand";

const ai: AiChoices = {
  connected: ["chatgpt"],
  listSummaries: "apple",
  readerSummary: "auto",
  readerProvider: "apple",
  writingProvider: "apple",
  writingQuality: "best",
  chatgptModel: null,
  keepSummaries: true,
};

describe("providers", () => {
  it("offers Apple plus whatever was connected, in a fixed order", () => {
    expect(offered(ai, undefined, true)).toEqual(["apple", "chatgpt"]);
    expect(offered({ ...ai, connected: ["chatgpt", "claude"] }, undefined, true)).toEqual([
      "apple",
      "chatgpt",
      "claude",
    ]);
  });

  it("leaves Apple out where it can't run", () => {
    // Windows, before the status is in: by platform.
    expect(offered(ai, undefined, false)).toEqual(["chatgpt"]);
    // Windows, or a Mac that can't run it: Rust says so.
    const unsupported = [
      { provider: "apple" as const, state: "unsupported" as const, reason: "x" },
    ];
    expect(offered(ai, unsupported, true)).toEqual(["chatgpt"]);
    // Only turned off in System Settings: still offered, to turn on.
    const off = [{ provider: "apple" as const, state: "unavailable" as const, reason: "x" }];
    expect(offered(ai, off, true)).toEqual(["apple", "chatgpt"]);
  });

  it("fills in Rust's defaults, keeping an explicit off", () => {
    expect(aiChoices(undefined).listSummaries).toBe("apple");
    expect(aiChoices({ ai: { listSummaries: null } } as never).listSummaries).toBeNull();
    expect(aiChoices({ ai: { connected: ["claude"] } } as never).writingProvider).toBe("apple");
  });

  it("describes each state in plain words", () => {
    const claude: ProviderStatus = { provider: "claude", state: "ready", account: "n@x.example" };
    expect(statusLine(claude, true)).toBe("Connected as n@x.example.");
    expect(statusLine(claude, false)).toBe(`Signed in, not used by ${APP_NAME} yet.`);
    expect(statusLine({ provider: "chatgpt", state: "notInstalled" }, false)).toContain("Codex");
    // The desktop app is enough: the app uses the copy inside it.
    expect(statusLine({ provider: "claude", state: "notInstalled" }, false)).toContain(
      "the Claude app",
    );
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

const ready = (provider: ProviderStatus["provider"]): ProviderStatus =>
  ({ provider, state: "ready" }) as ProviderStatus;

describe("what can run", () => {
  it("summarizes with a ready provider unless summaries are off", () => {
    expect(canSummarize(ai, [ready("apple")])).toBe(true);
    expect(canSummarize({ ...ai, readerSummary: "off" }, [ready("apple")])).toBe(false);
    expect(canSummarize(ai, [])).toBe(false);
  });

  it("needs a cloud provider connected as well as ready", () => {
    const claude = { ...ai, writingProvider: "claude" as const, readerProvider: "claude" as const };
    expect(canWrite(claude, [ready("claude")])).toBe(false);
    expect(canWrite({ ...claude, connected: ["claude"] }, [ready("claude")])).toBe(true);
    expect(canSummarize({ ...claude, connected: ["claude"] }, [ready("claude")])).toBe(true);
  });
});

describe("the model-training note", () => {
  const cloud: AiChoices = {
    ...ai,
    connected: ["chatgpt", "claude"],
    listSummaries: null,
    readerSummary: "off",
  };

  it("names, under Summaries, the provider for the list and the one above a conversation", () => {
    expect(summaryTrainingProviders(ai)).toEqual([]); // Apple for everything: on the Mac
    expect(summaryTrainingProviders({ ...cloud, listSummaries: "chatgpt" })).toEqual(["chatgpt"]);
    expect(
      summaryTrainingProviders({
        ...cloud,
        listSummaries: "chatgpt",
        readerSummary: "button",
        readerProvider: "claude",
      }),
    ).toEqual(["chatgpt", "claude"]);
  });

  it("counts the summary above a conversation only when it isn't turned off", () => {
    const chosen: AiChoices = { ...cloud, readerProvider: "chatgpt" };
    expect(summaryTrainingProviders(chosen)).toEqual([]);
    expect(summaryTrainingProviders({ ...chosen, readerSummary: "button" })).toEqual(["chatgpt"]);
    expect(summaryTrainingProviders({ ...chosen, readerSummary: "auto" })).toEqual(["chatgpt"]);
  });

  it("names, under Writing, only the writing provider, and Summaries' choices stay out of it", () => {
    expect(writingTrainingProviders(ai)).toEqual([]);
    expect(writingTrainingProviders({ ...cloud, writingProvider: "claude" })).toEqual(["claude"]);
    const summariesOnly: AiChoices = { ...cloud, listSummaries: "chatgpt" };
    expect(writingTrainingProviders(summariesOnly)).toEqual([]);
    expect(summaryTrainingProviders({ ...cloud, writingProvider: "claude" })).toEqual([]);
  });

  it("leaves out a provider that was chosen but is no longer connected", () => {
    const gone: AiChoices = { ...cloud, connected: [], listSummaries: "claude" };
    expect(summaryTrainingProviders(gone)).toEqual([]);
    expect(writingTrainingProviders({ ...gone, writingProvider: "claude" })).toEqual([]);
  });

  it("says it once for one provider, and for both when two are used", () => {
    expect(trainingNote([])).toBeNull();
    expect(trainingNote(["claude"])).toBe(
      "Claude may use what it receives to train its models, depending on your account’s settings. We recommend turning that off in Claude’s privacy settings.",
    );
    expect(trainingNote(["chatgpt", "claude"])).toBe(
      "ChatGPT and Claude may use what they receive to train their models, depending on your accounts’ settings. We recommend turning that off in each one’s privacy settings.",
    );
  });
});

describe("choosing a provider for the summary above a conversation", () => {
  it("makes an automatic summary a button for Claude or ChatGPT, so each transfer is the person's", () => {
    for (const provider of ["claude", "chatgpt"] as const) {
      expect(readerChoice({ readerSummary: "auto" }, provider)).toEqual({
        readerProvider: provider,
        readerSummary: "button",
      });
    }
  });

  it("leaves Apple Intelligence, which stays on the Mac, automatic", () => {
    expect(readerChoice({ readerSummary: "auto" }, "apple")).toEqual({
      readerProvider: "apple",
      readerSummary: "auto",
    });
  });

  it("keeps a summary that is off or already a button as it was", () => {
    expect(readerChoice({ readerSummary: "off" }, "claude").readerSummary).toBe("off");
    expect(readerChoice({ readerSummary: "button" }, "chatgpt").readerSummary).toBe("button");

describe("the AI choices with their defaults filled in", () => {
  it("keeps saved summaries unless the setting says otherwise", () => {
    expect(aiChoices(undefined).keepSummaries).toBe(true);
    expect(aiChoices({ ai: {} } as never).keepSummaries).toBe(true);
    expect(aiChoices({ ai: { keepSummaries: false } } as never).keepSummaries).toBe(false);
  });
});
