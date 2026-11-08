import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { commands } from "../../../platform/tauri/bindings";
import { unwrap } from "../../../platform/tauri/ipc";
import { APP_NAME } from "../../../shared/lib/brand";
import { ConfirmDialog } from "../../../shared/ui/ConfirmDialog";
import { deleteAllNotice } from "../model/deleteAllNotice";

/**
 * Everything the window itself keeps (its preferences, recent searches,
 * where onboarding stood) goes with the rest, and the window starts over,
 * as on a first launch.
 */
function startOver() {
  // Storage may be blocked; the reload still starts the window afresh.
  try {
    localStorage.clear();
  } catch {
    // Nothing to clear.
  }
  try {
    sessionStorage.clear();
  } catch {
    // Nothing to clear.
  }
  window.location.reload();
}

/**
 * Settings → Accounts → "Delete all data": asks, then has Rust delete
 * everything (`data_delete_all`) and starts over. If Google didn't confirm
 * ending every sign-in, says so before starting over.
 */
export function DeleteAllDataDialog({ onCancel }: { onCancel: () => void }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (notice) {
    return (
      <ConfirmDialog
        title="Everything is deleted"
        confirmLabel="Continue"
        hideCancel
        onConfirm={startOver}
        onCancel={startOver}
      >
        <p>{notice}</p>
      </ConfirmDialog>
    );
  }

  const run = () => {
    setBusy(true);
    setError(null);
    unwrap(commands.dataDeleteAll())
      .then((done) => {
        const message = deleteAllNotice(done.revoked);
        if (message) {
          setBusy(false);
          setNotice(message);
        } else {
          startOver();
        }
      })
      .catch((e: unknown) => {
        // Some accounts may be gone already: show the list as it is.
        void qc.invalidateQueries();
        setBusy(false);
        setError(`Couldn't delete everything: ${e instanceof Error ? e.message : String(e)}`);
      });
  };

  return (
    <ConfirmDialog
      title={`Delete all ${APP_NAME} data?`}
      confirmLabel="Delete everything"
      danger
      busy={busy}
      error={error}
      onConfirm={run}
      onCancel={onCancel}
    >
      <p>
        This removes every account and deletes everything {APP_NAME} keeps on this computer: saved
        mail, downloaded attachments and images, summaries, per-sender choices and all settings. It
        asks Google to end each sign-in.
      </p>
      <p>
        It can&apos;t be undone. Nothing changes in Gmail, files you saved to Downloads stay, and so
        does the Google credentials file, so you can sign in again.
      </p>
    </ConfirmDialog>
  );
}
