import { describe, expect, it } from "vitest";
import { newDraft } from "../../compose/model/draft";
import { chatMessage, suggestions, toTurns, writeRequest } from "./chat";

const blankDraft = () => newDraft([], 1, "me@x.example");

describe("writing assistant chat", () => {
  it("leaves failed requests out of what the model hears", () => {
    const chat = [
      chatMessage({ role: "user", text: "Say yes" }),
      chatMessage({ role: "assistant", text: "Couldn't reach Claude", error: true }),
      chatMessage({ role: "user", text: "Say yes" }),
    ];
    expect(toTurns(chat)).toEqual([
      { role: "user", text: "Say yes" },
      { role: "user", text: "Say yes" },
    ]);
  });

  it("asks with the conversation for replies and none for new mail", () => {
    const reply = {
      ...blankDraft(),
      kind: "reply" as const,
      threadId: 7,
      edited: true,
      text: "ok",
    };
    const r = writeRequest(reply, [chatMessage({ role: "user", text: "Warmer" })]);
    expect(r.threadId).toBe(7);
    expect(r.kind).toBe("reply");
    expect(r.draft).toBe("ok");
    expect(r.chat).toEqual([{ role: "user", text: "Warmer" }]);
    const fresh = writeRequest({ ...blankDraft(), threadId: 7 }, []);
    expect(fresh.threadId).toBeNull();
    // An untouched editor (just the signature or quote) isn't a draft.
    expect(fresh.draft).toBe("");
    expect(suggestions("new").length).toBeGreaterThan(0);
  });
});
