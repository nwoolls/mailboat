import { describe, expect, it } from "vitest";
import type { Address, Identity, ReplySource } from "../../../platform/tauri/bindings";
import {
  accountForNew,
  defaultIdentity,
  forwardSubject,
  forwardText,
  hasChanges,
  newDraft,
  quoteText,
  replyDraft,
  replyRecipients,
  replySubject,
  sendProblem,
  withIdentity,
} from "./draft";

const a = (email: string, name: string | null = null): Address => ({ name, email });
const ME = 1;
const OTHER = 2;
const identities: Identity[] = [
  {
    accountId: ME,
    email: "me@x.com",
    name: "Me",
    isPrimary: true,
    isDefault: true,
    signature: null,
  },
  {
    accountId: ME,
    email: "alias@x.com",
    name: "Alias",
    isPrimary: false,
    isDefault: false,
    signature: null,
  },
  {
    accountId: OTHER,
    email: "work@y.com",
    name: "Work",
    isPrimary: true,
    isDefault: true,
    signature: null,
  },
];
const date = () => "Thu, Oct 9";

function source(over: Partial<ReplySource> = {}): ReplySource {
  return {
    messageId: 10,
    accountId: ME,
    threadId: 5,
    from: a("jane@z.com", "Jane"),
    to: [a("me@x.com"), a("bob@z.com", "Bob")],
    cc: [a("carol@z.com")],
    replyTo: [],
    subject: "Lunch",
    date: 0,
    text: "Noon?\n\nJ",
    ...over,
  };
}

describe("replyRecipients", () => {
  const mine = ["me@x.com", "alias@x.com"];

  it("reply goes to the sender only", () => {
    expect(replyRecipients(source(), false, mine)).toEqual({
      to: [a("jane@z.com", "Jane")],
      cc: [],
    });
  });

  it("reply honours Reply-To", () => {
    const s = source({ replyTo: [a("list@z.com")] });
    expect(replyRecipients(s, false, mine).to).toEqual([a("list@z.com")]);
  });

  it("reply all keeps everyone but me, without repeats", () => {
    const s = source({ cc: [a("carol@z.com"), a("ALIAS@x.com"), a("bob@z.com")] });
    expect(replyRecipients(s, true, mine)).toEqual({
      to: [a("jane@z.com", "Jane"), a("bob@z.com", "Bob")],
      cc: [a("carol@z.com")],
    });
  });

  it("replying to my own sent mail goes to its recipients again", () => {
    const s = source({ from: a("me@x.com"), to: [a("bob@z.com")], cc: [a("carol@z.com")] });
    expect(replyRecipients(s, false, mine)).toEqual({ to: [a("bob@z.com")], cc: [] });
    expect(replyRecipients(s, true, mine)).toEqual({
      to: [a("bob@z.com")],
      cc: [a("carol@z.com")],
    });
  });

  it("when only Cc'd people are left, they become the To", () => {
    const s = source({ from: a("me@x.com"), to: [a("me@x.com")], cc: [a("carol@z.com")] });
    expect(replyRecipients(s, true, mine)).toEqual({ to: [a("carol@z.com")], cc: [] });
  });
});

describe("subjects", () => {
  it("adds Re: and Fwd: once", () => {
    expect(replySubject("Lunch")).toBe("Re: Lunch");
    expect(replySubject("RE: Lunch")).toBe("RE: Lunch");
    expect(forwardSubject("Lunch")).toBe("Fwd: Lunch");
    expect(forwardSubject("Fw: Lunch")).toBe("Fw: Lunch");
    expect(forwardSubject("Re: Lunch")).toBe("Fwd: Re: Lunch");
  });
});

describe("quoting", () => {
  it("quotes every line under an attribution", () => {
    expect(quoteText(source(), date)).toBe(
      "On Thu, Oct 9, Jane <jane@z.com> wrote:\n> Noon?\n>\n> J",
    );
  });

  it("forwards with the original's headers", () => {
    expect(forwardText(source(), date)).toBe(
      [
        "---------- Forwarded message ---------",
        "From: Jane <jane@z.com>",
        "Date: Thu, Oct 9",
        "Subject: Lunch",
        "To: me@x.com, Bob <bob@z.com>",
        "Cc: carol@z.com",
        "",
        "Noon?",
        "",
        "J",
      ].join("\n"),
    );
  });
});

describe("defaultIdentity", () => {
  it("uses the alias the mail was sent to", () => {
    const s = source({ to: [a("ALIAS@x.com")] });
    expect(defaultIdentity(identities, ME, s)?.email).toBe("alias@x.com");
  });
  it("otherwise the account's default", () => {
    expect(defaultIdentity(identities, ME)?.email).toBe("me@x.com");
    expect(defaultIdentity(identities, OTHER, source())?.email).toBe("work@y.com");
  });
});

describe("drafts", () => {
  it("a reply starts with the quote below room to write, and a fresh subject", () => {
    const d = replyDraft("replyAll", source(), identities, "me@x.com", date);
    expect(d.subject).toBe("Re: Lunch");
    expect(d.text.startsWith("\n\nOn Thu, Oct 9")).toBe(true);
    expect(d.replyingTo).toBe(10);
    expect(d.threadId).toBe(5);
    expect(d.showCc).toBe(true);
    expect(d.from.email).toBe("me@x.com");
  });

  it("a forward has no recipients yet", () => {
    const d = replyDraft("forward", source(), identities, "me@x.com", date);
    expect(d.to).toEqual([]);
    expect(d.subject).toBe("Fwd: Lunch");
    expect(sendProblem(d)).toBe("Add at least one recipient.");
  });

  it("flags invalid recipients", () => {
    const d = { ...newDraft(identities, ME, "me@x.com"), to: [a("bob")] };
    expect(sendProblem(d)).toBe("“bob” isn’t a valid email address.");
    expect(sendProblem({ ...d, to: [a("bob@z.com")] })).toBeNull();
  });

  it("knows when closing would lose something", () => {
    const fresh = newDraft(identities, ME, "me@x.com");
    expect(hasChanges(fresh)).toBe(false);
    expect(hasChanges({ ...fresh, subject: "Hi" })).toBe(true);
    const reply = replyDraft("reply", source(), identities, "me@x.com", date);
    expect(hasChanges(reply)).toBe(false);
    expect(hasChanges({ ...reply, text: `Sure!${reply.text}` })).toBe(true);
  });

  it("choosing another account's address moves the draft to that account", () => {
    const d = withIdentity(newDraft(identities, ME, "me@x.com"), identities[2]!);
    expect(d.accountId).toBe(OTHER);
    expect(d.from).toEqual({ name: "Work", email: "work@y.com" });
  });
});

it("new mail starts from the account being viewed, else the first", () => {
  expect(accountForNew({ kind: "only", ids: [2] }, [1, 2])).toBe(2);
  expect(accountForNew({ kind: "all" }, [1, 2])).toBe(1);
  expect(accountForNew({ kind: "only", ids: [1, 2] }, [1, 2])).toBe(1);
  expect(accountForNew({ kind: "all" }, [])).toBeUndefined();
});
