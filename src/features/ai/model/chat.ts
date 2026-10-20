import type { ChatTurn, WriteRequest } from "../../../platform/tauri/bindings";
import type { Draft } from "../../compose/model/draft";
import { formatAddress } from "../../compose/model/addresses";

/** One bubble in the writing assistant's chat. */
export type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  text: string;
  /** A subject the model suggested (new mail without one). */
  subject?: string | null;
  /** The request failed: shown, but not sent back to the model. */
  error?: boolean;
};

let nextId = 1;
export function chatMessage(m: Omit<ChatMessage, "id">): ChatMessage {
  return { ...m, id: nextId++ };
}

/** What the model hears of the chat: everything but failures. */
export function toTurns(messages: ChatMessage[]): ChatTurn[] {
  return messages.filter((m) => !m.error).map((m) => ({ role: m.role, text: m.text }));
}

const KINDS: Record<Draft["kind"], string> = {
  new: "new message",
  reply: "reply",
  replyAll: "reply all",
  forward: "forward",
};

/** The request for the newest message in the chat. */
export function writeRequest(draft: Draft, messages: ChatMessage[]): WriteRequest {
  return {
    threadId: draft.kind === "new" ? null : draft.threadId,
    kind: KINDS[draft.kind],
    writer: formatAddress(draft.from),
    to: [...draft.to, ...draft.cc].map(formatAddress).join(", "),
    subject: draft.subject,
    draft: draft.edited ? draft.text : "",
    chat: toTurns(messages),
  };
}

/** Starting points offered in an empty chat. */
export function suggestions(kind: Draft["kind"]): string[] {
  if (kind === "new") return ["Ask to meet next week", "Follow up politely", "Make it shorter"];
  if (kind === "forward") return ["Add a short note explaining why", "Ask for their thoughts"];
  return ["Say yes", "Politely decline", "Ask for more details", "Make it shorter"];
}
