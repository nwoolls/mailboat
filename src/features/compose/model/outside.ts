import type { Address, OutsideRule } from "../../../platform/tauri/bindings";
import { isValidEmail } from "./addresses";

/**
 * Whether an address is outside the From account's organization, as
 * Gmail's warning decides (`compose::outside` in Rust gathers the rule):
 * only for a Workspace account, never for someone in its Contacts or Other
 * contacts, and never at one of its domains (its own, or an alias's). An
 * address that isn't valid is marked as invalid instead.
 */
export function isOutside(rule: OutsideRule | null | undefined, email: string): boolean {
  if (!rule?.workspace || !isValidEmail(email)) return false;
  const address = email.trim().toLowerCase();
  const domain = address.slice(address.lastIndexOf("@") + 1);
  return !rule.domains.includes(domain) && !rule.known.includes(address);
}

/** The outside addresses among the recipients, each once, in order. */
export function outsideRecipients(
  rule: OutsideRule | null | undefined,
  recipients: Address[],
): Address[] {
  const seen = new Set<string>();
  return recipients.filter((a) => {
    const key = a.email.trim().toLowerCase();
    if (seen.has(key) || !isOutside(rule, a.email)) return false;
    seen.add(key);
    return true;
  });
}

/** "Jordan Park", "Jordan Park and Sam", "Jordan Park, Sam and 2 others". */
function names(people: Address[]): string {
  const shown = people.map((a) => a.name?.trim() || a.email);
  if (shown.length === 1) return shown[0]!;
  if (shown.length <= 3) return `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}`;
  return `${shown.slice(0, 2).join(", ")} and ${shown.length - 2} others`;
}

/** The banner above the message while outside recipients are in it. */
export function outsideBanner(
  rule: OutsideRule,
  outside: Address[],
): { title: string; detail: string } {
  const one = outside.length === 1;
  const who = one ? outside[0]!.name?.trim() || outside[0]!.email : `${outside.length} people`;
  // A named person: the detail gives their address.
  const subject = one && outside[0]!.name?.trim() ? outside[0]!.email : names(outside);
  const where =
    rule.domains.length === 1
      ? `at ${rule.domains[0]}`
      : `at ${rule.domains[0]} or your aliases’ domains`;
  return {
    title: `${who} ${one ? "is" : "are"} outside your organization`,
    detail: `${subject} ${one ? "isn’t" : "aren’t"} ${where}. Be careful sharing anything sensitive.`,
  };
}
