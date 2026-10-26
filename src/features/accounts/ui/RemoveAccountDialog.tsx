import type { Account, AccountId } from "../../../platform/tauri/bindings";
import { ConfirmDialog } from "../../../shared/ui/ConfirmDialog";
import { useRemoveAccount } from "./useRemoveAccount";
import { APP_NAME } from "../../../shared/lib/brand";

/** Asks before removing an account (from its menu or from Settings). */
export function RemoveAccountDialog({
  account,
  onCancel,
  onRemoved,
}: {
  account: Account;
  onCancel: () => void;
  onRemoved: (id: AccountId) => void;
}) {
  const remove = useRemoveAccount(onRemoved);
  return (
    <ConfirmDialog
      title={`Remove ${account.email}?`}
      confirmLabel="Remove"
      danger
      busy={remove.isPending}
      error={remove.error ? `Couldn't remove the account: ${remove.error.message}` : null}
      onConfirm={() => remove.mutate(account.id)}
      onCancel={onCancel}
    >
      <p>
        {APP_NAME} stops syncing it, deletes its mail saved on this Mac and forgets its sign-in.
      </p>
      <p>Nothing changes in Gmail. You can add the account again at any time.</p>
    </ConfirmDialog>
  );
}
