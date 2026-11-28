import type { Identity, Template } from "../../../platform/tauri/bindings";
import { sameEmail } from "../../compose/model/addresses";
import { type Draft, withIdentity } from "../../compose/model/draft";

/**
 * A new message with a template's From, people and subject, each only where
 * the message has none yet, so nothing written is replaced. A reply or
 * forward keeps its own: there a template only adds to the text. From
 * changes only before anything is written, and only to an address that is
 * still one of yours (otherwise the message keeps its own).
 */
export function withTemplateFields(
  draft: Draft,
  template: Pick<Template, "from" | "to" | "cc" | "bcc">,
  identities: Identity[],
  subject: string,
): Draft {
  if (draft.kind !== "new") return draft;
  let next = draft;
  const from = template.from;
  const identity = from ? identities.find((i) => sameEmail(i.email, from)) : undefined;
  if (identity && !draft.edited && !sameEmail(draft.from.email, identity.email))
    next = withIdentity(next, identity);
  const to = next.to.length ? next.to : template.to;
  const cc = next.cc.length ? next.cc : template.cc;
  const bcc = next.bcc.length ? next.bcc : template.bcc;
  return {
    ...next,
    to,
    cc,
    bcc,
    subject: next.subject.trim() ? next.subject : subject,
    showCc: next.showCc || cc.length > 0,
    showBcc: next.showBcc || bcc.length > 0,
  };
}

/**
 * Templates for ⌘K: the most recently used first, then the rest by name.
 */
export function recentFirst<T extends Pick<Template, "name" | "usedAt">>(templates: T[]): T[] {
  return templates.toSorted(
    (a, b) =>
      (b.usedAt ?? 0) - (a.usedAt ?? 0) ||
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}
