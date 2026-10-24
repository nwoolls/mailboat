import { describe, expect, it } from "vitest";
import type { AccountId } from "../../../platform/tauri/bindings";
import { clientName, describeRequest, mcpAccess, NO_ACCESS, setAccess } from "./access";

const a = 1 as AccountId;
const b = 2 as AccountId;

describe("access", () => {
  it("shares nothing until turned on", () => {
    expect(mcpAccess(undefined)).toEqual(NO_ACCESS);
  });

  it("allowing drafts allows reading; stopping reading stops drafts", () => {
    const drafts = setAccess(NO_ACCESS, a, "drafts", true);
    expect(drafts).toEqual({ read: [a], drafts: [a] });
    expect(setAccess(drafts, a, "read", false)).toEqual(NO_ACCESS);
    expect(setAccess(drafts, a, "drafts", false)).toEqual({ read: [a], drafts: [] });
  });

  it("leaves other accounts alone", () => {
    const both = setAccess(setAccess(NO_ACCESS, a, "read", true), b, "drafts", true);
    expect(setAccess(both, a, "read", false)).toEqual({ read: [b], drafts: [b] });
  });
});

describe("the request log", () => {
  it("names Claude's apps", () => {
    expect(clientName("claude-ai")).toBe("Claude Desktop");
    expect(clientName("cursor")).toBe("cursor");
  });

  it("says what was asked", () => {
    const e = { ok: true, subject: null };
    expect(
      describeRequest({ ...e, tool: "search_mail", detail: '"invoice": 3 conversations' }),
    ).toBe("Searched “invoice”: 3 conversations");
    expect(
      describeRequest({ ...e, tool: "read_conversation", detail: "2 emails", subject: "Lunch" }),
    ).toBe("Read “Lunch” (2 emails)");
    expect(
      describeRequest({ ...e, tool: "list_conversations", detail: "all_mail: 20 conversations" }),
    ).toBe("Listed all mail: 20 conversations");
    expect(describeRequest({ ...e, ok: false, tool: "create_draft", detail: "" })).toBe(
      "Saved a draft (refused)",
    );
    expect(describeRequest({ ...e, ok: false, tool: "read_conversation", detail: "" })).toBe(
      "Tried to read a conversation",
    );
  });
});
