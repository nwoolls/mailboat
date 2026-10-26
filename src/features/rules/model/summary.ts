import type {
  Category,
  LabelId,
  Rule,
  RuleActions,
  RuleCriteria,
} from "../../../platform/tauri/bindings";
import { sizeParts } from "./ruleForm";
import { APP_NAME } from "../../../shared/lib/brand";

export const CATEGORY_NAMES: Record<Category, string> = {
  primary: "Primary",
  social: "Social",
  updates: "Updates",
  forums: "Forums",
  promotions: "Promotions",
};

const UNIT_NAMES = { mb: "MB", kb: "KB", bytes: "bytes" } as const;

function sentence(parts: string[]): string {
  const text = parts.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * A typed value in curly quotes, without doubling quotes it already has
 * (Gmail searches often hold a quoted phrase: `"weekly report"`). A value
 * with quotes inside (`"a" OR "b"`) is shown as written.
 */
export function quoted(value: string): string {
  const v = value.trim();
  const inner = /^["“](.*)["”]$/.exec(v)?.[1];
  if (inner !== undefined && !/["“”]/.test(inner)) return `“${inner}”`;
  return /["“”]/.test(v) ? v : `“${v}”`;
}

/** Which mail a rule is for: "From news@x.com, subject “Invoice”, with an attachment". */
export function describeCriteria(c: RuleCriteria): string {
  const parts: string[] = [];
  if (c.from) parts.push(`from ${c.from}`);
  if (c.to) parts.push(`to ${c.to}`);
  if (c.subject) parts.push(`subject ${quoted(c.subject)}`);
  if (c.hasWords) parts.push(`has ${quoted(c.hasWords)}`);
  if (c.doesntHave) parts.push(`doesn’t have ${quoted(c.doesntHave)}`);
  if (c.hasAttachment) parts.push("with an attachment");
  if (c.size) {
    const { value, unit } = sizeParts(c.size.bytes);
    parts.push(
      `${c.size.comparison === "larger" ? "larger" : "smaller"} than ${value} ${UNIT_NAMES[unit]}`,
    );
  }
  return parts.length ? sentence(parts) : "All mail";
}

/**
 * What a rule does: "Skip the Inbox, label “News”, mark as read". Labels
 * the account no longer has are left out.
 */
export function describeActions(
  a: RuleActions,
  labelName: (id: LabelId) => string | undefined,
): string {
  const parts: string[] = [];
  if (a.skipInbox) parts.push("skip the Inbox");
  if (a.markRead) parts.push("mark as read");
  if (a.star) parts.push("star");
  for (const id of a.labels) {
    const name = labelName(id);
    if (name) parts.push(`label ${quoted(name)}`);
  }
  if (a.category) parts.push(`categorize as ${CATEGORY_NAMES[a.category]}`);
  if (a.importance === "always") parts.push("mark as important");
  if (a.importance === "never") parts.push("never mark as important");
  if (a.neverSpam) parts.push("never send to Spam");
  if (a.trash) parts.push("delete");
  if (a.forwardTo) parts.push(`forward to ${a.forwardTo}`);
  return parts.length ? sentence(parts) : `Nothing ${APP_NAME} can show`;
}

/** Whether a rule mentions the search text (in what it matches or does). */
export function ruleMatchesSearch(
  rule: Rule,
  search: string,
  labelName: (id: LabelId) => string | undefined,
): boolean {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  const text = `${describeCriteria(rule.criteria)} ${describeActions(rule.actions, labelName)}`;
  return text.toLowerCase().includes(needle);
}

/** "Rule created", with what applying it to existing mail did. */
export function savedMessage(
  editing: boolean,
  applied: { messages: number; capped: boolean } | null,
): string {
  const done = editing ? "Rule saved" : "Rule created";
  if (!applied) return done;
  if (applied.messages === 0) return `${done}; no existing mail matched`;
  const n = applied.messages.toLocaleString("en-US");
  const which = applied.capped
    ? `the newest ${n} matching messages`
    : `${n} existing ${applied.messages === 1 ? "message" : "messages"}`;
  return `${done} and applied to ${which}`;
}

/** "12 conversations match now", or "500+" when there are more. */
export function matchText(count: { conversations: number; more: boolean } | null): string {
  if (!count) return "";
  if (count.conversations === 0) return "No conversations match now";
  const n = `${count.conversations.toLocaleString("en-US")}${count.more ? "+" : ""}`;
  return `${n} ${count.conversations === 1 && !count.more ? "conversation matches" : "conversations match"} now`;
}

/** The "apply to existing mail" choice, with the count when known. */
export function applyText(count: { conversations: number; more: boolean } | null): string {
  if (!count || count.conversations === 0) return "Also apply to matching mail already here";
  const n = `${count.conversations.toLocaleString("en-US")}${count.more ? "+" : ""}`;
  const noun = count.conversations === 1 && !count.more ? "conversation" : "conversations";
  return `Also apply to the ${n} matching ${noun} already here`;
}
