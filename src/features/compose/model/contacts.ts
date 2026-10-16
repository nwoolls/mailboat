import type { Contact } from "../../../platform/tauri/bindings";

/**
 * Whether what's typed matches a person: the start of their address, of
 * any word of their name, or of their domain (not the middle of a word).
 */
export function contactMatches(c: Contact, typed: string): boolean {
  const t = typed.trim().toLowerCase();
  if (!t) return false;
  const email = c.email.toLowerCase();
  const domain = email.slice(email.indexOf("@") + 1);
  const words = (c.name ?? "").toLowerCase().split(/[\s,.'"()-]+/);
  return (
    email.startsWith(t) ||
    domain.startsWith(t) ||
    words.some((w) => w.startsWith(t)) ||
    (c.name ?? "").toLowerCase().startsWith(t)
  );
}

/** The best `limit` matches; the list arrives ranked from Rust, so order is kept. */
export function matchContacts(list: Contact[], typed: string, limit = 8): Contact[] {
  const out: Contact[] = [];
  for (const c of list) {
    if (contactMatches(c, typed)) out.push(c);
    if (out.length === limit) break;
  }
  return out;
}
