import { useState, useSyncExternalStore } from "react";
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
  useDefaultMailApp,
  useIdentities,
  useMakeDefaultMailApp,
  useSaveAppSettings,
  useSetAccountColor,
} from "../../../shared/lib/queries";
import { syncHint } from "../../accounts/model/accounts";
import { signInAgainReason } from "../../accounts/model/permissions";
import { AccountAvatar } from "../../accounts/ui/AccountAvatar";
import { RemoveAccountDialog } from "../../accounts/ui/RemoveAccountDialog";
import { useSignIn } from "../../accounts/ui/useSignIn";
import { SHORTCUTS } from "../../mailbox/model/shortcuts";
import type { AppSettings, DockBadge, Theme } from "../../../platform/tauri/bindings";
import {
  ACCENTS,
  DEFAULT_APPEARANCE,
  isDefault,
  seeThrough,
  sliderRange,
  withTint,
} from "../model/appearance";
import { Button, ChoiceGrid, Group, Row, Segmented, Slider, Swatches, Toggle } from "./controls";
import { SCREENSAVERS } from "../../screensaver/model/catalog";
import {
  PALETTES,
  type PaletteId,
  paletteColors,
  parseColor,
} from "../../screensaver/model/palettes";
import { screensaverPrefs } from "../../screensaver/ui/prefs";
import type { AfterRemoval } from "../../mailbox/model/threadActions";
import { viewingPrefs } from "../../mailbox/ui/viewingPrefs";
import { UNDO_SEND_CHOICES } from "../../compose/model/composingPrefs";
import { composingPrefs } from "../../compose/ui/composingPrefs";
import { FEATURE_FLAGS, setFeatureFlag, useFeatureFlags } from "../../../shared/lib/featureFlags";
import { useAppearance } from "./useAppearance";
import { AppIconPicker } from "./AppIconPicker";
import { iconSetting, shownIcon } from "../model/appIcon";
import { defaultMailAppRow } from "../model/mailApp";

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function GeneralSection() {
  const info = useAppInfo().data;
  return (
    <>
      <DefaultMailAppGroup />
      <Group title="About">
        <Row label="Mailboat" description={info ? `Version ${info.version}` : undefined} />
      </Group>
    </>
  );
}

/** Whether `mailto:` links open in Mailboat, and a button to make them. */
function DefaultMailAppGroup() {
  const current = useDefaultMailApp().data;
  const makeDefault = useMakeDefaultMailApp();
  if (!current) return null;
  const row = defaultMailAppRow(current);
  return (
    <Group title="Email links">
      <Row label="Default email reader" description={row.description}>
        {row.action && (
          <Button
            disabled={makeDefault.isPending}
            onClick={() =>
              makeDefault.mutate(undefined, {
                onError: (e) =>
                  showToast({
                    tone: "error",
                    message: `Mailboat isn’t the default: ${errorText(e)}`,
                  }),
              })
            }
          >
            {row.action}
          </Button>
        )}
      </Row>
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
  // Which sign-in is waiting for the browser: an account's address, or ""
  // for a new account. Nothing is ever disabled while it waits: closing
  // the browser tab can't be detected, so starting again (which replaces
  // the waiting sign-in) or cancelling is always possible, as with "+".
  const [waitingFor, setWaitingFor] = useState("");
  const start = (email: string | null) => {
    setWaitingFor(email ?? "");
    signIn.start(email);
  };
  const waiting = (email: string) => signIn.pending && waitingFor === email;
  return (
    <>
      {header(
        waiting("") ? (
          <span className="flex items-center gap-2 text-[12px] text-content/55">
            Waiting for browser sign-in…
            <Button onClick={() => start(null)}>Start again</Button>
            <Button onClick={signIn.cancel}>Cancel</Button>
          </span>
        ) : (
          <Button onClick={() => start(null)}>Add account</Button>
        ),
      )}
      {signIn.error && <p className="selectable pb-4 text-[12px] text-danger">{signIn.error}</p>}
      {accounts.map((account) => (
        <AccountGroup
          key={account.id}
          account={account}
          state={syncStates.find((s) => s.accountId === account.id)}
          waiting={waiting(account.email)}
          onSignIn={() => start(account.email)}
          onCancelSignIn={signIn.cancel}
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
  waiting,
  onSignIn,
  onCancelSignIn,
  onRemove,
}: {
  account: Account;
  state: AccountSyncState | undefined;
  /** Its sign-in is waiting for the browser. */
  waiting: boolean;
  onSignIn: () => void;
  onCancelSignIn: () => void;
  onRemove: () => void;
}) {
  const colors = useAppInfo().data?.accountColors ?? [];
  const setColor = useSetAccountColor();
  const addresses = (useIdentities().data ?? []).filter((i) => i.accountId === account.id);
  const name = account.displayName?.trim();
  const reason = signInAgainReason(account.missingPermissions);
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
        <Swatches
          label="Account colour"
          value={account.color.toLowerCase()}
          options={colors.map((c) => ({ value: c.toLowerCase(), label: c, color: c }))}
          onChange={(color) =>
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
        />
      </Row>
      <Row label="Sync" description={syncHint(state)}>
        <Button onClick={() => void commands.syncNow([account.id])}>Sync now</Button>
      </Row>
      <Row
        label="Sign in again"
        description={
          waiting ? (
            "Waiting for you to finish in the browser. Closed it? Start again."
          ) : reason ? (
            <span className="text-warn">{reason}</span>
          ) : (
            "If Google asks you to, or to give Mailboat new permissions."
          )
        }
      >
        {waiting ? (
          <>
            <Button onClick={onSignIn}>Start again</Button>
            <Button onClick={onCancelSignIn}>Cancel</Button>
          </>
        ) : (
          <Button onClick={onSignIn}>Sign in again</Button>
        )}
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
            <p className="mt-2">
              Addresses are changed in Gmail; signatures in Settings → Signatures.
            </p>
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
      <Row
        label="Dock badge"
        description="How many unread conversations are in All Inboxes or in Unread, on Mailboat’s Dock icon."
      >
        <Segmented
          label="Dock badge"
          value={settings?.dockBadge ?? "inbox"}
          options={DOCK_BADGES}
          disabled={!settings}
          onChange={(dockBadge) =>
            settings &&
            save.mutate(
              { ...settings, dockBadge },
              {
                onError: (e) =>
                  showToast({ tone: "error", message: `Couldn’t save: ${errorText(e)}` }),
              },
            )
          }
        />
      </Row>
    </Group>
  );
}

const DOCK_BADGES: { value: DockBadge; label: string }[] = [
  { value: "inbox", label: "All Inboxes" },
  { value: "unread", label: "Unread" },
  { value: "off", label: "Off" },
];

export function ViewingSection() {
  const prefs = viewingPrefs.use();
  return (
    <Group title="Conversations">
      <Row
        label="After archiving or deleting"
        description="What opens when the open conversation leaves the list."
      >
        <Segmented
          label="After archiving or deleting"
          value={prefs.afterRemoval}
          options={AFTER_REMOVAL}
          onChange={(afterRemoval) => viewingPrefs.set({ ...prefs, afterRemoval })}
        />
      </Row>
    </Group>
  );
}

export function ComposingSection() {
  const prefs = composingPrefs.use();
  return (
    <Group title="Sending">
      <Row
        label="Undo send"
        description="How long Undo can stop a message after you send it. It waits that long before going to Gmail."
      >
        <Segmented
          label="Undo send"
          value={String(prefs.undoSendSeconds)}
          options={UNDO_SEND_CHOICES.map((s) => ({ value: String(s), label: `${s} sec` }))}
          onChange={(value) =>
            composingPrefs.set({
              ...prefs,
              undoSendSeconds: UNDO_SEND_CHOICES.find((s) => String(s) === value) ?? 5,
            })
          }
        />
      </Row>
    </Group>
  );
}

const AFTER_REMOVAL: { value: AfterRemoval; label: string }[] = [
  { value: "below", label: "Next below" },
  { value: "above", label: "Next above" },
  { value: "none", label: "Nothing" },
];

const LIGHT = "(prefers-color-scheme: light)";

/**
 * Whether the page is light now. Changing the theme flips this a moment
 * after the setting saves (macOS redraws the window), so the see-through
 * percentages, which differ between light and dark, re-read then.
 */
function useLight(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(LIGHT);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia(LIGHT).matches,
  );
}

/** A percentage CSS variable on the page (light and dark differ), as a number. */
function cssPercent(name: string): number {
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0;
}

const THEMES: { value: Theme; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export function AppearanceSection({
  header,
}: {
  /** The page header, which holds "Restore defaults". */
  header: (action: React.ReactNode) => React.ReactNode;
}) {
  const [appearance, setAppearance] = useAppearance();
  // Read for its re-render: the bases below differ between light and dark.
  useLight();
  const settings = useAppSettings().data;
  const save = useSaveAppSettings();
  const iconChoices = useAppInfo().data?.iconChoices ?? [];
  const theme = settings?.theme ?? "system";
  const icon = shownIcon(settings?.appIcon);
  const change = (next: Partial<AppSettings>) =>
    settings &&
    save.mutate(
      { ...settings, ...next },
      {
        onError: (e) => showToast({ tone: "error", message: `Couldn’t save: ${errorText(e)}` }),
      },
    );
  const setTheme = (next: Theme) => change({ theme: next });
  return (
    <>
      {header(
        <Button
          onClick={() => {
            setAppearance(DEFAULT_APPEARANCE);
            change({ theme: "system", appIcon: null });
          }}
          disabled={isDefault(appearance) && theme === "system" && !settings?.appIcon}
        >
          Restore defaults
        </Button>,
      )}
      <Group title="Theme">
        <Row label="Theme" description="System follows macOS, light or dark.">
          <Segmented
            label="Theme"
            value={theme}
            options={THEMES}
            onChange={setTheme}
            disabled={!settings}
          />
        </Row>
        <Row
          label="Accent colour"
          description="Buttons, switches, the focused conversation and other highlights."
        >
          <Swatches
            label="Accent colour"
            value={appearance.accent}
            options={ACCENTS.map((a) => ({ value: a.id, label: a.label, color: a.color }))}
            onChange={(accent) => setAppearance({ ...appearance, accent })}
          />
        </Row>
      </Group>
      <Group
        title="App icon"
        description="Shows in the Dock while Mailboat is open. Finder, and the Dock once Mailboat quits, keep the built-in icon."
      >
        <div className="px-4 pt-0.5 pb-3.5">
          <AppIconPicker
            choices={iconChoices}
            value={icon}
            onChange={(choice) => change({ appIcon: iconSetting(choice) })}
            disabled={!settings}
          />
        </div>
      </Group>
      <Group
        title="Transparency"
        description="How much of what’s behind the window shows through. More see-through looks lighter; less is easier to read."
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
    </>
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

/** Settings → Toybox: the empty list's glow and screensavers. */
export function ToyboxSection() {
  const flags = useFeatureFlags();
  const prefs = screensaverPrefs.use();
  return (
    <>
      <Group
        title="Inbox Zero"
        description="When a view has no mail: your Inbox, a label or a search. Remembered on this Mac."
      >
        {FEATURE_FLAGS.map((flag) => (
          <Row key={flag.id} label={flag.label} description={flag.description}>
            <Toggle
              label={flag.label}
              on={flags[flag.id]}
              onChange={(on) => setFeatureFlag(flag.id, on)}
            />
          </Row>
        ))}
      </Group>
      {flags.screensavers && (
        <Group
          title="Screensaver"
          description="Plays at Inbox Zero. To try one now, open a view with no mail and use “Start screensaver” in ⌘K."
        >
          <div className="px-4 py-3.5">
            <ChoiceGrid
              label="Screensaver"
              value={prefs.choice}
              options={[
                { value: "random", label: "Random" },
                ...SCREENSAVERS.map((s) => ({ value: s.id, label: s.label })),
              ]}
              onChange={(choice) => screensaverPrefs.set({ ...prefs, choice })}
            />
          </div>
          <div className="px-4 pb-2">
            <div className="text-[13px] font-medium text-content">Colours</div>
            <div className="mt-1 text-[12px] leading-relaxed text-content/45">
              “Mono + accent” and “Accent” follow the accent colour in Appearance.
            </div>
          </div>
          <div className="px-4 pb-3.5">
            <ChoiceGrid
              label="Colours"
              columns={3}
              value={prefs.palette}
              options={PALETTES.map((p) => ({
                value: p.id,
                label: p.label,
                picture: <PaletteStrip id={p.id} />,
              }))}
              onChange={(palette) => screensaverPrefs.set({ ...prefs, palette })}
            />
          </div>
        </Group>
      )}
    </>
  );
}

const SLOT_NAMES = ["dark", "mid", "light", "bright", "accent"];

/** A palette's five colours as a row of pixel squares. */
function PaletteStrip({ id }: { id: PaletteId }) {
  const accent = parseColor(
    getComputedStyle(document.documentElement).getPropertyValue("--color-accent"),
  );
  return (
    <span className="flex gap-px" aria-hidden>
      {paletteColors(id, accent).map((c, i) => (
        <span
          key={SLOT_NAMES[i]}
          className="size-3.5"
          style={{ background: `rgb(${c.join(" ")})` }}
        />
      ))}
    </span>
  );
}
