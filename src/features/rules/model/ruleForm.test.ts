import { describe, expect, it } from "vitest";
import type { AccountId, LabelId, Rule } from "../../../platform/tauri/bindings";
import {
  emptyForm,
  formFromRule,
  formProblem,
  labelsForAccount,
  sizeParts,
  toActions,
  toCriteria,
} from "./ruleForm";

const rule: Rule = {
  accountId: 1,
  filterId: "f1",
  criteria: {
    from: "news@x.example",
    to: "",
    subject: "",
    hasWords: "",
    doesntHave: "",
    hasAttachment: true,
    size: { comparison: "smaller", bytes: 5 * 1024 * 1024 },
  },
  actions: {
    skipInbox: true,
    markRead: false,
    star: false,
    labels: [7 as LabelId],
    neverSpam: false,
    trash: false,
    importance: "never",
    category: "updates",
    forwardTo: "me@elsewhere.example",
  },
};

describe("rule form", () => {
  it("round-trips a rule", () => {
    const form = formFromRule(rule);
    expect(form.sizeValue).toBe("5");
    expect(form.sizeUnit).toBe("mb");
    expect(toCriteria(form)).toEqual(rule.criteria);
    expect(toActions(form)).toEqual(rule.actions);
  });

  it("shows a size in the largest whole unit", () => {
    expect(sizeParts(2048)).toEqual({ value: "2", unit: "kb" });
    expect(sizeParts(1500)).toEqual({ value: "1500", unit: "bytes" });
    expect(sizeParts(3 * 1024 * 1024)).toEqual({ value: "3", unit: "mb" });
  });

  it("converts a typed size to bytes, and trims text", () => {
    const form = {
      ...emptyForm({ from: "  a@x.example " }),
      sizeValue: "1.5",
      sizeUnit: "kb" as const,
    };
    expect(toCriteria(form)).toMatchObject({
      from: "a@x.example",
      size: { comparison: "larger", bytes: 1536 },
    });
  });

  it("says what's missing before saving", () => {
    expect(formProblem(emptyForm())).toMatch(/which mail/);
    expect(formProblem(emptyForm({ from: "a@x.example" }))).toMatch(/at least one thing/);
    expect(formProblem({ ...emptyForm({ from: "a@x.example" }), star: true })).toBeNull();
    expect(formProblem({ ...emptyForm(), star: true, sizeValue: "-3" })).toMatch(/number/);
    expect(formProblem({ ...emptyForm(), star: true, sizeValue: "9999" })).toMatch(/4,095 MB/);
    // A size alone is enough to say which mail.
    expect(formProblem({ ...emptyForm(), star: true, sizeValue: "10" })).toBeNull();
  });

  it("starts from what the message suggests", () => {
    const form = emptyForm({ from: "news@x.example" });
    expect(form.from).toBe("news@x.example");
    expect(form.applyToExisting).toBe(false);
  });
});

const labelOf = (
  id: number,
  accountId: number,
  name: string,
  kind: "user" | "system" = "user",
) => ({
  id: id as LabelId,
  accountId: accountId as AccountId,
  name,
  kind,
});

describe("labelsForAccount", () => {
  const labels = [
    labelOf(1, 1, "Receipts"),
    labelOf(2, 1, "Travel"),
    labelOf(3, 2, "Receipts"),
    labelOf(4, 2, "Travel", "system"),
  ];
  it("swaps each label for the other account's of the same name, dropping the rest", () => {
    expect(labelsForAccount([1, 2] as LabelId[], labels, 2 as AccountId)).toEqual([3]);
    expect(labelsForAccount([1, 2] as LabelId[], labels, 1 as AccountId)).toEqual([1, 2]);
    expect(labelsForAccount([99] as LabelId[], labels, 2 as AccountId)).toEqual([]);
  });
});
