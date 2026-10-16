import { useMutation, useQueryClient } from "@tanstack/react-query";
import { commands, type AccountId } from "../../../platform/tauri/bindings";
import { unwrap } from "../../../platform/tauri/ipc";

/**
 * Disconnects an account: Rust stops its sync, deletes its cached mail and
 * forgets its sign-in. Every cached list may hold its rows, so all queries
 * refresh afterwards.
 */
export function useRemoveAccount(onRemoved: (id: AccountId) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: AccountId) => unwrap(commands.accountRemove(id)),
    onSuccess: (_, id) => {
      onRemoved(id);
      // Conversations and messages that were open belong to nobody now.
      qc.removeQueries({ queryKey: ["thread"] });
      qc.removeQueries({ queryKey: ["message"] });
      void qc.invalidateQueries();
    },
  });
}
