import {
  type InfiniteData,
  type QueryKey,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { commands } from "../../../platform/tauri/bindings";
import type { ThreadDetail, ThreadId, ThreadPage } from "../../../platform/tauri/bindings";
import { unwrap } from "../../../platform/tauri/ipc";
import { keys } from "../../../shared/lib/queries";
import { withDetailRead, withThreadsRead } from "../model/readState";

type Vars = { ids: ThreadId[]; read: boolean };
type Snapshot = [QueryKey, unknown][];

/**
 * Marks threads read/unread. The screen updates immediately; if Gmail
 * refuses, the previous state comes back. Rust routes each thread to its
 * own account.
 */
export function useSetRead() {
  const qc = useQueryClient();
  return useMutation<void, Error, Vars, Snapshot>({
    mutationFn: ({ ids, read }) => unwrap(commands.threadsSetRead(ids, read)).then(() => undefined),
    onMutate: async ({ ids, read }) => {
      await qc.cancelQueries({ queryKey: ["threads"] });
      const snapshot: Snapshot = [
        ...qc.getQueriesData({ queryKey: ["threads"] }),
        ...ids.map((id): [QueryKey, unknown] => [
          keys.thread(id),
          qc.getQueryData(keys.thread(id)),
        ]),
      ];
      const set = new Set(ids);
      qc.setQueriesData<InfiniteData<ThreadPage>>({ queryKey: ["threads"] }, (d) =>
        withThreadsRead(d, set, read),
      );
      for (const id of ids) {
        qc.setQueryData<ThreadDetail>(keys.thread(id), (d) => withDetailRead(d, read));
      }
      return snapshot;
    },
    onError: (_error, _vars, snapshot) => {
      for (const [key, data] of snapshot ?? []) qc.setQueryData(key, data);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["threads"] });
      void qc.invalidateQueries({ queryKey: ["thread"] });
    },
  });
}
