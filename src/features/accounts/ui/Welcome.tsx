import { useMutation, useQueryClient } from "@tanstack/react-query";
import { commands } from "../../../platform/tauri/bindings";
import type { OAuthSetup } from "../../../platform/tauri/bindings";
import { unwrap } from "../../../platform/tauri/ipc";
import { keys } from "../../../shared/lib/queries";

/** First-run screen: explains OAuth setup if needed, then offers sign-in. */
export function Welcome({ setup }: { setup: OAuthSetup | undefined }) {
  const qc = useQueryClient();
  const add = useMutation({
    mutationFn: () => unwrap(commands.accountAdd(null)),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.accounts });
      void qc.invalidateQueries({ queryKey: keys.oauthSetup });
    },
  });

  return (
    <div className="flex h-full flex-col">
      <div data-tauri-drag-region className="h-11 shrink-0" />
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="max-w-md">
          <h1 className="text-2xl font-semibold">Welcome to Mailboat</h1>
          {setup && !setup.configured ? (
            <div className="mt-4 space-y-3 text-content/70">
              <p>Mailboat needs a Google OAuth client before you can sign in.</p>
              <ol className="list-decimal space-y-1 pl-5">
                <li>
                  In Google Cloud Console, create an OAuth client of type “Desktop app” and enable
                  the Gmail API.
                </li>
                <li>Download the client JSON.</li>
                <li>Save it as:</li>
              </ol>
              <code className="selectable block rounded-md bg-selection px-3 py-2 text-xs break-all">
                {setup.clientFilePath}
              </code>
              <button
                type="button"
                className="rounded-md bg-selection-strong px-3 py-1.5 hover:bg-selection"
                onClick={() => void qc.invalidateQueries({ queryKey: keys.oauthSetup })}
              >
                I've saved it
              </button>
            </div>
          ) : (
            <div className="mt-4 space-y-4 text-content/70">
              <p>
                Connect a Gmail or Google Workspace account. Sign-in happens in your browser; Mailboat
                never sees your password.
              </p>
              <button
                type="button"
                className="rounded-md bg-accent px-4 py-2 font-medium text-white disabled:opacity-60"
                disabled={add.isPending}
                onClick={() => add.mutate()}
              >
                {add.isPending ? "Waiting for browser…" : "Sign in with Google"}
              </button>
              {add.error && <p className="selectable text-sm text-danger">{add.error.message}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
