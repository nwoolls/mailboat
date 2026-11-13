import {
  type InfiniteData,
  type Query,
  type QueryClient,
  type QueryKey,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { commands } from "../../../platform/tauri/bindings";
import type {
  MailView,
  ThreadDetail,
  ThreadId,
  ThreadPage,
} from "../../../platform/tauri/bindings";
import { unwrap } from "../../../platform/tauri/ipc";
import { keys } from "../../../shared/lib/queries";
import { type ThreadAction, withAction, withDetailAction } from "../model/threadActions";

export type ActionVars = { ids: ThreadId[]; action: ThreadAction };
/**
 * What an action changed, to put back if Gmail refuses: each query's key,
 * its data before, and the query itself, so a rollback only writes into the
 * query it came from.
 */
type Snapshot = [QueryKey, unknown, Query | undefined][];

/**
 * Puts a failed action's snapshot back, into the queries it came from only:
 * one removed meanwhile (the Unread list, forgotten when the person left
 * it) stays gone rather than coming back with the old rows, even if a new
 * visit has since made a query with the same key (code review).
 */
export function rollback(qc: QueryClient, snapshot: Snapshot) {
  for (const [key, data, query] of snapshot) {
    if (qc.getQueryCache().find({ queryKey: key, exact: true }) === query) {
      qc.setQueryData(key, data);
    }
  }
}

function run({ ids, action }: ActionVars): Promise<null> {
  switch (action.kind) {
    case "read":
      return unwrap(commands.threadsSetRead(ids, action.read));
    case "archive":
      return unwrap(commands.threadsSetArchived(ids, action.archived));
    case "star":
      return unwrap(commands.threadsSetStarred(ids, action.starred));
    case "trash":
      return unwrap(commands.threadsSetTrashed(ids, action.trashed));
    case "spam":
      return unwrap(commands.threadsSetSpam(ids, action.spam));
    case "labels":
      return unwrap(
        commands.threadsChangeLabels(
          ids,
          action.add.map((l) => l.id),
          action.remove.map((l) => l.id),
        ),
      );
  }
}

/**
 * Runs an action on conversations. The screen updates immediately (rows
 * leave the views they no longer belong in); if Gmail refuses, the
 * previous state comes back. Rust routes each thread to its own account.
 */
export function useThreadAction() {
  const qc = useQueryClient();
  return useMutation<null, Error, ActionVars, Snapshot>({
    mutationFn: run,
    onMutate: async ({ ids, action }) => {
      await qc.cancelQueries({ queryKey: ["threads"] });
      const lists = qc.getQueriesData<InfiniteData<ThreadPage>>({ queryKey: ["threads"] });
      const cache = qc.getQueryCache();
      const query = (key: QueryKey) => cache.find({ queryKey: key, exact: true });
      const snapshot: Snapshot = [
        ...lists.map(([key, data]): Snapshot[number] => [key, data, query(key)]),
        ...ids.map((id): Snapshot[number] => [
          keys.thread(id),
          qc.getQueryData(keys.thread(id)),
          query(keys.thread(id)),
        ]),
      ];
      const set = new Set(ids);
      for (const [key, data] of lists) {
        // keys.threads puts the view third.
        const view = key[2] as MailView | undefined;
        if (view) qc.setQueryData(key, withAction(data, set, action, view));
      }
      for (const id of ids) {
        qc.setQueryData<ThreadDetail>(keys.thread(id), (d) => withDetailAction(d, action));
      }
      return snapshot;
    },
    onError: (_error, _vars, snapshot) => rollback(qc, snapshot ?? []),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["threads"] });
      void qc.invalidateQueries({ queryKey: ["thread"] });
      void qc.invalidateQueries({ queryKey: keys.unreadCounts });
    },
  });
}
