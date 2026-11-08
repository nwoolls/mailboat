import { useMutation, useQueryClient } from "@tanstack/react-query";
import { commands, type AccountId } from "../../../platform/tauri/bindings";
import { unwrap } from "../../../platform/tauri/ipc";
import { showToast } from "../../../shared/lib/toast";
import { removalNotice } from "../model/removalNotice";

/**
 * Disconnects an account: Rust stops its sync, asks Google to end its
 * sign-in, deletes its cached mail and its downloaded images, and forgets
 * its sign-in. If Google didn't confirm, a toast says so. Every cached list may hold its rows, so all queries
 * refresh afterwards.
 */
export function useRemoveAccount(onRemoved: (id: AccountId) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: AccountId) => unwrap(commands.accountRemove(id)),
    onSuccess: (removed, id) => {
      onRemoved(id);
      const notice = removalNotice(removed.revoked);
      if (notice) showToast({ message: notice, ms: 12000, wrap: true });
      // Conversations and messages that were open belong to nobody now.
      qc.removeQueries({ queryKey: ["thread"] });
      qc.removeQueries({ queryKey: ["message"] });
      void qc.invalidateQueries();
    },
  });
}
