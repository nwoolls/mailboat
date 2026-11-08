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

/** The heading of the group a note sits directly under. */
function groupAbove(note: HTMLElement): string | null {
  return note.previousElementSibling?.querySelector("h2")?.textContent ?? null;
}

/** The nth training line on the page (a missing one fails the test with a clear message). */
function noteAt(index: number): HTMLElement {
  const note = screen.getAllByRole("note")[index];
  if (!note) throw new Error(`There is no training line number ${index + 1} on the page`);
  return note;
}

describe("AiSection's model-training notes", () => {
  it("show nothing while every feature stays on the Mac, even with a provider connected", () => {
    ai = {};
    render(<AiSection />);
    expect(screen.queryByRole("note")).toBeNull();
    cleanup();
    // Connected, but no feature uses it: it receives nothing, so no warning.
    ai = { connected: ["claude", "chatgpt"] };
    render(<AiSection />);
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("put a provider chosen for writing under Writing, and only there", () => {
    ai = { connected: ["claude"], writingProvider: "claude", readerSummary: "off" };
    render(<AiSection />);
    expect(screen.getAllByRole("note")).toHaveLength(1);
    expect(groupAbove(noteAt(0))).toBe("Writing");
    expect(noteAt(0).textContent).toBe(
      "Claude may use what it receives to train its models, depending on your account’s settings. We recommend turning that off in Claude’s privacy settings.",
    );
  });

  it("start with an information icon that is hidden from screen readers", () => {
    ai = { connected: ["claude"], writingProvider: "claude" };
    render(<AiSection />);
    const icon = noteAt(0).querySelector("svg");
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
    expect(icon?.getAttribute("class")).toContain("text-info");
  });

  it("put a provider chosen for summaries under Summaries, next to the choice, and only there", () => {
    ai = { connected: ["chatgpt"], listSummaries: "chatgpt", readerSummary: "off" };
    render(<AiSection />);
    expect(screen.getAllByRole("note")).toHaveLength(1);
    expect(groupAbove(noteAt(0))).toBe("Summaries");
    expect(noteAt(0).textContent).toMatch(/^ChatGPT may use what it receives/);
  });

  it("give each group its own providers when both use one", () => {
    ai = {
      connected: ["chatgpt", "claude"],
      listSummaries: "chatgpt",
      readerSummary: "button",
      readerProvider: "claude",
      writingProvider: "claude",
    };
    render(<AiSection />);
    expect(screen.getAllByRole("note")).toHaveLength(2);
    expect(groupAbove(noteAt(0))).toBe("Summaries");
    expect(noteAt(0).textContent).toContain("ChatGPT and Claude may use");
    expect(groupAbove(noteAt(1))).toBe("Writing");
    expect(noteAt(1).textContent).toMatch(/^Claude may use/);
  });
});
