import { useState } from "react";
import type { Account, Identity } from "../../../platform/tauri/bindings";
import { ConfirmDialog } from "../../../shared/ui/ConfirmDialog";
import { ClearIcon } from "../../../shared/ui/icons";
import { hasChanges } from "../model/draft";
import type { ComposeEntry } from "../model/composeState";
import { ComposeForm } from "./ComposeForm";
import { closeDraft, updateDraft } from "./useCompose";

/**
 * A new message, in a card floating over the lower right of the window
 * (about Gmail's size). It never blocks the app: the list and reader stay
 * usable beside it. Snapping to other spots and minimising come next
 * (Milestone 4, stage 2).
 */
export function ComposeCard({
  entry,
  identities,
  accounts,
  onSend,
}: {
  entry: ComposeEntry;
  identities: Identity[];
  accounts: Account[];
  onSend: () => void;
}) {
  const { draft } = entry;
  const [confirming, setConfirming] = useState(false);
  const account = accounts.find((a) => a.id === draft.accountId);
  return (
    <section
      aria-label="New message"
      className="compose-card fixed right-4 bottom-4 z-40 flex h-[min(560px,calc(100vh-5rem))] w-[min(500px,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl"
      // The From account's colour along the top edge.
      style={{ borderTop: `2px solid ${account?.color ?? "transparent"}` }}
    >
      <header className="flex h-9 shrink-0 items-center gap-2 pr-1.5 pl-4">
        <h2 className="min-w-0 flex-1 truncate text-[13px] font-semibold">
          {draft.subject.trim() || "New message"}
        </h2>
        <button
          type="button"
          aria-label="Close"
          title={hasChanges(draft) ? "Close (asks first: drafts aren’t saved yet)" : "Close"}
          disabled={entry.sending}
          className="flex h-7 w-7 items-center justify-center rounded-md text-content/60 hover:bg-selection hover:text-content"
          onClick={() => (hasChanges(draft) ? setConfirming(true) : closeDraft(draft.id))}
        >
          <ClearIcon />
        </button>
      </header>
      <ComposeForm
        entry={entry}
        identities={identities}
        accounts={accounts}
        onChange={(change) => updateDraft(draft.id, change)}
        onSend={onSend}
        onDiscard={() => closeDraft(draft.id)}
      />
      {confirming && (
        <ConfirmDialog
          title="Discard this message?"
          confirmLabel="Discard"
          danger
          onConfirm={() => closeDraft(draft.id)}
          onCancel={() => setConfirming(false)}
        >
          <p>What you’ve written will be lost. Drafts aren’t saved to Gmail yet.</p>
        </ConfirmDialog>
      )}
    </section>
  );
}
