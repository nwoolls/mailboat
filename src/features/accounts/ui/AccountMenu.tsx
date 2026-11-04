import { useState } from "react";
import {
  commands,
  type Account,
  type AccountId,
  type AccountSyncState,
} from "../../../platform/tauri/bindings";
import { RemoveAccountIcon, SyncIcon } from "../../../shared/ui/icons";
import {
  Menu,
  type MenuAnchor,
  MenuHeader,
  MenuItem,
  MenuSeparator,
} from "../../../shared/ui/Menu";
import { syncHint } from "../model/accounts";
import { RemoveAccountDialog } from "./RemoveAccountDialog";

/** Which account's menu is open, and where. */
export type AccountMenuTarget = { account: Account; anchor: MenuAnchor };

/**
 * The menu behind an account's avatar (or a right-click on its header):
 * its sync status, "Sync now" and "Remove account…", which asks first.
 * When Google has signed the account out: "Sign in again".
 */
export function AccountMenu({
  target,
  state,
  onSignIn,
  onClose,
  onRemoved,
}: {
  target: AccountMenuTarget | null;
  state: AccountSyncState | undefined;
  onSignIn: (account: Account) => void;
  onClose: () => void;
  onRemoved: (id: AccountId) => void;
}) {
  // The account whose removal is being confirmed (the menu closes first).
  const [confirming, setConfirming] = useState<Account | null>(null);
  const signedOut = state?.status === "authError";

  return (
    <>
      {target && (
        <Menu anchor={target.anchor} onClose={onClose} label={`${target.account.email} menu`}>
          <MenuHeader>
            <div className="truncate font-medium text-content/80">{target.account.email}</div>
            <div className="truncate">{syncHint(state)}</div>
          </MenuHeader>
          <MenuSeparator />
          {signedOut && (
            <MenuItem
              icon={SyncIcon}
              onSelect={() => {
                onSignIn(target.account);
                onClose();
              }}
            >
              Sign in again
            </MenuItem>
          )}
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
              setConfirming(target.account);
              onClose();
            }}
          >
            Remove account…
          </MenuItem>
        </Menu>
      )}
      {confirming && (
        <RemoveAccountDialog
          account={confirming}
          onCancel={() => setConfirming(null)}
          onRemoved={(id) => {
            setConfirming(null);
            onRemoved(id);
          }}
        />
      )}
    </>
  );
}
