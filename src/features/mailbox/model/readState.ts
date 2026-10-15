import type { InfiniteData } from "@tanstack/react-query";
import type {
  ThreadDetail,
  ThreadId,
  ThreadPage,
  ThreadSummary,
} from "../../../platform/tauri/bindings";

/** Cached thread-list pages with the given threads marked read/unread. */
export function withThreadsRead(
  data: InfiniteData<ThreadPage> | undefined,
  ids: ReadonlySet<ThreadId>,
  read: boolean,
): InfiniteData<ThreadPage> | undefined {
  if (!data) return data;
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      threads: page.threads.map((t) => (ids.has(t.id) ? { ...t, unread: !read } : t)),
    })),
  };
}

/** A cached thread detail marked read/unread (all of its messages). */
export function withDetailRead(
  detail: ThreadDetail | undefined,
  read: boolean,
): ThreadDetail | undefined {
  if (!detail) return detail;
  return {
    ...detail,
    thread: { ...detail.thread, unread: !read },
    messages: detail.messages.map((m) => ({ ...m, unread: !read })),
  };
}

/** What `u` should do: flip the selected thread's read state. */
export function readToggle(
  threads: Pick<ThreadSummary, "id" | "unread">[],
  selected: ThreadId | null,
): { id: ThreadId; read: boolean } | null {
  const thread = threads.find((t) => t.id === selected);
  return thread ? { id: thread.id, read: thread.unread } : null;
}
