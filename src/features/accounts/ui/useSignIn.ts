import { useMutation, useQueryClient } from "@tanstack/react-query";
import { commands } from "../../../platform/tauri/bindings";
import { unwrap } from "../../../platform/tauri/ipc";
import { keys } from "../../../shared/lib/queries";
import { signInErrorMessage } from "../model/signIn";

export type SignIn = ReturnType<typeof useSignIn>;

/** Browser sign-in for a new (or re-authorizing) account, with cancel. */
export function useSignIn() {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: (loginHint: string | null) => unwrap(commands.accountAdd(loginHint)),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.accounts });
      void qc.invalidateQueries({ queryKey: keys.syncStates });
      void qc.invalidateQueries({ queryKey: keys.oauthSetup });
      // Invitation cards that asked for this sign-in can answer now.
      void qc.invalidateQueries({ queryKey: ["invite"] });
      void qc.invalidateQueries({ queryKey: keys.rules });
      void qc.invalidateQueries({ queryKey: keys.vacations });
    },
  });
  return {
    start: (loginHint: string | null = null) => mutation.mutate(loginHint),
    cancel: () => void commands.accountAddCancel(),
    pending: mutation.isPending,
    /** Whose sign-in is running or failed: an address, null for a new account, undefined before any. */
    hint: mutation.variables,
    error: signInErrorMessage(mutation.error),
  };
}
