/**
 * Sent on the reader (`.reader-scroll`) when a newly opened reply starts
 * being kept in view: the reader stops landing on the email it opened, so
 * the two never pull the reader opposite ways.
 */
export const REPLY_FOLLOW_EVENT = "reply-follow";

/**
 * Set on a reply that keeps the reader at its end, while it does. A reader
 * mounting with such a reply already in it (back to a conversation being
 * answered) doesn't land on an email: the reply's effect ran first, so the
 * event above came before the reader listened. A forward that opens in To
 * doesn't take the reader, so it isn't marked.
 */
export const REPLY_HOLDS_ATTR = "data-reply-holds";
