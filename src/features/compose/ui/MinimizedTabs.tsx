import type { Account } from "../../../platform/tauri/bindings";
import { ClearIcon } from "../../../shared/ui/icons";
import type { ComposeEntry } from "../model/composeState";
import { hasChanges } from "../model/draft";
import { closeDraft, expandCard } from "./useCompose";

/**
 * Minimised new messages, side by side along the bottom right (left of
 * the open card, if there is one). Clicking a tab opens it as the card.
 */
export function MinimizedTabs({
  entries,
  accounts,
  besideCard,
}: {
  entries: ComposeEntry[];
  accounts: Account[];
  /** The card is open at the lower right: start left of it. */
  besideCard: boolean;
}) {
  if (entries.length === 0) return null;
  return (
    <div
      className="fixed bottom-4 z-40 flex max-w-[calc(100vw-2rem)] flex-row-reverse gap-2"
      style={{ right: besideCard ? "calc(min(500px, 100vw - 2rem) + 1.5rem)" : "1rem" }}
    >
      {entries.map(({ draft }) => {
        const account = accounts.find((a) => a.id === draft.accountId);
        const title = draft.subject.trim() || "New message";
        return (
          <div
            key={draft.id}
            className="compose-card flex h-9 w-56 items-center rounded-lg pr-1"
            style={{ borderTop: `2px solid ${account?.color ?? "transparent"}` }}
          >
            <button
              type="button"
              title={`Open “${title}”`}
              onClick={() => expandCard(draft.id)}
              className="h-full min-w-0 flex-1 truncate pl-3 text-left text-[13px] font-medium"
            >
              {title}
            </button>
            <button
              type="button"
              aria-label="Close"
              // With writing in it, open it so the card asks before discarding.
              title={hasChanges(draft) ? "Open to discard" : "Close"}
              onClick={() => (hasChanges(draft) ? expandCard(draft.id) : closeDraft(draft.id))}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-content/60 hover:bg-selection hover:text-content"
            >
              <ClearIcon size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
