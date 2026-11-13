import type { InfiniteData } from "@tanstack/react-query";
import type {
  Label,
  MailView,
  ThreadDetail,
  ThreadId,
  ThreadPage,
  ThreadSummary,
} from "../../../platform/tauri/bindings";

/** Something done to one or more conversations. Rust routes each to its account. */
export type ThreadAction =
  | { kind: "read"; read: boolean }
  | { kind: "archive"; archived: boolean }
  | { kind: "star"; starred: boolean }
  | { kind: "trash"; trashed: boolean }
  | { kind: "spam"; spam: boolean }
  | { kind: "labels"; add: Label[]; remove: Label[] };

type Flags = Pick<ThreadSummary, "unread" | "starred" | "inInbox" | "inTrash" | "inSpam">;

/** Whether a label is on all, some or none of these conversations. */
export function labelState(
  threads: Pick<ThreadSummary, "labelIds">[],
  label: Pick<Label, "id">,
): "all" | "some" | "none" {
  const count = threads.filter((t) => t.labelIds.includes(label.id)).length;
  return count === 0 ? "none" : count === threads.length ? "all" : "some";
}

/** Clicking a label in the picker: add it to all, unless all have it. */
export function labelToggle(
  threads: Pick<ThreadSummary, "labelIds">[],
  label: Label,
): ThreadAction {
  return labelState(threads, label) === "all"
    ? { kind: "labels", add: [], remove: [label] }
    : { kind: "labels", add: [label], remove: [] };
}

/**
 * What a toolbar button or key does for these conversations: if any of
 * them still needs the action, do it to all; otherwise undo it for all
 * (e.g. star all unless every one is already starred).
 */
export function toggleFor(
  kind: "read" | "archive" | "star" | "trash" | "spam",
  threads: Flags[],
): ThreadAction | null {
  if (threads.length === 0) return null;
  switch (kind) {
    case "read":
      return { kind, read: threads.some((t) => t.unread) };
    case "archive":
      return { kind, archived: threads.some((t) => t.inInbox) };
    case "star":
      return { kind, starred: threads.some((t) => !t.starred) };
    case "trash":
      return { kind, trashed: threads.some((t) => !t.inTrash) };
    case "spam":
      return { kind, spam: threads.some((t) => !t.inSpam) };
  }
}

/**
 * What the Delete key does, chosen in Settings → Viewing. Unlike `#` and
 * `e` it never undoes: Delete on conversations already in Trash (or
 * already archived) does nothing rather than bringing them back.
 */
export function deleteKeyAction(
  choice: "trash" | "archive",
  threads: Flags[],
): ThreadAction | null {
  if (choice === "trash")
    return threads.some((t) => !t.inTrash) ? { kind: "trash", trashed: true } : null;
  return threads.some((t) => t.inInbox) ? { kind: "archive", archived: true } : null;
}

/** Does a conversation drop out of this view after the action? */
export function leavesView(action: ThreadAction, view: MailView): boolean {
  const system = view.kind === "system" ? view.label : null;
  switch (action.kind) {
    case "archive":
      return action.archived ? system === "inbox" : view.kind === "archive";
    case "trash":
      return action.trashed ? system !== "trash" : system === "trash";
    case "spam":
      return action.spam ? system !== "spam" : system === "spam";
    case "star":
      return !action.starred && system === "starred";
    case "labels":
      return view.kind === "userLabel" && action.remove.some((l) => l.id === view.labelId);
    case "read":
      // Opening a conversation marks it read; it stays in Unread until the
      // list refreshes rather than vanishing from under the pointer.
      return false;
  }
}

/** A list row after the action. */
export function updateSummary(action: ThreadAction, t: ThreadSummary): ThreadSummary {
  switch (action.kind) {
    case "read":
      return {
        ...t,
        unread: !action.read,
        // Everyone's mail in it changes with it (Gmail marks them all).
        senders: t.senders.map((s) => ({ ...s, unread: !action.read })),
      };
    case "archive":
      return { ...t, inInbox: !action.archived };
    case "star":
      return { ...t, starred: action.starred };
    case "trash":
      return { ...t, inTrash: action.trashed };
    case "spam":
      return { ...t, inSpam: action.spam, inInbox: !action.spam };
    case "labels": {
      const removed = new Set(action.remove.map((l) => l.id));
      const kept = t.labelIds.filter((id) => !removed.has(id));
      const added = action.add
        .filter((l) => l.accountId === t.accountId && !kept.includes(l.id))
        .map((l) => l.id);
      return { ...t, labelIds: [...kept, ...added] };
    }
  }
}

/** Cached list pages after the action: rows that leave the view go, others update. */
export function withAction(
  data: InfiniteData<ThreadPage> | undefined,
  ids: ReadonlySet<ThreadId>,
  action: ThreadAction,
  view: MailView,
): (InfiniteData<ThreadPage> & { local?: true }) | undefined {
  if (!data) return data;
  const leaves = leavesView(action, view);
  return {
    ...data,
    // The app's own update: the Unread list takes it as it is (unreadList.ts).
    ...(view.kind === "system" && view.label === "unread" && { local: true as const }),
    pages: data.pages.map((page) => ({
      ...page,
      threads: page.threads.flatMap((t) =>
        !ids.has(t.id) ? [t] : leaves ? [] : [updateSummary(action, t)],
      ),
    })),
  };
}

/** An open conversation after the action. */
export function withDetailAction(
  detail: ThreadDetail | undefined,
  action: ThreadAction,
): ThreadDetail | undefined {
  if (!detail) return detail;
  const thread = updateSummary(action, detail.thread);
  switch (action.kind) {
    case "read":
      return {
        ...detail,
        thread,
        messages: detail.messages.map((m) => ({ ...m, unread: !action.read })),
      };
    case "star":
      return {
        ...detail,
        thread,
        messages: detail.messages.map((m) => ({ ...m, starred: action.starred })),
      };
    case "labels": {
      const removed = new Set(action.remove.map((l) => l.id));
      const kept = detail.labels.filter((l) => !removed.has(l.id));
      const added = action.add.filter(
        (l) => l.accountId === detail.thread.accountId && !kept.some((k) => k.id === l.id),
      );
      return {
        ...detail,
        thread,
        labels: [...kept, ...added].toSorted((a, b) => a.name.localeCompare(b.name)),
      };
    }
    default:
      return { ...detail, thread };
  }
}

/** The action that puts things back (for Undo). */
export function inverse(action: ThreadAction): ThreadAction {
  switch (action.kind) {
    case "read":
      return { kind: "read", read: !action.read };
    case "archive":
      return { kind: "archive", archived: !action.archived };
    case "star":
      return { kind: "star", starred: !action.starred };
    case "trash":
      return { kind: "trash", trashed: !action.trashed };
    case "spam":
      return { kind: "spam", spam: !action.spam };
    case "labels":
      return { kind: "labels", add: action.remove, remove: action.add };
  }
}

const plural = (n: number) => (n === 1 ? "Conversation" : `${n} conversations`);
const quoted = (labels: Label[]) => labels.map((l) => `“${l.name}”`).join(", ");

/**
 * A short line for the toast after an action, or null for actions that
 * show their result in place (read and star change the row itself).
 */
export function actionMessage(action: ThreadAction, count: number): string | null {
  const what = plural(count);
  switch (action.kind) {
    case "archive":
      return action.archived ? `${what} archived` : `${what} moved to Inbox`;
    case "trash":
      return action.trashed ? `${what} moved to Trash` : `${what} restored from Trash`;
    case "spam":
      return action.spam ? `${what} reported as spam` : `${what} marked not spam`;
    case "labels": {
      const parts = [
        action.add.length > 0 && `Labeled ${quoted(action.add)}`,
        action.remove.length > 0 && `Removed ${quoted(action.remove)}`,
      ].filter(Boolean);
      return parts.length > 0 ? parts.join(" · ") : null;
    }
    default:
      return null;
  }
}

/** A menu item's words for what the action would do now. */
export function actionLabel(action: ThreadAction): string {
  switch (action.kind) {
    case "read":
      return action.read ? "Mark as read" : "Mark as unread";
    case "archive":
      return action.archived ? "Archive" : "Move to Inbox";
    case "star":
      return action.starred ? "Star" : "Unstar";
    case "trash":
      return action.trashed ? "Move to Trash" : "Restore from Trash";
    case "spam":
      return action.spam ? "Report spam" : "Not spam";
    case "labels":
      return "Labels…";
  }
}

/** Verb for an error line: "Couldn't archive: …". */
export function actionVerb(action: ThreadAction): string {
  switch (action.kind) {
    case "read":
      return action.read ? "mark as read" : "mark as unread";
    case "archive":
      return action.archived ? "archive" : "move to Inbox";
    case "star":
      return action.starred ? "star" : "unstar";
    case "trash":
      return action.trashed ? "move to Trash" : "restore from Trash";
    case "spam":
      return action.spam ? "report spam" : "mark as not spam";
    case "labels":
      return "change labels";
  }
}

/** What opens when the open conversation leaves the list (Settings → Viewing). */
export type AfterRemoval = "below" | "above" | "none";

/**
 * The conversation to open after some leave the list. The open one stays
 * if it isn't among them. Otherwise, by `after`: the next one below that
 * stays (as Mail does; the default), else the nearest above; the nearest
 * above, else below; or none, back to just the list.
 */
export function nextAfterRemoval(
  threads: Pick<ThreadSummary, "id">[],
  removed: ReadonlySet<ThreadId>,
  current: ThreadId | null,
  after: AfterRemoval = "below",
): ThreadId | null {
  if (current === null) return null;
  if (!removed.has(current)) return current;
  if (after === "none") return null;
  const index = threads.findIndex((t) => t.id === current);
  if (index < 0) return null;
  const below = threads.slice(index + 1);
  const above = threads.slice(0, index).toReversed();
  const order = after === "below" ? [...below, ...above] : [...above, ...below];
  return order.find((t) => !removed.has(t.id))?.id ?? null;
}

/**
 * The previewed and the selected conversation after `removed` leave the
 * view (archived, deleted, moved): each moves on to the next one that
 * stays, as Settings → Viewing says. With the preview collapsed (by hand:
 * its button or Esc), the next one is selected without being previewed,
 * as j/k do then, so the preview stays collapsed (owner request,
 * 2026-11-09).
 */
export function moveAfterRemoval(
  threads: Pick<ThreadSummary, "id">[],
  removed: ReadonlySet<ThreadId>,
  at: { previewed: ThreadId | null; selected: ThreadId | null; previewing: boolean },
  after: AfterRemoval = "below",
): { previewed: ThreadId | null; selected: ThreadId | null } {
  if (!at.previewing && at.previewed !== null && removed.has(at.previewed))
    return { previewed: null, selected: nextAfterRemoval(threads, removed, at.previewed, after) };
  return {
    previewed: nextAfterRemoval(threads, removed, at.previewed, after),
    selected: nextAfterRemoval(threads, removed, at.selected, after),
  };
}

/**
 * What's open after Undo brings conversations back: the one that was open
 * before the action, if it's among them (archiving the open conversation
 * moved on; Undo goes back to it). Otherwise whatever is open now stays,
 * so undoing a swipe on a row that wasn't open doesn't open it.
 */
export function selectionAfterUndo(
  openBefore: ThreadId | null,
  restored: readonly ThreadId[],
  current: ThreadId | null,
): ThreadId | null {
  return openBefore !== null && restored.includes(openBefore) ? openBefore : current;
}
