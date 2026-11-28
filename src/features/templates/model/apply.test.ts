import { describe, expect, it } from "vitest";
import type { Identity } from "../../../platform/tauri/bindings";
import { newDraft } from "../../compose/model/draft";
import { recentFirst, withTemplateFields } from "./apply";

const identities: Identity[] = [
  {
    accountId: 1,
    email: "alex@rivera.example",
    name: "Alex Rivera",
    isPrimary: true,
    isDefault: true,
    signature: "<div>Alex</div>",
  },
  {
    accountId: 2,
    email: "alex@northwind.example",
    name: "Alex Rivera",
    isPrimary: true,
    isDefault: true,
    signature: "<div>Alex Rivera, Northwind</div>",
  },
];
const board = { name: "Change board", email: "change-board@northwind.example" };
const priya = { name: "Priya Raman", email: "priya@northwind.example" };
const maya = { name: "Maya Chen", email: "maya@x.example" };
const template = { from: "ALEX@northwind.example", to: [board], cc: [priya], bcc: [] };

describe("withTemplateFields", () => {
  it("fills a blank new message: From with its signature, people and subject", () => {
    const d = withTemplateFields(
      newDraft(identities, 1, "alex@rivera.example"),
      template,
      identities,
      "Change control: January 2027",
    );
    expect(d.accountId).toBe(2);
    expect(d.from.email).toBe("alex@northwind.example");
    expect(d.signature).toContain("Northwind");
    expect(d.to).toEqual([board]);
    expect(d.cc).toEqual([priya]);
    expect(d.showCc).toBe(true);
    expect(d.showBcc).toBe(false);
    expect(d.subject).toBe("Change control: January 2027");
  });

  it("never replaces what's there", () => {
    const start = {
      ...newDraft(identities, 1, "alex@rivera.example"),
      to: [maya],
      subject: "Mine",
      edited: true,
    };
    const d = withTemplateFields(start, template, identities, "Change control");
    expect(d.from.email).toBe("alex@rivera.example");
    expect(d.to).toEqual([maya]);
    expect(d.cc).toEqual([priya]);
    expect(d.subject).toBe("Mine");
  });

  it("keeps From when the template's address is no longer yours", () => {
    const d = withTemplateFields(
      newDraft(identities, 1, "alex@rivera.example"),
      { ...template, from: "old@northwind.example" },
      identities,
      "",
    );
    expect(d.from.email).toBe("alex@rivera.example");
    expect(d.to).toEqual([board]);
  });

  it("leaves a reply's people and subject alone", () => {
    const reply = {
      ...newDraft(identities, 1, "alex@rivera.example"),
      kind: "reply" as const,
      subject: "Re: x",
    };
    expect(withTemplateFields(reply, template, identities, "Change control")).toBe(reply);
  });
});

describe("recentFirst", () => {
  it("puts the most recently used first, then the rest by name", () => {
    const list = [
      { name: "beta", usedAt: null },
      { name: "Alpha", usedAt: null },
      { name: "used long ago", usedAt: 10 },
      { name: "used now", usedAt: 20 },
    ];
    expect(recentFirst(list).map((t) => t.name)).toEqual([
      "used now",
      "used long ago",
      "Alpha",
      "beta",
    ]);
  });
});
