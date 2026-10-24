import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const save = vi.fn();
vi.mock("../../../platform/tauri/bindings", () => ({ commands: {}, events: {} }));
vi.mock("../../../shared/lib/queries", () => ({
  useAppSettings: () => ({ data: { ai: {}, mcp: { read: [], drafts: [] } } }),
  useSaveAppSettings: () => ({ mutate: save }),
  useAccounts: () => ({
    data: [
      { id: 1, email: "me@gmail.com", color: "#f00" },
      { id: 2, email: "me@work.com", color: "#00f" },
    ],
  }),
  useMcpSetup: () => ({
    data: {
      program: "/Applications/Mailboat.app/Contents/MacOS/mailboat",
      claudeCodeCommand: "",
      claudeCodeInstalled: true,
      claudeCodeConnected: false,
      claudeDesktopConnected: true,
    },
  }),
  useMcpConnect: () => ({ mutate: vi.fn(), isPending: false }),
  useMcpLog: () => ({
    data: [
      {
        id: 1,
        at: Date.now(),
        client: "claude-ai",
        tool: "search_mail",
        accountId: null,
        threadId: null,
        subject: null,
        detail: '"invoice": 2 conversations',
        ok: true,
      },
    ],
  }),
}));

const { AiAppsGroups } = await import("./AiAppsGroups");

afterEach(cleanup);

describe("AiAppsGroups", () => {
  it("is off for every account, and allowing drafts shares the account too", () => {
    render(<AiAppsGroups />);
    const read = screen.getByRole("switch", { name: "AI apps can read me@work.com" });
    expect(read.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(screen.getByRole("switch", { name: "AI apps can save drafts in me@work.com" }));
    expect(save.mock.calls[0]![0].mcp).toEqual({ read: [2], drafts: [2] });
  });

  it("lists what AI apps asked for, by app", () => {
    render(<AiAppsGroups />);
    expect(screen.getByText("Searched “invoice”: 2 conversations")).toBeTruthy();
    expect(screen.getByText(/^Claude Desktop · /)).toBeTruthy();
  });
});
