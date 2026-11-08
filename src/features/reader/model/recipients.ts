import type { Address, MessageMeta } from "../../../platform/tauri/bindings";

/** One line of an email's details: who, in full. */
export type DetailLine = { label: "From" | "To" | "Cc"; people: string[] };

/** A person as written in a header: `Name <address>`, or just the address. */
export function fullAddress(a: Address): string {
  const name = a.name?.trim();
  return name ? `${name} <${a.email}>` : a.email;
}

/**
 * Everyone on an email, in full, for its Details: From, To and Cc (a line is
 * left out when it has nobody). The cache doesn't keep Bcc, so it isn't
 * here. The row above shows the same people in short and cut off to one
 * line, which is why this exists.
 */
export function detailLines(m: Pick<MessageMeta, "from" | "to" | "cc">): DetailLine[] {
  const lines: DetailLine[] = [
    { label: "From", people: [fullAddress(m.from)] },
    { label: "To", people: m.to.map(fullAddress) },
    { label: "Cc", people: m.cc.map(fullAddress) },
  ];
  return lines.filter((l) => l.people.length > 0);
}
