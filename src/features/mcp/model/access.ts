import type { AccountId, McpLogEntry, McpSettings } from "../../../platform/tauri/bindings";

/** Which accounts AI apps may read, and save drafts in. */
export type Access = Required<McpSettings>;

export const NO_ACCESS: Access = { read: [], drafts: [] };

/** The saved choice, with nothing shared when it was never set. */
export function mcpAccess(saved: McpSettings | undefined): Access {
  return { read: saved?.read ?? [], drafts: saved?.drafts ?? [] };
}

const without = (list: AccountId[], id: AccountId) => list.filter((x) => x !== id);
const including = (list: AccountId[], id: AccountId) => (list.includes(id) ? list : [...list, id]);

/**
 * Turns reading or drafts on or off for an account. Drafts need reading:
 * allowing drafts allows reading, and stopping reading stops drafts.
 */
export function setAccess(
  access: Access,
  account: AccountId,
  kind: "read" | "drafts",
  on: boolean,
): Access {
  if (kind === "read")
    return on
      ? { ...access, read: including(access.read, account) }
      : { read: without(access.read, account), drafts: without(access.drafts, account) };
  return on
    ? { read: including(access.read, account), drafts: including(access.drafts, account) }
    : { ...access, drafts: without(access.drafts, account) };
}

/** How AI apps name themselves, as people know them. */
export function clientName(client: string): string {
  const known: Record<string, string> = {
    "claude-ai": "Claude Desktop",
    "claude-code": "Claude Code",
  };
  return known[client] ?? client;
}

/** One request in the log, as a sentence ("Searched “invoice”: 3 conversations"). */
export function describeRequest(
  e: Pick<McpLogEntry, "tool" | "detail" | "subject" | "ok">,
): string {
  const subject = e.subject ? `“${e.subject}”` : "a conversation";
  const text = (() => {
    switch (e.tool) {
      case "search_mail":
        return `Searched ${e.detail.replace(/^"(.*)":/, "“$1”:")}`;
      case "list_conversations":
        return `Listed ${e.detail.replace(/^label "(.*)":/, "label “$1”:").replace("_", " ")}`;
      case "read_conversation":
        return e.ok ? `Read ${subject} (${e.detail})` : "Tried to read a conversation";
      case "list_labels":
        return "Listed labels";
      case "list_accounts":
        return "Listed accounts";
      case "create_draft":
        return e.subject ? `Saved a draft in ${subject}` : "Saved a draft";
      default:
        return e.tool;
    }
  })();
  return e.ok || e.tool === "read_conversation" ? text : `${text} (refused)`;
}
