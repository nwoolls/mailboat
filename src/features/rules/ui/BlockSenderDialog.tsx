import type { AccountId } from "../../../platform/tauri/bindings";
import { useSaveRule } from "../../../shared/lib/queries";
import { showToast } from "../../../shared/lib/toast";
import { ConfirmDialog } from "../../../shared/ui/ConfirmDialog";
import { blockRule } from "../model/likeThis";

/**
 * "Block sender": a rule sending their mail to the Trash, applied to what
 * they've sent already too. Gmail's own Block list can't be reached from
 * its API, so this is the rule Gmail's filter form would make.
 */
export function BlockSenderDialog({
  accountId,
  email,
  onClose,
}: {
  accountId: AccountId;
  email: string;
  onClose: () => void;
}) {
  const save = useSaveRule();
  return (
    <ConfirmDialog
      title={`Block ${email}?`}
      confirmLabel="Block"
      danger
      busy={save.isPending}
      error={save.error?.message}
      onCancel={onClose}
      onConfirm={() =>
        save.mutate(
          { accountId, filterId: null, ...blockRule(email), applyToExisting: true },
          {
            onSuccess: (saved) => {
              onClose();
              const moved = saved.applied?.messages ?? 0;
              showToast({
                message:
                  moved > 0
                    ? `Blocked ${email}; ${moved.toLocaleString("en-US")} ${moved === 1 ? "message" : "messages"} moved to the Trash`
                    : `Blocked ${email}`,
              });
            },
          },
        )
      }
    >
      <p>Their mail, what’s here now and anything new, goes to the Trash.</p>
      <p>To undo it, delete the rule in Settings → Rules.</p>
    </ConfirmDialog>
  );
}
