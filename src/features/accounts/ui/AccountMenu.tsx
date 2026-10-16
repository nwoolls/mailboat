import { useState } from "react";
import {
  commands,
  type Account,
  type AccountId,
  type AccountSyncState,
} from "../../../platform/tauri/bindings";
import { ConfirmDialog } from "../../../shared/ui/ConfirmDialog";
import { RemoveAccountIcon, SyncIcon } from "../../../shared/ui/icons";
import {
  Menu,
  type MenuAnchor,
  MenuHeader,
  MenuItem,
  MenuSeparator,
} from "../../../shared/ui/Menu";
import { syncHint } from "../model/accounts";
import { useRemoveAccount } from "./useRemoveAccount";

/** Which account's menu is open, and where. */
export type AccountMenuTarget = { account: Account; anchor: MenuAnchor };

/**
 * The menu behind an account's avatar (or a right-click on its header):
 * its sync status, "Sync now" and "Remove account…", which asks first.
 */
export function AccountMenu({
  target,
  state,
  onClose,
  onRemoved,
}: {
  target: AccountMenuTarget | null;
  state: AccountSyncState | undefined;
  onClose: () => void;
  onRemoved: (id: AccountId) => void;
}) {
  // The account whose removal is being confirmed (the menu closes first).
  const [confirming, setConfirming] = useState<Account | null>(null);
  const remove = useRemoveAccount((id) => {
    setConfirming(null);
    onRemoved(id);
  });

  return (
    <>
      {target && (
        <Menu anchor={target.anchor} onClose={onClose} label={`${target.account.email} menu`}>
          <MenuHeader>
            <div className="truncate font-medium text-content/80">{target.account.email}</div>
            <div className="truncate">{syncHint(state)}</div>
          </MenuHeader>
          <MenuSeparator />
          <MenuItem
            icon={SyncIcon}
            onSelect={() => {
              void commands.syncNow([target.account.id]);
              onClose();
            }}
          >
            Sync now
          </MenuItem>
          <MenuItem
            icon={RemoveAccountIcon}
            danger
            onSelect={() => {
              remove.reset();
              setConfirming(target.account);
              onClose();
            }}
          >
            Remove account…
          </MenuItem>
        </Menu>
      )}
      {confirming && (
        <ConfirmDialog
          title={`Remove ${confirming.email}?`}
          confirmLabel="Remove"
          danger
          busy={remove.isPending}
          error={remove.error ? `Couldn't remove the account: ${remove.error.message}` : null}
          onConfirm={() => remove.mutate(confirming.id)}
          onCancel={() => setConfirming(null)}
        >
          <p>Mailboat stops syncing it, deletes its mail saved on this Mac and forgets its sign-in.</p>
          <p>Nothing changes in Gmail. You can add the account again at any time.</p>
        </ConfirmDialog>
      )}
    </>
  );
}
