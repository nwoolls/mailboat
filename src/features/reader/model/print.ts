import type { Address, MessageMeta } from "../../../platform/tauri/bindings";
import { formatAddress } from "../../compose/model/addresses";
import { formatFullDate } from "../../mailbox/model/format";

/** What a printed conversation shows above each email. */
export type PrintedHeader = {
  /** "Maya Chen <maya@x.example>". */
  from: string;
  /** "To: …" and "Cc: …", each left out when empty. */
  recipients: string[];
  date: string;
};

/**
 * The emails a printout holds: every one in the conversation, collapsed
 * ones too, oldest first. Unsent drafts are left out: they aren't mail yet.
 */
export function printedMessages(messages: MessageMeta[]): MessageMeta[] {
  return messages.filter((m) => !m.draft).sort((a, b) => a.internalDate - b.internalDate);
}

function names(list: Address[]): string {
  return list.map(formatAddress).join(", ");
}

export function printedHeader(m: MessageMeta, locale?: string): PrintedHeader {
  const recipients = [
    ...(m.to.length ? [`To: ${names(m.to)}`] : []),
    ...(m.cc.length ? [`Cc: ${names(m.cc)}`] : []),
  ];
  return { from: formatAddress(m.from), recipients, date: formatFullDate(m.internalDate, locale) };
}

/** "1 message", "3 messages". */
export function messageCount(n: number): string {
  return n === 1 ? "1 message" : `${n} messages`;
}
