import { describe, expect, it } from "vitest";
import type { Identity } from "../../../platform/tauri/bindings";
import {
  close,
  EMPTY,
  expand,
  minimize,
  openCard,
  openCardEntry,
  openReply,
  reopen,
  replyIn,
  setSending,
  updateDraft,
} from "./composeState";
import { type Draft, newDraft } from "./draft";

const identities: Identity[] = [
  {
    accountId: 1,
    email: "me@x.com",
    name: null,
    isPrimary: true,
    isDefault: true,
    signature: null,
  },
];

function reply(threadId: number, kind: Draft["kind"] = "reply"): Draft {
  return {
    ...newDraft(identities, 1, "me@x.com"),
    kind,
    threadId,
    replyingTo: 100 + threadId,
    html: "<p></p><blockquote><p>quote</p></blockquote>",
  };
}

describe("compose state", () => {
  it("keeps one reply per conversation; an untouched one is replaced", () => {
    let s = openReply(EMPTY, reply(1));
    s = openReply(s, reply(2));
    s = openReply(s, reply(1, "replyAll"));
    expect(s.replies).toHaveLength(2);
    expect(replyIn(s, 1)?.draft.kind).toBe("replyAll");
  });

  it("never throws away a reply with writing in it", () => {
    let s = openReply(EMPTY, reply(1));
    const id = s.replies[0]!.draft.id;
    s = updateDraft(s, id, (d) => ({ ...d, edited: true }));
    s = openReply(s, reply(1, "forward"));
    expect(replyIn(s, 1)?.draft.kind).toBe("reply");
    expect(replyIn(s, 1)?.focusKey).toBe(1);
  });

  it("a new message minimises the card with writing in it, and drops an untouched one", () => {
    let s = openCard(EMPTY, newDraft(identities, 1, "me@x.com"));
    s = openCard(s, newDraft(identities, 1, "me@x.com"));
    expect(s.cards).toHaveLength(1);
    const first = s.cards[0]!.draft.id;
    s = updateDraft(s, first, (d) => ({ ...d, subject: "Hello" }));
    s = openCard(s, newDraft(identities, 1, "me@x.com"));
    expect(s.cards.map((c) => c.minimized)).toEqual([true, false]);
    expect(openCardEntry(s)?.draft.id).not.toBe(first);
  });

  it("expanding a tab swaps it with the open card, keeping tab order", () => {
    let s = openCard(EMPTY, newDraft(identities, 1, "me@x.com"));
    const a = s.cards[0]!.draft.id;
    s = updateDraft(s, a, (d) => ({ ...d, subject: "A" }));
    s = openCard(s, newDraft(identities, 1, "me@x.com"));
    const b = s.cards[1]!.draft.id;
    s = updateDraft(s, b, (d) => ({ ...d, subject: "B" }));
    s = expand(s, a);
    expect(s.cards.map((c) => [c.draft.id, c.minimized])).toEqual([
      [a, false],
      [b, true],
    ]);
    expect(openCardEntry(s)?.focusKey).toBe(1);
    s = minimize(s, a);
    expect(openCardEntry(s)).toBeUndefined();
  });

  it("editing clears a send error; closing removes the draft", () => {
    let s = openCard(EMPTY, newDraft(identities, 1, "me@x.com"));
    const id = s.cards[0]!.draft.id;
    s = setSending(s, id, false, "Network error");
    expect(s.cards[0]?.error).toBe("Network error");
    s = updateDraft(s, id, (d) => ({ ...d, subject: "x" }));
    expect(s.cards[0]?.error).toBeNull();
    expect(close(s, id).cards).toEqual([]);
  });

  it("undo send puts the draft back as it was, focused", () => {
    let s = openCard(EMPTY, newDraft(identities, 1, "me@x.com"));
    const sent = s.cards[0]!;
    s = close(s, sent.draft.id);
    s = reopen(s, sent);
    expect(openCardEntry(s)?.draft).toBe(sent.draft);
    expect(openCardEntry(s)?.focusKey).toBe(1);
    let r = openReply(EMPTY, reply(3));
    const answer = r.replies[0]!;
    r = reopen(close(r, answer.draft.id), answer, "Network error");
    expect(replyIn(r, 3)?.error).toBe("Network error");
  });
});
