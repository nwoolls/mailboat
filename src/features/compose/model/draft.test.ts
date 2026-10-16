import { describe, expect, it } from "vitest";
import type { Address, Identity, ReplySource } from "../../../platform/tauri/bindings";
import {
  accountForNew,
  bodyHtml,
  emailHtml,
  defaultIdentity,
  forwardSubject,
  forwardHtml,
  forwardText,
  hasChanges,
  newDraft,
  quoteHtml,
  quoteText,
  replyDraft,
  replyRecipients,
  replySubject,
  sendProblem,
  toOutgoing,
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
    html: null,
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
  it("quotes the original's own HTML in Gmail's quote block", () => {
    expect(quoteHtml(source({ html: "<table><tr><td><b>Noon?</b></td></tr></table>" }), date)).toBe(
      '<div class="gmail_quote"><p>On Thu, Oct 9, Jane &lt;jane@z.com&gt; wrote:</p>' +
        '<blockquote style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">' +
        "<table><tr><td><b>Noon?</b></td></tr></table></blockquote></div>",
    );
  });

  it("plain-text originals are quoted as escaped paragraphs", () => {
    expect(quoteHtml(source({ text: "a <b>\n\nJ" }), date)).toContain(
      "<p>a &lt;b&gt;</p><p>J</p></blockquote>",
    );
  });

  it("the text copy quotes each line behind >", () => {
    expect(quoteText(source(), date)).toBe(
      "On Thu, Oct 9, Jane <jane@z.com> wrote:\n> Noon?\n>\n> J",
    );
  });

  it("forwards carry the original's headers", () => {
    expect(forwardText(source(), date)).toBe(
      "---------- Forwarded message ---------\nFrom: Jane <jane@z.com>\nDate: Thu, Oct 9\n" +
        "Subject: Lunch\nTo: me@x.com, Bob <bob@z.com>\nCc: carol@z.com\n\nNoon?\n\nJ",
    );
    expect(forwardHtml(source({ html: "<i>x</i>" }), date)).toContain(
      "Cc: carol@z.com</p><i>x</i>",
    );
  });

  it("sending puts the quote after what was written, in both copies", () => {
    const d = replyDraft("reply", source(), identities, "me@x.com", date);
    const out = toOutgoing({ ...d, html: "<p>Sure</p>", text: "Sure" });
    expect(out.text).toBe(`Sure\n\n${d.quoteText}`);
    expect(out.html).toBe(`<p style="margin:0">Sure</p>${d.quote}`);
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
    expect(d.html).toBe("<p></p><p></p>");
    expect(d.quote).toContain("On Thu, Oct 9");
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
    expect(hasChanges({ ...reply, edited: true })).toBe(true);
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

it("sent HTML keeps the editor's spacing and blank lines", () => {
  expect(emailHtml('<p>Hi</p><p></p><p style="text-align: center">x</p>')).toBe(
    '<p style="margin:0">Hi</p><p style="margin:0"><br></p><p style="margin:0;text-align: center">x</p>',
  );
});

describe("signatures", () => {
  const signed: Identity[] = [
    { ...identities[0]!, signature: "<p>— Me</p>" },
    { ...identities[1]!, signature: "<p>— Alias</p>" },
    identities[2]!,
  ];

  it("new mail and replies open with the From address's signature", () => {
    expect(newDraft(signed, ME, "me@x.com").html).toBe("<p></p><p></p><p>— Me</p>");
    const d = replyDraft("reply", source({ to: [a("alias@x.com")] }), signed, "me@x.com", date);
    expect(d.html).toBe("<p></p><p></p><p>— Alias</p>");
    expect(newDraft(signed, OTHER, "work@y.com").html).toBe("");
  });

  it("switching From swaps the signature until something is typed", () => {
    const d = replyDraft("reply", source(), signed, "me@x.com", date);
    const swapped = withIdentity(d, signed[1]!);
    expect(swapped.html).toBe(bodyHtml("<p>— Alias</p>"));
    const typed = withIdentity({ ...d, edited: true, html: "<p>Hi</p>" }, signed[1]!);
    expect(typed.html).toBe("<p>Hi</p>");
  });
});
