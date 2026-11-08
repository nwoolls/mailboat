import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiSettings, ProviderStatus } from "../../../platform/tauri/bindings";

let ai: AiSettings = {};
const ready = (provider: ProviderStatus["provider"]): ProviderStatus =>
  ({ provider, state: "ready", account: null }) as ProviderStatus;

vi.mock("../../../shared/lib/queries", () => ({
  useAppSettings: () => ({ data: { ai } }),
  useSaveAppSettings: () => ({ mutate: vi.fn() }),
  useAiStatus: () => ({ data: [ready("apple"), ready("claude"), ready("chatgpt")] }),
  useAiConnect: () => ({ mutate: vi.fn(), isPending: false }),
  useAiDisconnect: () => ({ mutate: vi.fn() }),
  useAiUsage: () => ({ data: { providers: [], limits: [] } }),
  useChatgptModels: () => ({ data: [] }),
}));
vi.mock("./CodexNotice", () => ({ CodexNoticeCard: () => null }));
vi.mock("../../mcp/ui/AiAppsGroups", () => ({ AiAppsGroups: () => null }));

const { AiSection } = await import("./AiSection");

afterEach(cleanup);

describe("AiSection's model-training note", () => {
  it("shows nothing while every feature stays on the Mac, even with a provider connected", () => {
    ai = {};
    render(<AiSection />);
    expect(screen.queryByRole("note")).toBeNull();
    cleanup();
    // Connected, but no feature uses it: it receives nothing, so no warning.
    ai = { connected: ["claude", "chatgpt"] };
    render(<AiSection />);
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("names the provider once Claude is connected and chosen for writing", () => {
    ai = { connected: ["claude"], writingProvider: "claude" };
    render(<AiSection />);
    expect(screen.getByRole("note").textContent).toBe(
      "Claude may use what it receives to train its models, depending on your account’s settings. We recommend turning that off in Claude’s privacy settings.",
    );
  });

  it("names both when two are in use, and leaves out one the features don't use", () => {
    ai = {
      connected: ["chatgpt", "claude"],
      listSummaries: "chatgpt",
      readerSummary: "off",
      writingProvider: "claude",
    };
    render(<AiSection />);
    expect(screen.getByRole("note").textContent).toContain("ChatGPT and Claude may use");
    cleanup();
    ai = { connected: ["chatgpt", "claude"], readerSummary: "off", writingProvider: "claude" };
    render(<AiSection />);
    expect(screen.getByRole("note").textContent).toMatch(/^Claude may use/);
  });
});
