/**
 * Sent on the reader (`.reader-scroll`) when a newly opened reply starts
 * being kept in view: the reader stops landing on the email it opened, so
 * the two never pull the reader opposite ways.
 */
export const REPLY_FOLLOW_EVENT = "reply-follow";
