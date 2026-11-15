import { describe, expect, it } from "vitest";
import type { MessageMeta } from "../../../platform/tauri/bindings";
import { messageCount, printedHeader, printedMessages } from "./print";

function message(over: Partial<MessageMeta>): MessageMeta {
  return {
    id: 1,
    accountId: 1,
    threadId: 1,
    from: { name: "Maya Chen", email: "maya@x.example" },
    to: [{ name: "Priya Raman", email: "priya@x.example" }],
    cc: [],
    subject: "Venue walkthrough",
    snippet: "",
    internalDate: Date.UTC(2026, 10, 12, 17, 14),
    unread: false,
    starred: false,
    hasAttachments: false,
    draft: false,
    ...over,
  };
}

describe("printed conversation", () => {
  it("holds every sent email, oldest first, and no drafts", () => {
    const list = [
      message({ id: 3, internalDate: 300 }),
      message({ id: 1, internalDate: 100 }),
      message({ id: 4, internalDate: 400, draft: true }),
      message({ id: 2, internalDate: 200 }),
    ];
    expect(printedMessages(list).map((m) => m.id)).toEqual([1, 2, 3]);
    // The conversation as given is left as it was.
    expect(list.map((m) => m.id)).toEqual([3, 1, 4, 2]);
  });

  it("names the sender and recipients in full, leaving out empty lines", () => {
    const header = printedHeader(
      message({
        cc: [{ name: null, email: "jordan@x.example" }],
      }),
      "en-US",
    );
    expect(header.from).toBe("Maya Chen <maya@x.example>");
    expect(header.recipients).toEqual([
      "To: Priya Raman <priya@x.example>",
      "Cc: jordan@x.example",
    ]);
    expect(header.date).toMatch(/2026/);
    expect(printedHeader(message({ to: [] })).recipients).toEqual([]);
  });

  it("counts messages", () => {
    expect(messageCount(1)).toBe("1 message");
    expect(messageCount(3)).toBe("3 messages");
  });
});
