import { describe, expect, it } from "vitest";
import type { ArrivedCode } from "../../../platform/tauri/bindings";
import { current, MAX_NOTICES, NOTICE_LIFETIME_MS, withCode } from "./notices";

const code = (messageId: number, value = "123456"): ArrivedCode => ({
  messageId,
  threadId: messageId,
  accountId: 1,
  code: value,
  sender: "Spotify",
  subject: "Your login code",
});

describe("sign-in code notices", () => {
  it("puts the newest first, once, and keeps a few", () => {
    let list = withCode([], code(1), 0);
    list = withCode(list, code(2), 1);
    list = withCode(list, code(1, "999999"), 2);
    expect(list.map((n) => [n.messageId, n.code])).toEqual([
      [1, "999999"],
      [2, "123456"],
    ]);
    for (let i = 10; i < 20; i++) list = withCode(list, code(i), i);
    expect(list).toHaveLength(MAX_NOTICES);
    expect(list[0]!.messageId).toBe(19);
  });

  it("lets codes go once they'd have expired", () => {
    const list = withCode([], code(1), 0);
    expect(current(list, NOTICE_LIFETIME_MS - 1)).toHaveLength(1);
    expect(current(list, NOTICE_LIFETIME_MS)).toHaveLength(0);
  });
});
