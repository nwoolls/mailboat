import { describe, expect, it } from "vitest";
import type { AccountId, LabelId, Rule } from "../../../platform/tauri/bindings";
import { blockRule, criteriaLikeThreads, senderToBlock } from "./likeThis";
import { emptyForm, toActions, toCriteria } from "./ruleForm";
import {
  applyText,
  describeActions,
  describeCriteria,
  matchText,
  quoted,
  ruleMatchesSearch,
  savedMessage,
} from "./summary";

const names = (id: LabelId) => (id === 7 ? "News" : undefined);

describe("rule summaries", () => {
  it("describes what a rule matches", () => {
    expect(
      describeCriteria({
        ...toCriteria(emptyForm({ from: "news@x.example", subject: "Weekly" })),
        hasAttachment: true,
        size: { comparison: "larger", bytes: 2 * 1024 * 1024 },
      }),
    ).toBe("From news@x.example, subject “Weekly”, with an attachment, larger than 2 MB");
  });

  it("never doubles quotes Gmail already stores", () => {
    expect(quoted("Invoice")).toBe("“Invoice”");
    expect(quoted('"weekly report"')).toBe("“weekly report”");
    expect(quoted("“weekly report”")).toBe("“weekly report”");
    expect(quoted('"a" OR "b"')).toBe('"a" OR "b"');
    expect(quoted('from "Sam"')).toBe('from "Sam"');
    expect(
      describeCriteria({
        ...toCriteria(emptyForm({ subject: '"Your order"', hasWords: '"unsubscribe"' })),
      }),
    ).toBe("Subject “Your order”, has “unsubscribe”");
  });

  it("describes what a rule does, skipping labels that are gone", () => {
    const actions = toActions({
      ...emptyForm(),
      skipInbox: true,
      labels: [7 as LabelId, 99 as LabelId],
      importance: "never",
      forwardTo: "me@else.example",
    });
    expect(describeActions(actions, names)).toBe(
      "Skip the Inbox, label “News”, never mark as important, forward to me@else.example",
    );
  });

  it("finds rules by what they match or do", () => {
    const rule: Rule = {
      accountId: 1 as AccountId,
      filterId: "f1",
      criteria: toCriteria(emptyForm({ from: "news@x.example" })),
      actions: toActions({ ...emptyForm(), labels: [7 as LabelId] }),
    };
    expect(ruleMatchesSearch(rule, "NEWS@", names)).toBe(true);
    expect(ruleMatchesSearch(rule, "news”", names)).toBe(true);
    expect(ruleMatchesSearch(rule, "invoice", names)).toBe(false);
    expect(ruleMatchesSearch(rule, "  ", names)).toBe(true);
  });

  it("says what saving did", () => {
    expect(savedMessage(false, null)).toBe("Rule created");
    expect(savedMessage(true, { messages: 0, capped: false })).toBe(
      "Rule saved; no existing mail matched",
    );
    expect(savedMessage(false, { messages: 1234, capped: false })).toBe(
      "Rule created and applied to 1,234 existing messages",
    );
    expect(savedMessage(false, { messages: 10000, capped: true })).toBe(
      "Rule created and applied to the newest 10,000 matching messages",
    );
  });

  it("counts matches", () => {
    expect(matchText(null)).toBe("");
    expect(matchText({ conversations: 0, more: false })).toBe("No conversations match now");
    expect(matchText({ conversations: 1, more: false })).toBe("1 conversation matches now");
    expect(matchText({ conversations: 500, more: true })).toBe("500+ conversations match now");
    expect(applyText(null)).toBe("Also apply to matching mail already here");
    expect(applyText({ conversations: 1, more: false })).toBe(
      "Also apply to the 1 matching conversation already here",
    );
    expect(applyText({ conversations: 500, more: true })).toBe(
      "Also apply to the 500+ matching conversations already here",
    );
  });
});

const self = () => ["me@x.example"];
const thread = (accountId: number, ...emails: string[]) => ({
  accountId: accountId as AccountId,
  senders: emails.map((email) => ({ name: null, email, unread: false })),
});

describe("filter messages like these", () => {
  it("fills From with who started the conversation, not you", () => {
    expect(
      criteriaLikeThreads([thread(1, "me@x.example", "Ann@Y.example", "bob@z.example")], self),
    ).toEqual({
      accountId: 1,
      criteria: { from: "ann@y.example" },
    });
  });

  it("joins several senders with OR, once each", () => {
    const like = criteriaLikeThreads(
      [thread(1, "a@y.example"), thread(1, "b@y.example"), thread(1, "A@y.example")],
      self,
    );
    expect(like?.criteria.from).toBe("a@y.example OR b@y.example");
  });

  it("starts blank for your own conversations, and refuses mixed accounts", () => {
    expect(criteriaLikeThreads([thread(1, "me@x.example")], self)?.criteria).toEqual({});
    expect(
      criteriaLikeThreads([thread(1, "a@y.example"), thread(2, "b@y.example")], self),
    ).toBeNull();
    expect(criteriaLikeThreads([], self)).toBeNull();
  });
});

describe("block sender", () => {
  it("blocks the one person who wrote, not you", () => {
    expect(senderToBlock([thread(1, "me@x.example", "Spam@Y.example")], self)).toEqual({
      accountId: 1,
      email: "spam@y.example",
    });
    // The same sender in several conversations is still one person.
    expect(senderToBlock([thread(1, "a@y.example"), thread(1, "a@y.example")], self)?.email).toBe(
      "a@y.example",
    );
  });

  it("offers nothing for several senders, your own mail, or mixed accounts", () => {
    expect(senderToBlock([thread(1, "a@y.example"), thread(1, "b@y.example")], self)).toBeNull();
    expect(senderToBlock([thread(1, "me@x.example")], self)).toBeNull();
    expect(senderToBlock([thread(1, "a@y.example"), thread(2, "a@y.example")], self)).toBeNull();
  });

  it("makes a rule that deletes their mail and nothing else", () => {
    const rule = blockRule("a@y.example");
    expect(rule.criteria.from).toBe("a@y.example");
    expect(rule.actions.trash).toBe(true);
    expect(describeActions(rule.actions, names)).toBe("Delete");
  });
});
