import { describe, expect, it } from "vitest";
import {
  assistantOpen,
  forgetAssistant,
  openAssistantForNextReply,
  setAssistantOpen,
} from "./assistantOpen";

describe("assistant open state", () => {
  it("is kept per message, so minimising and restoring keeps it", () => {
    const d = { id: 101, kind: "new" as const, threadId: null };
    expect(assistantOpen(d)).toBe(false);
    setAssistantOpen(d, true);
    // A card rebuilt after being minimised asks again: still open.
    expect(assistantOpen({ ...d })).toBe(true);
    forgetAssistant(d);
    expect(assistantOpen(d)).toBe(false);
  });

  it("opens for the next reply in a conversation (Reply with AI), until chosen otherwise", () => {
    openAssistantForNextReply(7);
    const reply = { id: 102, kind: "reply" as const, threadId: 7 };
    expect(assistantOpen(reply)).toBe(true);
    // Not for another conversation, and not for new mail.
    expect(assistantOpen({ id: 103, kind: "reply", threadId: 8 })).toBe(false);
    setAssistantOpen(reply, false);
    expect(assistantOpen(reply)).toBe(false);
    // Used up: the reply after this one starts closed.
    expect(assistantOpen({ id: 104, kind: "reply", threadId: 7 })).toBe(false);
  });

  it("doesn't carry over to the next reply when the first is discarded", () => {
    openAssistantForNextReply(9);
    const reply = { id: 105, kind: "reply" as const, threadId: 9 };
    expect(assistantOpen(reply)).toBe(true);
    // Asked again while it's open (each render): still open.
    expect(assistantOpen(reply)).toBe(true);
    // Discarded (`forgetChat` doesn't know the conversation).
    forgetAssistant({ id: 105, threadId: null });
    expect(assistantOpen({ id: 106, kind: "reply", threadId: 9 })).toBe(false);
  });
});
