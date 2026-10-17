import { describe, expect, it } from "vitest";
import type { Address, Identity, ReplySource } from "../../../platform/tauri/bindings";
import {
  accountForNew,
  attachmentSize,
  MAX_ATTACHMENT_BYTES,
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
  resumedDraft,
  replyRecipients,
  replySubject,
  sendProblem,
  toOutgoing,
  trimSignature,
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
    attachments: [],
    inlineImages: [],
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
    expect(out.html).toBe(`<p style="margin:0">Sure</p><div><br></div>${d.quote}`);
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
    expect(d.html).toBe("");
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
  const sig = '<div><font color="#1c3a6b" size="4"><b>Jordan</b></font><br>Architect</div>';
  const signed: Identity[] = [
    { ...identities[0]!, signature: sig },
    { ...identities[1]!, signature: "<p>— Alias</p><p><br></p>" },
    identities[2]!,
  ];

  it("keep Gmail's HTML as is (outside the editor), minus trailing empty lines", () => {
    const d = newDraft(signed, ME, "me@x.com");
    expect(d.html).toBe("");
    expect(d.signature).toBe(sig);
    const r = replyDraft("reply", source({ to: [a("alias@x.com")] }), signed, "me@x.com", date);
    expect(r.signature).toBe("<p>— Alias</p>");
    expect(newDraft(signed, OTHER, "work@y.com").signature).toBe("");
    expect(trimSignature("<p>Jordan</p><p><br></p><div>&nbsp;</div><br>")).toBe("<p>Jordan</p>");
  });

  it("switching From swaps the signature, even after typing", () => {
    const d = { ...replyDraft("reply", source(), signed, "me@x.com", date), edited: true };
    const swapped = withIdentity(d, signed[1]!);
    expect(swapped.signature).toBe("<p>— Alias</p>");
    expect(swapped.edited).toBe(true);
  });

  it("is sent after a blank line, in Gmail's wrapper, before the quote", () => {
    const d = replyDraft("reply", source(), signed, "me@x.com", date);
    const out = toOutgoing({ ...d, html: "<p>Hi</p>", text: "Hi" });
    expect(out.html).toBe(
      `<p style="margin:0">Hi</p><div><br></div><div class="gmail_signature">${sig}</div>` +
        `<div><br></div>${d.quote}`,
    );
    expect(out.text).toBe(`Hi\n\nJordan\nArchitect\n\n${d.quoteText}`);
  });
});

it("attachments count as changes, report their size, and respect Gmail's limit", () => {
  const d = { ...newDraft(identities, ME, "me@x.com"), to: [a("b@z.com")] };
  const file = { filename: "a.txt", mimeType: "text/plain", data: "aGVsbG8=" };
  expect(attachmentSize(file)).toBe(5);
  expect(hasChanges({ ...d, to: [], attachments: [file] })).toBe(true);
  expect(toOutgoing({ ...d, attachments: [file] }).attachments).toEqual([file]);
  const huge = { ...file, data: "A".repeat(Math.ceil((MAX_ATTACHMENT_BYTES * 4) / 3) + 8) };
  expect(sendProblem({ ...d, attachments: [huge] })).toBe(
    "Attachments are over Gmail’s 25 MB limit.",
  );
});

it("a resumed draft goes inline when it's a reply, in the card otherwise", () => {
  const opened = {
    draft: 9,
    accountId: ME,
    threadId: 5,
    from: a("me@x.com"),
    to: [a("bob@z.com")],
    cc: [],
    bcc: [a("boss@x.com")],
    subject: "Re: Lunch",
    html: "<p>Sure</p>",
    text: "Sure",
    replyingTo: 10,
    files: [{ filename: "a.txt", mimeType: "text/plain", data: "aGk=" }],
  };
  const reply = resumedDraft(opened, 77);
  expect(reply.attachments.map((f) => f.filename)).toEqual(["a.txt"]);
  expect(reply.resumedFrom).toBe(77);
  expect([reply.kind, reply.threadId, reply.savedId, reply.showBcc]).toEqual(["reply", 5, 9, true]);
  expect(reply.signature).toBe("");
  const fresh = resumedDraft({ ...opened, replyingTo: null, html: "", text: "a\n\nb" }, 78);
  expect([fresh.kind, fresh.threadId, fresh.html]).toEqual(["new", null, "<p>a</p><p>b</p>"]);
});

it("a forward carries the original's files; replies don't", () => {
  const pdf = { id: 3, messageId: 10, filename: "plan.pdf", mimeType: "application/pdf", size: 9 };
  const fwd = replyDraft("forward", source({ attachments: [pdf] }), identities, "me@x.com", date);
  expect(fwd.forwarded).toEqual([pdf]);
  expect(toOutgoing({ ...fwd, to: [a("b@z.com")] }).forwarded).toEqual([3]);
  expect(
    replyDraft("reply", source({ attachments: [pdf] }), identities, "me@x.com", date).forwarded,
  ).toEqual([]);
});

it("replies and forwards carry the quote's embedded images", () => {
  const d = replyDraft("reply", source({ inlineImages: [7] }), identities, "me@x.com", date);
  expect(toOutgoing({ ...d, to: [a("b@z.com")] }).inlineImages).toEqual([7]);
});
