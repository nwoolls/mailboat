import type { Address } from "../../../platform/tauri/bindings";

/**
 * Same rule as Rust's `compose::mime::valid_email`: one `@` with something
 * either side, and nothing that could break out of a mail header.
 */
export function isValidEmail(email: string): boolean {
  const at = email.indexOf("@");
  if (at <= 0 || at === email.length - 1 || email.indexOf("@", at + 1) !== -1) return false;
  return !/[\s<>,;:"()[\]\\\p{Cc}]/u.test(email);
}

export function sameEmail(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** "Jane Doe <jane@x.com>", or just the address without a name. */
export function formatAddress(a: Address): string {
  return a.name ? `${a.name} <${a.email}>` : a.email;
}

/** The address list without repeats (first one wins) or the excluded emails. */
export function uniqueAddresses(list: Address[], exclude: string[] = []): Address[] {
  const seen = new Set(exclude.map((e) => e.toLowerCase()));
  const out: Address[] = [];
  for (const a of list) {
    const key = a.email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

/**
 * Splits typed or pasted text into addresses: `a@x.com, "Doe, Jane"
 * <jane@y.com>; Bob <bob@z.com>`. Separators inside quotes or angle
 * brackets don't split. Every piece comes back (invalid ones too, so the
 * field can flag them instead of silently dropping what was typed).
 */
export function parseAddresses(text: string): Address[] {
  const pieces: string[] = [];
  let current = "";
  let quoted = false;
  let angled = false;
  for (const c of text) {
    if (c === '"' && !angled) quoted = !quoted;
    else if (c === "<" && !quoted) angled = true;
    else if (c === ">" && !quoted) angled = false;
    else if ((c === "," || c === ";" || c === "\n") && !quoted && !angled) {
      pieces.push(current);
      current = "";
      continue;
    }
    current += c;
  }
  pieces.push(current);
  return pieces
    .map((p) => p.trim())
    .filter(Boolean)
    .map(parseOne);
}

function parseOne(piece: string): Address {
  const open = piece.lastIndexOf("<");
  const close = piece.lastIndexOf(">");
  if (open !== -1 && close > open) {
    const email = piece.slice(open + 1, close).trim();
    const name = piece.slice(0, open).trim().replace(/^"|"$/g, "").trim();
    return { name: name || null, email };
  }
  return { name: null, email: piece.replace(/^"|"$/g, "").trim() };
}

export type AddressLine = "to" | "cc" | "bcc";

/**
 * Moves one person from one address line to another (a chip dragged from
 * To down to Cc, say): it leaves the first line and joins the end of the
 * second, name and all. Never a copy; if the second line already has the
 * address, it just leaves the first.
 */
export function moveAddress<T extends Record<AddressLine, Address[]>>(
  lines: T,
  address: Address,
  from: AddressLine,
  to: AddressLine,
): T {
  if (from === to) return lines;
  const rest = lines[from].filter((a) => !sameEmail(a.email, address.email));
  return {
    ...lines,
    [from]: rest,
    [to]: uniqueAddresses([...lines[to], address]),
  };
}
