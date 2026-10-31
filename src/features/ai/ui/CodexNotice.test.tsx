import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CodexCheck } from "../../../platform/tauri/bindings";

let check: CodexCheck = { unreviewed: [], accepted: false, failed: false };
const refetch = vi.fn();
const accept = vi.fn();
vi.mock("../../../shared/lib/queries", () => ({
  useCodexCheck: () => ({ data: check, dataUpdatedAt: Date.now(), isFetching: false, refetch }),
  useCodexAccept: () => ({ mutate: accept, isPending: false }),
}));

const { CodexNoticeCard } = await import("./CodexNotice");

afterEach(cleanup);

describe("CodexNoticeCard", () => {
  it("shows nothing when Codex is as reviewed", () => {
    check = { unreviewed: [], accepted: false, failed: false };
    const { container } = render(<CodexNoticeCard connected />);
    expect(container.textContent).toBe("");
  });

  it("pauses ChatGPT, names the switches, and offers Check again and Use anyway", () => {
    check = { unreviewed: ["brand_new_tool"], accepted: false, failed: false };
    render(<CodexNoticeCard connected />);
    expect(screen.getByRole("status").textContent).toContain("ChatGPT is paused");
    expect(screen.getByText("brand_new_tool")).toBeTruthy();
    fireEvent.click(screen.getByText("Check again"));
    expect(refetch).toHaveBeenCalled();
    fireEvent.click(screen.getByText("Use anyway"));
    expect(accept).toHaveBeenCalledWith(["brand_new_tool"]);
  });

  it("has no Use anyway when Codex couldn't be checked", () => {
    check = { unreviewed: [], accepted: false, failed: true };
    render(<CodexNoticeCard connected />);
    expect(screen.getByRole("status").textContent).toContain("couldn’t check");
    expect(screen.queryByText("Use anyway")).toBeNull();
  });
});
