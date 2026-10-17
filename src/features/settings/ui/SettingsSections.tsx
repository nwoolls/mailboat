import { useState } from "react";
import {
  commands,
  type Account,
  type AccountId,
  type AccountSyncState,
} from "../../../platform/tauri/bindings";
import { unwrap } from "../../../platform/tauri/ipc";
import { showToast } from "../../../shared/lib/toast";
import {
  useAppInfo,
  useAppSettings,
  useIdentities,
  useSaveAppSettings,
  useSetAccountColor,
} from "../../../shared/lib/queries";
import { CheckIcon } from "../../../shared/ui/icons";
import { syncHint } from "../../accounts/model/accounts";
import { AccountAvatar } from "../../accounts/ui/AccountAvatar";
import { RemoveAccountDialog } from "../../accounts/ui/RemoveAccountDialog";
import { useSignIn } from "../../accounts/ui/useSignIn";
import { SHORTCUTS } from "../../mailbox/model/shortcuts";
import {
  DEFAULT_APPEARANCE,
  isDefault,
  seeThrough,
  sliderRange,
  withTint,
} from "../model/appearance";
import { Button, Group, Row, Slider, Toggle } from "./controls";
import { useAppearance } from "./useAppearance";

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function GeneralSection() {
  const info = useAppInfo().data;
  return (
    <Group title="About">
      <Row label="Mailboat" description={info ? `Version ${info.version}` : undefined} />
    </Group>
  );
}

export function AccountsSection({
  accounts,
  syncStates,
  onAccountRemoved,
  header,
}: {
  accounts: Account[];
  syncStates: AccountSyncState[];
  onAccountRemoved: (id: AccountId) => void;
  /** The page header, which holds "Add account" (it shares the sign-in). */
  header: (action: React.ReactNode) => React.ReactNode;
}) {
  const signIn = useSignIn();
  const [removing, setRemoving] = useState<Account | null>(null);
  return (
    <>
      {header(
        signIn.pending ? (
          <span className="flex items-center gap-2 text-[12px] text-content/55">
            Waiting for browser sign-in…
            <Button onClick={signIn.cancel}>Cancel</Button>
          </span>
        ) : (
          <Button onClick={() => signIn.start()}>Add account</Button>
        ),
      )}
      {signIn.error && <p className="selectable pb-4 text-[12px] text-danger">{signIn.error}</p>}
      {accounts.map((account) => (
        <AccountGroup
          key={account.id}
          account={account}
          state={syncStates.find((s) => s.accountId === account.id)}
          busy={signIn.pending}
          onSignIn={() => signIn.start(account.email)}
          onRemove={() => setRemoving(account)}
        />
      ))}
      {removing && (
        <RemoveAccountDialog
          account={removing}
          onCancel={() => setRemoving(null)}
          onRemoved={(id) => {
            setRemoving(null);
            onAccountRemoved(id);
          }}
        />
      )}
    </>
  );
}

function AccountGroup({
  account,
  state,
  busy,
  onSignIn,
  onRemove,
}: {
  account: Account;
  state: AccountSyncState | undefined;
  busy: boolean;
  onSignIn: () => void;
  onRemove: () => void;
}) {
  const colors = useAppInfo().data?.accountColors ?? [];
  const setColor = useSetAccountColor();
  const addresses = (useIdentities().data ?? []).filter((i) => i.accountId === account.id);
  const name = account.displayName?.trim();
  return (
    <Group
      title={
        <>
          <AccountAvatar account={account} state={state} />
          <span className="truncate">{name || account.email}</span>
          {name && <span className="truncate font-normal text-content/45">{account.email}</span>}
        </>
      }
    >
      <Row
        label="Colour"
        description="Marks its conversations where several accounts show together."
      >
        <div role="radiogroup" aria-label="Account colour" className="flex gap-1.5">
          {colors.map((color) => {
            const chosen = color.toLowerCase() === account.color.toLowerCase();
            return (
              <button
                key={color}
                type="button"
                role="radio"
                aria-checked={chosen}
                aria-label={color}
                onClick={() =>
                  setColor.mutate(
                    { account: account.id, color },
                    {
                      onError: (e) =>
                        showToast({
                          tone: "error",
                          message: `Couldn’t change the colour: ${errorText(e)}`,
                        }),
                    },
                  )
                }
                className={`flex size-5 items-center justify-center rounded-full text-white transition-shadow duration-[120ms] ${
                  chosen ? "ring-2 ring-content/60 ring-offset-1 ring-offset-transparent" : ""
                }`}
                style={{ background: color }}
              >
                {chosen && <CheckIcon size={12} strokeWidth={2.5} />}
              </button>
            );
          })}
        </div>
      </Row>
      <Row label="Sync" description={syncHint(state)}>
        <Button onClick={() => void commands.syncNow([account.id])}>Sync now</Button>
      </Row>
      <Row
        label="Sign in again"
        description="If Google asks you to, or to give Mailboat new permissions."
      >
        <Button onClick={onSignIn} disabled={busy}>
          Sign in again
        </Button>
      </Row>
      <Row
        label="Send mail as"
        description={
          <>
            <ul className="mt-1.5 space-y-1">
              {addresses.map((a) => (
                <li key={a.email} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-content/75">{a.email}</span>
                  {a.name && <span>{a.name}</span>}
                  {a.isDefault && addresses.length > 1 && <Tag>Default</Tag>}
                  {a.signature?.trim() && <Tag>Signature</Tag>}
                </li>
              ))}
            </ul>
            <p className="mt-2">Addresses and signatures are changed in Gmail for now.</p>
          </>
        }
      >
        <Button
          onClick={() =>
            void unwrap(
              commands.linkOpen(
                `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(account.email)}#settings/accounts`,
              ),
            ).catch((e: unknown) =>
              showToast({ tone: "error", message: `Couldn’t open Gmail: ${errorText(e)}` }),
            )
          }
        >
          Open in Gmail
        </Button>
      </Row>
      <Row
        label="Remove account"
        description="Stops syncing it and deletes its mail saved on this Mac. Nothing changes in Gmail."
      >
        <Button danger onClick={onRemove}>
          Remove…
        </Button>
      </Row>
    </Group>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded bg-content/8 px-1.5 py-px text-[11px] text-content/60">
      {children}
    </span>
  );
}

export function NotificationsSection() {
  const settings = useAppSettings().data;
  const save = useSaveAppSettings();
  return (
    <Group title="New mail">
      <Row
        label="Notify me about new mail"
        description="When new mail arrives in an Inbox. Not your own messages or drafts, and not while an account first syncs."
      >
        <Toggle
          label="Notify me about new mail"
          on={settings?.newMailNotifications ?? true}
          disabled={!settings}
          onChange={(on) =>
            settings &&
            save.mutate(
              { ...settings, newMailNotifications: on },
              {
                onError: (e) =>
                  showToast({ tone: "error", message: `Couldn’t save: ${errorText(e)}` }),
              },
            )
          }
        />
      </Row>
      <Row
        label="Style and sound"
        description="macOS decides whether they show, as banners or alerts, and with what sound."
      >
        <Button
          onClick={() =>
            void unwrap(commands.notificationSettingsOpen()).catch((e: unknown) =>
              showToast({
                tone: "error",
                message: `Couldn’t open System Settings: ${errorText(e)}`,
              }),
            )
          }
        >
          Open System Settings
        </Button>
      </Row>
    </Group>
  );
}

/** A percentage CSS variable on the page (light and dark differ), as a number. */
function cssPercent(name: string): number {
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0;
}

export function AppearanceSection() {
  const [appearance, setAppearance] = useAppearance();
  return (
    <Group
      title="Transparency"
      description="How much of what’s behind the window shows through. More see-through looks lighter; less is easier to read."
      action={
        <Button onClick={() => setAppearance(DEFAULT_APPEARANCE)} disabled={isDefault(appearance)}>
          Restore defaults
        </Button>
      }
    >
      {(
        [
          ["sidebarTint", "Sidebar and reader", "--glass-sidebar-base"],
          ["listTint", "Conversation list", "--glass-panel-base"],
        ] as const
      ).map(([key, label, baseVar]) => (
        <Row key={key} label={label}>
          <Slider
            label={`${label} see-through`}
            value={-appearance[key]}
            display={`${seeThrough(cssPercent(baseVar), appearance[key])}%`}
            {...sliderRange(key)}
            onChange={(v) => setAppearance(withTint(appearance, key, -v))}
            onReset={() => setAppearance(withTint(appearance, key, 0))}
          />
        </Row>
      ))}
    </Group>
  );
}

export function KeyboardSection() {
  return (
    <>
      {SHORTCUTS.map((group) => (
        <Group key={group.group} title={group.group}>
          {group.keys.map(([keys, what]) => (
            <Row key={`${keys}:${what}`} label={<span className="font-normal">{what}</span>}>
              <kbd className="font-sans text-[12px] font-medium text-content/70">{keys}</kbd>
            </Row>
          ))}
        </Group>
      ))}
    </>
  );
}
