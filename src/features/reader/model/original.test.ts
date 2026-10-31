import { describe, expect, it } from "vitest";
import type { MessageMeta, Original } from "../../../platform/tauri/bindings";
import { checkText, failed, startingEmail, summaryRows } from "./original";

const meta = (id: number, internalDate: number, draft = false): MessageMeta => ({
  id,
  accountId: 1,
  threadId: 1,
  from: { name: null, email: "a@x.example" },
  to: [],
  cc: [],
  subject: "",
  snippet: "",
  internalDate,
  unread: false,
  starred: false,
  hasAttachments: false,
  draft,
});

const original: Original = {
  messageId: "<a@x.example>",
  date: Date.UTC(2026, 9, 24, 13, 15),
  from: "Ann <a@x.example>",
  to: "me@gmail.com",
  cc: null,
  subject: "",
  checks: [
    { method: "SPF", result: "pass", detail: "x.example" },
    { method: "DMARC", result: "fail", detail: null },
  ],
  source: "",
  truncated: false,
  size: 10,
};

describe("startingEmail", () => {
  it("is the newest email, a draft only if there's nothing else", () => {
    expect(startingEmail([meta(1, 10), meta(2, 30), meta(3, 50, true)])?.id).toBe(2);
    expect(startingEmail([meta(3, 50, true)])?.id).toBe(3);
    expect(startingEmail([])).toBeNull();
  });
});

describe("summaryRows", () => {
  it("lists what's there in Gmail's order, with the checks last", () => {
    const rows = summaryRows(original, "en-US");
    expect(rows.map(([name]) => name)).toEqual([
      "Message ID",
      "Created at",
      "From",
      "To",
      "SPF",
      "DMARC",
    ]);
    expect(rows[4]![1]).toBe("PASS with domain x.example");
    expect(rows[5]![1]).toBe("FAIL");
  });
});

describe("checks", () => {
  it("marks anything but a pass", () => {
    expect(checkText({ method: "DKIM", result: "pass", detail: null })).toBe("PASS");
    expect(failed({ method: "DKIM", result: "softfail", detail: null })).toBe(true);
    expect(failed({ method: "DKIM", result: "pass", detail: null })).toBe(false);
  });
});
