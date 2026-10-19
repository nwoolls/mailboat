import type {
  Category,
  Importance,
  LabelId,
  Rule,
  RuleActions,
  RuleCriteria,
  SizeComparison,
} from "../../../platform/tauri/bindings";

export type SizeUnit = "mb" | "kb" | "bytes";

/** Bytes per unit. Gmail's filter form counts a megabyte as 1,048,576 bytes. */
const UNIT_BYTES: Record<SizeUnit, number> = { mb: 1024 * 1024, kb: 1024, bytes: 1 };

/** Gmail stores a filter's size as a 32-bit number of bytes. */
const MAX_BYTES = 4_294_967_295;

/** The rule editor's fields, as typed (the size stays text until saved). */
export type RuleForm = {
  from: string;
  to: string;
  subject: string;
  hasWords: string;
  doesntHave: string;
  hasAttachment: boolean;
  sizeComparison: SizeComparison;
  sizeValue: string;
  sizeUnit: SizeUnit;
  skipInbox: boolean;
  markRead: boolean;
  star: boolean;
  labels: LabelId[];
  neverSpam: boolean;
  trash: boolean;
  importance: Importance;
  category: Category | null;
  /** Set in Gmail; shown and kept, never edited here. */
  forwardTo: string | null;
  applyToExisting: boolean;
};

export function emptyForm(criteria: Partial<RuleCriteria> = {}): RuleForm {
  return {
    from: criteria.from ?? "",
    to: criteria.to ?? "",
    subject: criteria.subject ?? "",
    hasWords: criteria.hasWords ?? "",
    doesntHave: criteria.doesntHave ?? "",
    hasAttachment: criteria.hasAttachment ?? false,
    sizeComparison: "larger",
    sizeValue: "",
    sizeUnit: "mb",
    skipInbox: false,
    markRead: false,
    star: false,
    labels: [],
    neverSpam: false,
    trash: false,
    importance: "leave",
    category: null,
    forwardTo: null,
    applyToExisting: false,
  };
}

/** A size in the largest unit that shows it as a whole number. */
export function sizeParts(bytes: number): { value: string; unit: SizeUnit } {
  for (const unit of ["mb", "kb"] as const) {
    if (bytes >= UNIT_BYTES[unit] && bytes % UNIT_BYTES[unit] === 0)
      return { value: String(bytes / UNIT_BYTES[unit]), unit };
  }
  return { value: String(bytes), unit: "bytes" };
}

export function formFromRule(rule: Rule): RuleForm {
  const { criteria: c, actions: a } = rule;
  const size = c.size ? sizeParts(c.size.bytes) : null;
  return {
    ...emptyForm(c),
    sizeComparison: c.size?.comparison ?? "larger",
    sizeValue: size?.value ?? "",
    sizeUnit: size?.unit ?? "mb",
    skipInbox: a.skipInbox,
    markRead: a.markRead,
    star: a.star,
    labels: a.labels,
    neverSpam: a.neverSpam,
    trash: a.trash,
    importance: a.importance,
    category: a.category,
    forwardTo: a.forwardTo,
  };
}

/** The size in bytes, null when blank, or why it can't be used. */
function sizeBytes(form: RuleForm): number | null | { problem: string } {
  const text = form.sizeValue.trim();
  if (text === "") return null;
  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0)
    return { problem: "The size needs to be a number above zero." };
  const bytes = Math.round(value * UNIT_BYTES[form.sizeUnit]);
  if (bytes > MAX_BYTES) return { problem: "Gmail only takes sizes up to 4,095 MB." };
  return bytes;
}

export function toCriteria(form: RuleForm): RuleCriteria {
  const bytes = sizeBytes(form);
  return {
    from: form.from.trim(),
    to: form.to.trim(),
    subject: form.subject.trim(),
    hasWords: form.hasWords.trim(),
    doesntHave: form.doesntHave.trim(),
    hasAttachment: form.hasAttachment,
    size: typeof bytes === "number" ? { comparison: form.sizeComparison, bytes } : null,
  };
}

export function toActions(form: RuleForm): RuleActions {
  return {
    skipInbox: form.skipInbox,
    markRead: form.markRead,
    star: form.star,
    labels: form.labels,
    neverSpam: form.neverSpam,
    trash: form.trash,
    importance: form.importance,
    category: form.category,
    forwardTo: form.forwardTo,
  };
}

export function hasCriteria(c: RuleCriteria): boolean {
  return (
    [c.from, c.to, c.subject, c.hasWords, c.doesntHave].some((s) => s.trim() !== "") ||
    c.hasAttachment ||
    c.size !== null
  );
}

function hasAction(form: RuleForm): boolean {
  return (
    form.skipInbox ||
    form.markRead ||
    form.star ||
    form.labels.length > 0 ||
    form.neverSpam ||
    form.trash ||
    form.importance !== "leave" ||
    form.category !== null ||
    form.forwardTo !== null
  );
}

/** Why the rule can't be saved yet, or null. Mirrors the checks in Rust. */
export function formProblem(form: RuleForm): string | null {
  const size = sizeBytes(form);
  if (size !== null && typeof size === "object") return size.problem;
  if (!hasCriteria(toCriteria(form)))
    return "Say which mail the rule is for: fill in From, To, Subject, the words, or a size.";
  if (!hasAction(form)) return "Choose at least one thing the rule does.";
  return null;
}
