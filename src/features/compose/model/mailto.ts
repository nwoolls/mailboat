import type { Mailto } from "../../../platform/tauri/bindings";
import { parseAddresses } from "./addresses";
import { type Draft, htmlToText, textToHtml } from "./draft";

const list = (items: string[]) => items.flatMap(parseAddresses);

/** A new message filled in from a `mailto:` link (parsed in Rust). */
export function draftFromMailto(draft: Draft, link: Mailto): Draft {
  const html = textToHtml(link.body);
  const cc = list(link.cc);
  const bcc = list(link.bcc);
  return {
    ...draft,
    to: list(link.to),
    cc,
    bcc,
    // A subject is one line: a line break in the link (`%0D%0A`) is sent as
    // a space, so it's a space here too.
    subject: link.subject.replace(/\s*[\r\n]+\s*/g, " "),
    html,
    text: htmlToText(html),
    showCc: cc.length > 0,
    showBcc: bcc.length > 0,
  };
}
