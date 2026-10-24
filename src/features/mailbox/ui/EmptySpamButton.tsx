import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { AccountFilter } from "../../../platform/tauri/bindings";
import { commands } from "../../../platform/tauri/bindings";
import { unwrap } from "../../../platform/tauri/ipc";
import { showToast } from "../../../shared/lib/toast";
import { ConfirmDialog } from "../../../shared/ui/ConfirmDialog";

/**
 * "Empty Spam" at the top of Spam, as Gmail's "Delete all spam messages
 * now". Mailboat can't delete for good (it has `gmail.modify`, not full
 * access), so it moves everything in Spam to Trash, which Gmail empties
 * after 30 days. Covers every account the view shows, each separately.
 */
export function EmptySpamButton({ accounts }: { accounts: AccountFilter }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();
  const empty = () => {
    setBusy(true);
    setError(null);
    unwrap(commands.spamEmpty(accounts))
      .then((done) => {
        setAsking(false);
        void qc.invalidateQueries({ queryKey: ["threads"] });
        void qc.invalidateQueries({ queryKey: ["unreadCounts"] });
        const moved =
          done.moved === 1
            ? "Moved 1 spam email to Trash"
            : `Moved ${done.moved} spam emails to Trash`;
        showToast(
          done.failed > 0
            ? {
                tone: "error",
                message: `${moved}, but ${done.failed === 1 ? "1 account" : `${done.failed} accounts`} couldn’t be emptied`,
              }
            : { message: moved },
        );
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };
  return (
    <>
      <button
        type="button"
        onClick={() => setAsking(true)}
        className="ml-auto shrink-0 rounded px-1.5 py-0.5 text-xs text-content/55 hover:bg-selection hover:text-content"
      >
        Empty Spam…
      </button>
      {asking && (
        <ConfirmDialog
          title="Empty Spam?"
          confirmLabel="Move to Trash"
          danger
          busy={busy}
          error={error}
          onCancel={() => {
            setAsking(false);
            setError(null);
          }}
          onConfirm={empty}
        >
          <p>
            Everything in Spam goes to Trash
            {accounts.kind === "all" ? ", in every account" : ""}, including spam Mailboat hasn’t
            downloaded yet.
          </p>
          <p>Gmail deletes mail in Trash for good after 30 days.</p>
        </ConfirmDialog>
      )}
    </>
  );
}
