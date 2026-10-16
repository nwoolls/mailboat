import { describe, expect, it } from "vitest";
import type { Identity } from "../../../platform/tauri/bindings";
import {
  close,
  EMPTY,
  openCard,
  openReply,
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
    text: "\n\n> quote",
    initialText: "\n\n> quote",
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
    s = updateDraft(s, id, (d) => ({ ...d, text: `Hi${d.text}` }));
    s = openReply(s, reply(1, "forward"));
    expect(replyIn(s, 1)?.draft.kind).toBe("reply");
    expect(replyIn(s, 1)?.focusKey).toBe(1);
  });

  it("a card with writing in it stays open", () => {
    let s = openCard(EMPTY, newDraft(identities, 1, "me@x.com"));
    const id = s.card!.draft.id;
    s = updateDraft(s, id, (d) => ({ ...d, subject: "Hello" }));
    s = openCard(s, newDraft(identities, 1, "me@x.com"));
    expect(s.card?.draft.id).toBe(id);
  });

  it("editing clears a send error; closing removes the draft", () => {
    let s = openCard(EMPTY, newDraft(identities, 1, "me@x.com"));
    const id = s.card!.draft.id;
    s = setSending(s, id, false, "Network error");
    expect(s.card?.error).toBe("Network error");
    s = updateDraft(s, id, (d) => ({ ...d, subject: "x" }));
    expect(s.card?.error).toBeNull();
    expect(close(s, id).card).toBeNull();
  });
});
