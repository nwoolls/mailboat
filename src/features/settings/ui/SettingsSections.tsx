import { useState, useSyncExternalStore } from "react";
import {
  commands,
  type Account,
  type AccountId,
  type AccountSyncState,
  type UpdateChannel,
} from "../../../platform/tauri/bindings";
import { unwrap } from "../../../platform/tauri/ipc";
import { showToast } from "../../../shared/lib/toast";
import { ConfirmDialog } from "../../../shared/ui/ConfirmDialog";
import { formatSize } from "../../reader/model/attachments";
import { restoreWindowDefaults } from "./restoreDefaults";
import {
  useAppInfo,
  useAccounts,
  useAppSettings,
  useCacheSize,
  useClearCache,
  useClearImageCache,
  useDefaultMailApp,
  useImageCacheSize,
  useIdentities,
  useMakeDefaultMailApp,
  useSaveAppSettings,
  useSetAccountColor,
} from "../../../shared/lib/queries";
import { syncHint } from "../../accounts/model/accounts";
import { signInAgainReason } from "../../accounts/model/permissions";
import { AccountAvatar } from "../../accounts/ui/AccountAvatar";
import { DeleteAllDataDialog } from "../../accounts/ui/DeleteAllDataDialog";
import { RemoveAccountDialog } from "../../accounts/ui/RemoveAccountDialog";
import { useSignIn } from "../../accounts/ui/useSignIn";
import { explainSignInError } from "../../onboarding/model/onboarding";
import { SHORTCUTS } from "../../mailbox/model/shortcuts";
import type {
  AppSettings,
  DockBadge,
  NotifyFor,
  RemoteImages,
  Theme,
} from "../../../platform/tauri/bindings";
import {
  ACCENTS,
  DEFAULT_APPEARANCE,
  isDefault,
  seeThrough,
  tintFor,
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
import { listPrefs } from "../../mailbox/ui/listPrefs";
import { TOYS } from "../../emptyToys/model/toys";
import { emptyToy } from "../../emptyToys/ui/prefs";
import { type Density, SWIPE_CHOICES, type SwipeChoice } from "../../mailbox/model/listPrefs";
import {
  MARK_READ_DELAY_MS,
  type MarkRead,
  type DeleteKey,
  type MessageOrder,
} from "../../mailbox/model/viewingPrefs";
import { UNDO_SEND_CHOICES } from "../../compose/model/composingPrefs";
import { FONTS, SIZES } from "../../compose/model/fonts";
import { sameEmail } from "../../compose/model/addresses";
import { composingPrefs } from "../../compose/ui/composingPrefs";
import { TEXT_SIZES } from "../model/textSize";
import { minutesOf, timeValue } from "../model/quietHours";
import { textSize } from "./textSize";
import { FEATURE_FLAGS, setFeatureFlag, useFeatureFlags } from "../../../shared/lib/featureFlags";
import { useAppearance } from "./useAppearance";
import { AppIconPicker } from "./AppIconPicker";
import { IS_MAC } from "../../../shared/lib/platform";
import { iconSetting, shownIcon } from "../model/appIcon";
import { defaultMailAppRow } from "../model/mailApp";
import { describeImageCache, IMAGE_CACHE_SIZES } from "../model/imageCache";
import { APP_NAME } from "../../../shared/lib/brand";
import { leavesRows, STAYS_ON_THIS_COMPUTER } from "../model/privacy";
import type { SettingsSectionId } from "../model/sections";
import { canCheck, describeUpdate } from "../../updates/model/update";
import { checkForUpdates, installUpdate, useUpdateState } from "../../updates/ui/updateStore";

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function GeneralSection() {
  const info = useAppInfo().data;
  const settings = useAppSettings().data;
  const save = useSaveAppSettings();
  const update = useUpdateState();
  return (
    <>
      <DefaultMailAppGroup />
      <Group title="About">
        <Row label={`${APP_NAME}`} description={info ? `Version ${info.version}` : undefined} />
        <Row label="Updates" description={describeUpdate(update)}>
          {update.kind === "available" ? (
            <Button onClick={() => void installUpdate()}>Install and restart</Button>
          ) : (
            <Button disabled={!canCheck(update)} onClick={() => void checkForUpdates()}>
              Check for updates
            </Button>
          )}
        </Row>
        <Row
          label="Update channel"
          description="Stable gets finished releases only. Beta also gets test versions first, which may have bugs. Going back to Stable doesn’t install an older version: it waits for the next finished release."
        >
          <select
            aria-label="Update channel"
            value={settings?.updateChannel ?? "stable"}
            // Not while a look or an install is running: its answer would be
            // for the channel the person just left.
            disabled={!settings || !canCheck(update)}
            onChange={(e) =>
              settings &&
              save.mutate(
                { ...settings, updateChannel: e.target.value as UpdateChannel },
                {
                  onSuccess: () => void checkForUpdates(),
                  onError: (err) =>
                    showToast({ tone: "error", message: `Couldn’t save: ${errorText(err)}` }),
                },
              )
            }
            className={SELECT_CLASS}
          >
            <option value="stable">Stable</option>
            <option value="beta">Beta</option>
          </select>
        </Row>
        <Row
          label="Check for updates automatically"
          description="Looks when the app starts and about once a day, and tells you when there is a new version. It never installs one by itself. A look fetches one file from the update server, which passes it on to GitHub, so both see your IP address. Installing an update also tells GitHub your kind of computer."
        >
          <Toggle
            label="Check for updates automatically"
            on={settings?.autoCheckUpdates ?? true}
            disabled={!settings}
            onChange={(autoCheckUpdates) =>
              settings &&
              save.mutate(
                { ...settings, autoCheckUpdates },
                {
                  onError: (e) =>
                    showToast({ tone: "error", message: `Couldn’t save: ${errorText(e)}` }),
                },
              )
            }
          />
        </Row>
      </Group>
    </>
  );
}

/**
 * Everything that leaves this computer and the setting behind it, read from
 * the real settings. Read-only: each row links to the section where it is
 * changed, so there is still one place to change each thing.
 */
export function PrivacySection({
  accounts,
  onSelect,
}: {
  accounts: Account[];
  onSelect: (section: SettingsSectionId) => void;
}) {
  const settings = useAppSettings().data;
  if (!settings) return null;
  return (
    <>
      <Group title="Leaves this computer">
        {leavesRows(
          settings,
          accounts.map((a) => a.id),
        ).map((r) => (
          <Row
            key={r.id}
            label={r.where}
            description={
              <>
                <span className="block">{r.gets}</span>
                <span className="block">{r.when}</span>
                <span className="mt-1 block text-content/70">{r.now}</span>
              </>
            }
          >
            <Button
              label={`${r.where}: change in ${r.sectionLabel}`}
              onClick={() => onSelect(r.section)}
            >
              Change in {r.sectionLabel}
            </Button>
          </Row>
        ))}
      </Group>
      <Group title="Stays on this computer">
        {STAYS_ON_THIS_COMPUTER.map((line) => (
          <Row key={line} label={line} />
        ))}
      </Group>
    </>
  );
}

/** Whether `mailto:` links open in the app, and a button to make them. */
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
                    message: `${APP_NAME} isn’t the default: ${errorText(e)}`,
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
  const [deletingAll, setDeletingAll] = useState(false);
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
      {signIn.error && (
        <p className="selectable pb-4 text-[12px] text-danger">
          {explainSignInError(signIn.error).message}
        </p>
      )}
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
      <Group title="Delete everything">
        <Row
          label={`Delete all ${APP_NAME} data`}
          description={`Removes every account and deletes all the mail, files, summaries and settings ${APP_NAME} keeps on this computer, as on a first launch. Gmail itself isn't changed.`}
        >
          <Button onClick={() => setDeletingAll(true)}>Delete all data…</Button>
        </Row>
      </Group>
      {deletingAll && <DeleteAllDataDialog onCancel={() => setDeletingAll(false)} />}
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
        label="Color"
        description="Marks its conversations where several accounts show together."
      >
        <Swatches
          label="Account color"
          value={account.color.toLowerCase()}
          options={colors.map((c) => ({ value: c.toLowerCase(), label: c, color: c }))}
          onChange={(color) =>
            setColor.mutate(
              { account: account.id, color },
              {
                onError: (e) =>
                  showToast({
                    tone: "error",
                    message: `Couldn’t change the color: ${errorText(e)}`,
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
            "Waiting for you to finish in the browser. Google showing “Access blocked”? Add this address under Test users in Google Cloud, then start again."
          ) : reason ? (
            <span className="text-warn">{reason}</span>
          ) : (
            `If Google signed this account out, or to give ${APP_NAME} new permissions.`
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
  // As Rust fills in any part not saved yet.
  const quiet = { on: false, start: 22 * 60, end: 7 * 60, ...settings?.quietHours };
  const update = (change: Partial<AppSettings>) =>
    settings &&
    save.mutate(
      { ...settings, ...change },
      {
        onError: (e) => showToast({ tone: "error", message: `Couldn’t save: ${errorText(e)}` }),
      },
    );
  return (
    <>
      <Group title="New mail">
        <Row
          label="Notify me about new mail"
          description="When new mail arrives. Not your own messages or drafts, and not while an account first syncs."
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
          label="Notify about"
          description="Mail in an Inbox, or anything new except Spam and Trash (such as mail a rule skipped the Inbox for)."
        >
          <Segmented
            label="Notify about"
            value={settings?.notifyFor ?? "inbox"}
            options={NOTIFY_FOR}
            disabled={!settings || !settings.newMailNotifications}
            onChange={(notifyFor) => update({ notifyFor })}
          />
        </Row>
        <Row
          label="Quiet hours"
          description="No notifications between these times, every day. Mail still arrives."
        >
          <div className="flex items-center gap-2 text-[12px] text-content/60">
            {settings && quiet.on && (
              <>
                <input
                  type="time"
                  aria-label="Quiet from"
                  value={timeValue(quiet.start)}
                  onChange={(e) => {
                    const start = minutesOf(e.target.value);
                    if (start !== null) update({ quietHours: { ...quiet, start } });
                  }}
                  className={TIME_CLASS}
                />
                <span>to</span>
                <input
                  type="time"
                  aria-label="Quiet until"
                  value={timeValue(quiet.end)}
                  onChange={(e) => {
                    const end = minutesOf(e.target.value);
                    if (end !== null) update({ quietHours: { ...quiet, end } });
                  }}
                  className={TIME_CLASS}
                />
              </>
            )}
            <Toggle
              label="Quiet hours"
              on={quiet.on}
              disabled={!settings || !settings.newMailNotifications}
              onChange={(on) => update({ quietHours: { ...quiet, on } })}
            />
          </div>
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
      <Group title="Dock">
        <Row
          label="Unread count"
          description={`On ${APP_NAME}’s Dock icon: unread conversations in Inbox or in Unread (every account’s), as the sidebar counts them.`}
        >
          <Segmented
            label="Unread count on the Dock"
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
    </>
  );
}

const NOTIFY_FOR: { value: NotifyFor; label: string }[] = [
  { value: "inbox", label: "Inbox" },
  { value: "allNew", label: "All new mail" },
];

const TIME_CLASS =
  "h-7 rounded-md border border-content/10 bg-transparent px-1.5 text-[12px] text-content/80 tabular-nums";

const DOCK_BADGES: { value: DockBadge; label: string }[] = [
  { value: "inbox", label: "Inbox" },
  { value: "unread", label: "Unread" },
  { value: "off", label: "Off" },
];

const SWIPE_LABELS: Record<SwipeChoice, string> = {
  archive: "Archive",
  trash: "Move to Trash",
  read: "Mark as read / unread",
  star: "Star / Unstar",
  spam: "Report spam",
  none: "Nothing",
};

const DENSITIES: { value: Density; label: string }[] = [
  { value: "compact", label: "Compact" },
  { value: "default", label: "Default" },
  { value: "roomy", label: "Roomy" },
];

const PREVIEW_LINES: { value: string; label: string }[] = [
  { value: "0", label: "None" },
  { value: "1", label: "1 line" },
  { value: "2", label: "2 lines" },
];

/** Settings → List: how rows look, and what the list's swipes do. */
export function ListSection() {
  const prefs = listPrefs.use();
  const choice = (side: "swipeLeft" | "swipeRight", label: string, description: string) => (
    <Row label={label} description={description}>
      <select
        aria-label={label}
        value={prefs[side]}
        onChange={(e) => listPrefs.set({ ...prefs, [side]: e.target.value as SwipeChoice })}
        className={SELECT_CLASS}
      >
        {SWIPE_CHOICES.map((c) => (
          <option key={c} value={c}>
            {SWIPE_LABELS[c]}
          </option>
        ))}
      </select>
    </Row>
  );
  return (
    <>
      <Group title="Rows">
        <Row label="Density" description="How much room each conversation has.">
          <Segmented
            label="Density"
            value={prefs.density}
            options={DENSITIES}
            onChange={(density) => listPrefs.set({ ...prefs, density })}
          />
        </Row>
        <Row
          label="Preview"
          description="Lines of each conversation’s first words (or its AI summary) under the subject."
        >
          <Segmented
            label="Preview"
            value={String(prefs.previewLines)}
            options={PREVIEW_LINES}
            onChange={(v) =>
              listPrefs.set({ ...prefs, previewLines: v === "0" ? 0 : v === "2" ? 2 : 1 })
            }
          />
        </Row>
      </Group>
      <Group title="Swipes">
        {choice(
          "swipeLeft",
          "Swipe left",
          "Two fingers to the left on a conversation. Archive moves to Trash where there’s no Inbox to leave.",
        )}
        {choice(
          "swipeRight",
          "Swipe right",
          "Two fingers to the right. Each choice undoes itself where it’s already done (Restore in Trash, Not spam in Spam).",
        )}
      </Group>
    </>
  );
}

export function ViewingSection() {
  const prefs = viewingPrefs.use();
  const settings = useAppSettings().data;
  const save = useSaveAppSettings();
  const cache = useImageCacheSize().data;
  const clearCache = useClearImageCache();
  const update = (change: Partial<AppSettings>) =>
    settings &&
    save.mutate(
      { ...settings, ...change },
      {
        onError: (e) => showToast({ tone: "error", message: `Couldn’t save: ${errorText(e)}` }),
      },
    );
  return (
    <>
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
        <Row
          label="Mark as read"
          description="When opening an unread conversation marks it read. With a delay, moving on sooner leaves it unread."
        >
          <Segmented
            label="Mark as read"
            value={prefs.markRead}
            options={MARK_READ}
            onChange={(markRead) => viewingPrefs.set({ ...prefs, markRead })}
          />
        </Row>
        <Row
          label="Delete key"
          description="What Delete does to the selected conversations. # and e still trash and archive."
        >
          <Segmented
            label="Delete key"
            value={prefs.deleteKey}
            options={DELETE_KEYS}
            onChange={(deleteKey) => viewingPrefs.set({ ...prefs, deleteKey })}
          />
        </Row>
        <Row label="Message order" description="Within a conversation.">
          <Segmented
            label="Message order"
            value={prefs.order}
            options={ORDERS}
            onChange={(order) => viewingPrefs.set({ ...prefs, order })}
          />
        </Row>
      </Group>
      <Group title="Search">
        <Row
          label="Include Spam and Trash"
          description="Searches look in Spam and Trash too. Gmail leaves them out."
        >
          <Toggle
            label="Include Spam and Trash"
            on={prefs.searchSpamTrash}
            onChange={(searchSpamTrash) => viewingPrefs.set({ ...prefs, searchSpamTrash })}
          />
        </Row>
      </Group>
      <Group title="Privacy">
        <Row
          label="Remote images"
          description="Whether pictures from the web load in emails, for senders you haven’t chosen for. Spam never loads them, and known trackers are always removed."
        >
          <select
            aria-label="Remote images"
            value={settings?.remoteImages ?? "load"}
            disabled={!settings}
            onChange={(e) =>
              settings &&
              save.mutate(
                { ...settings, remoteImages: e.target.value as RemoteImages },
                {
                  onError: (err) =>
                    showToast({ tone: "error", message: `Couldn’t save: ${errorText(err)}` }),
                },
              )
            }
            className={SELECT_CLASS}
          >
            {REMOTE_IMAGES.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Row>
        <Row
          label="Download images when mail arrives"
          description="Like Apple Mail’s Protect Mail Activity: images of new mail are saved as it arrives, so opening an email later doesn’t tell the sender when. Unlike Apple’s, they come straight from this Mac, so senders still see your IP address. Only images that would load anyway."
        >
          <Toggle
            label="Download images when mail arrives"
            on={settings?.imagePrefetch ?? true}
            disabled={!settings}
            onChange={(imagePrefetch) => update({ imagePrefetch })}
          />
        </Row>
        <Row
          label="Space for saved images"
          description={`The least recently viewed are removed past this. ${
            cache ? describeImageCache(cache) : ""
          }`}
        >
          <div className="flex items-center gap-2">
            <Segmented
              label="Space for saved images"
              value={String(settings?.imageCacheMb ?? 500)}
              options={IMAGE_CACHE_SIZES}
              disabled={!settings}
              onChange={(mb) => update({ imageCacheMb: Number(mb) })}
            />
            <Button
              disabled={!cache?.images || clearCache.isPending}
              onClick={() =>
                clearCache.mutate(undefined, {
                  onError: (e) =>
                    showToast({ tone: "error", message: `Couldn’t clear: ${errorText(e)}` }),
                })
              }
            >
              Clear
            </Button>
          </div>
        </Row>
      </Group>
    </>
  );
}

const REMOTE_IMAGES: { value: RemoteImages; label: string }[] = [
  { value: "load", label: "Load for everyone" },
  { value: "correspondents", label: "Load for people I’ve written to" },
  { value: "block", label: "Block until I allow a sender" },
];

export function ComposingSection() {
  const prefs = composingPrefs.use();
  const identities = useIdentities().data ?? [];
  const accounts = useAccounts().data ?? [];
  const chosen = prefs.defaultFrom;
  // A chosen address that's gone (its account removed) shows as the default.
  const fromValue =
    chosen &&
    identities.some((i) => i.accountId === chosen.accountId && sameEmail(i.email, chosen.email))
      ? fromKey(chosen.accountId, chosen.email)
      : "";
  return (
    <>
      <Group title="New mail">
        <Row
          label="Send from"
          description="The address new messages start from. Replies start from the address the conversation was sent to."
        >
          <select
            aria-label="Send new mail from"
            value={fromValue}
            onChange={(e) => {
              const picked = identities.find(
                (i) => fromKey(i.accountId, i.email) === e.target.value,
              );
              composingPrefs.set({
                ...prefs,
                defaultFrom: picked ? { accountId: picked.accountId, email: picked.email } : null,
              });
            }}
            className={SELECT_CLASS}
          >
            <option value="">The account you’re viewing</option>
            {accounts.map((account) => (
              <optgroup key={account.id} label={account.email}>
                {identities
                  .filter((i) => i.accountId === account.id)
                  .map((i) => (
                    <option
                      key={fromKey(i.accountId, i.email)}
                      value={fromKey(i.accountId, i.email)}
                    >
                      {i.name ? `${i.name} <${i.email}>` : i.email}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </Row>
        <Row
          label="Font"
          description="What new messages and replies start in, as Gmail sends it. Text you format in the message keeps its own."
        >
          <div className="flex gap-2">
            <select
              aria-label="Starting font"
              value={prefs.style.font}
              onChange={(e) =>
                composingPrefs.set({ ...prefs, style: { ...prefs.style, font: e.target.value } })
              }
              className={SELECT_CLASS}
            >
              <option value="">Default</option>
              {FONTS.map(([label, family]) => (
                <option key={label} value={family} style={{ fontFamily: family }}>
                  {label}
                </option>
              ))}
            </select>
            <select
              aria-label="Starting size"
              value={prefs.style.size}
              onChange={(e) =>
                composingPrefs.set({ ...prefs, style: { ...prefs.style, size: e.target.value } })
              }
              className={SELECT_CLASS}
            >
              {SIZES.map(([label, size]) => (
                <option key={label} value={size}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </Row>
      </Group>
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
    </>
  );
}

const fromKey = (accountId: number, email: string) => `${accountId}:${email.toLowerCase()}`;

const SELECT_CLASS =
  "h-7 max-w-64 rounded-md border border-content/10 bg-transparent px-1.5 text-[12px] text-content/80 hover:bg-selection";

const MARK_READ: { value: MarkRead; label: string }[] = [
  { value: "open", label: "On open" },
  { value: "delay", label: `After ${MARK_READ_DELAY_MS / 1000} seconds` },
  { value: "never", label: "Never" },
];

const ORDERS: { value: MessageOrder; label: string }[] = [
  { value: "oldestFirst", label: "Oldest first" },
  { value: "newestFirst", label: "Newest first" },
];

const DELETE_KEYS: { value: DeleteKey; label: string }[] = [
  { value: "trash", label: "Move to Trash" },
  { value: "archive", label: "Archive" },
];

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
  const size = textSize.use();
  return (
    <>
      {header(
        <Button
          onClick={() => {
            setAppearance(DEFAULT_APPEARANCE);
            textSize.set("default");
            change({ theme: "system", appIcon: null });
          }}
          disabled={
            isDefault(appearance) && size === "default" && theme === "system" && !settings?.appIcon
          }
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
          label="Accent color"
          description="Buttons, switches, the focused conversation and other highlights."
        >
          <Swatches
            label="Accent color"
            value={appearance.accent}
            options={ACCENTS.map((a) => ({ value: a.id, label: a.label, color: a.color }))}
            onChange={(accent) => setAppearance({ ...appearance, accent })}
          />
        </Row>
      </Group>
      <Group title="Text">
        <Row
          label="Text size"
          description="The conversation list, and conversations and emails in the reader."
        >
          <Segmented label="Text size" value={size} options={TEXT_SIZES} onChange={textSize.set} />
        </Row>
      </Group>
      {/* Mac only: Windows shows the Start menu shortcut's icon in the
          taskbar, whatever the window sets (tried 2026-10-25). */}
      {IS_MAC && (
        <Group
          title="App icon"
          description={`Shows in the Dock while ${APP_NAME} is open. Finder, and the Dock once ${APP_NAME} quits, keep the built-in icon.`}
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
      )}
      <Group
        title="Transparency"
        description="How much of what’s behind the window shows through. More see-through looks lighter; less is easier to read."
      >
        {(
          [
            [
              "sidebarTint",
              "Window",
              "--glass-sidebar-base",
              "The glass behind everything: sidebar, reader and list.",
            ],
            [
              "listTint",
              "Conversation list",
              "--glass-panel-base",
              "The list’s own panel, on top of the window’s glass.",
            ],
          ] as const
        ).map(([key, label, baseVar, about]) => (
          <Row key={key} label={label} description={about}>
            <Slider
              label={`${label} see-through`}
              value={seeThrough(cssPercent(baseVar), appearance[key])}
              display={`${seeThrough(cssPercent(baseVar), appearance[key])}%`}
              min={0}
              max={100}
              onChange={(v) =>
                setAppearance(withTint(appearance, key, tintFor(cssPercent(baseVar), v)))
              }
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

/**
 * Settings → Advanced: for when something goes wrong. The sync log (what
 * sync did, never mail content) and the cache, which can be cleared to
 * download every account's mail again.
 */
export function AdvancedSection() {
  const size = useCacheSize().data;
  const clear = useClearCache();
  const [confirming, setConfirming] = useState(false);
  const save = useSaveAppSettings();
  const [restoring, setRestoring] = useState(false);
  const restore = () =>
    unwrap(commands.settingsDefaults())
      .then((defaults) => save.mutateAsync(defaults))
      .then(() => {
        restoreWindowDefaults();
        setRestoring(false);
        showToast({ message: "Settings restored to their defaults" });
      })
      .catch((e: unknown) =>
        showToast({ tone: "error", message: `Couldn’t restore settings: ${errorText(e)}` }),
      );
  return (
    <>
      <Group title="Cache">
        <Row
          label="Mail on this Mac"
          description={
            size
              ? `${formatSize(size.mailKilobytes * 1024)} of mail and its search index, and ${formatSize(size.filesKilobytes * 1024)} of opened attachments and downloaded images.`
              : "Working out its size…"
          }
        >
          <Button onClick={() => setConfirming(true)} disabled={clear.isPending}>
            {clear.isPending ? "Clearing…" : "Clear and download again"}
          </Button>
        </Row>
      </Group>
      <Group title="Settings">
        <Row
          label="Restore default settings"
          description={`Every setting in ${APP_NAME} back to how it started. Your accounts, mail, signatures, rules and connected AI stay.`}
        >
          <Button onClick={() => setRestoring(true)}>Restore defaults…</Button>
        </Row>
      </Group>
      <Group title="Diagnostics">
        <Row
          label="Sync log"
          description="What syncing did, and why it waited or failed: useful when mail is missing or late. It never holds email content or passwords."
        >
          <Button
            onClick={() =>
              void unwrap(commands.syncLogReveal()).catch((e: unknown) =>
                showToast({ tone: "error", message: `Couldn’t show the log: ${errorText(e)}` }),
              )
            }
          >
            Show in Finder
          </Button>
        </Row>
      </Group>
      {restoring && (
        <ConfirmDialog
          title="Restore default settings?"
          confirmLabel="Restore defaults"
          busy={save.isPending}
          onCancel={() => setRestoring(false)}
          onConfirm={() => void restore()}
        >
          <p>
            Every choice in Settings goes back to how it started: appearance, notifications,
            viewing, the list, composing, AI choices and the Toybox.
          </p>
          <p>
            Kept: your accounts and mail, signatures, rules and the vacation responder (they’re in
            Gmail), connected AI, choices made for senders, and recent searches.
          </p>
        </ConfirmDialog>
      )}
      {confirming && (
        <ConfirmDialog
          title="Clear the cache?"
          confirmLabel="Clear and download again"
          busy={clear.isPending}
          error={clear.error?.message}
          onCancel={() => {
            clear.reset();
            setConfirming(false);
          }}
          onConfirm={() =>
            clear.mutate(undefined, {
              onSuccess: () => {
                setConfirming(false);
                showToast({ message: "Cache cleared. Downloading your mail again…" });
              },
            })
          }
        >
          <p>
            {APP_NAME} forgets the mail it has stored and downloads each account’s again, as when it
            was added. That can take a while, and searches find less until it’s done.
          </p>
          <p>Nothing changes in Gmail. Accounts, settings and rules stay.</p>
        </ConfirmDialog>
      )}
    </>
  );
}

/** Settings → Toybox: the empty list's glow and screensavers. */
export function ToyboxSection() {
  const flags = useFeatureFlags();
  const prefs = screensaverPrefs.use();
  const toy = emptyToy.use();
  const toyInfo = TOYS.find((t) => t.id === toy);
  return (
    <>
      <Group
        title="Inbox Zero"
        description="When a view has no mail: your Inbox, a label or a search."
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
      <Group
        title="Something to play with"
        description="In any view with no mail, behind the icon and words. Put away while a screensaver plays."
      >
        <div className="px-4 py-3.5">
          <ChoiceGrid
            label="Something to play with"
            value={toy}
            options={TOYS.map((t) => ({ value: t.id, label: t.label }))}
            onChange={(id) => emptyToy.set(id)}
          />
          {toyInfo && (
            <p className="mt-2 text-[12px] leading-relaxed text-content/45">
              {toyInfo.description}
            </p>
          )}
        </div>
      </Group>
      {flags.screensavers && (
        <Group
          title="Screensaver"
          description="Plays at Inbox Zero. To try one now, open a view with no mail and use “Start screensaver” in the command palette."
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
            <div className="text-[13px] font-medium text-content">Colors</div>
            <div className="mt-1 text-[12px] leading-relaxed text-content/45">
              “Mono + accent” and “Accent” follow the accent color in Appearance.
            </div>
          </div>
          <div className="px-4 pb-3.5">
            <ChoiceGrid
              label="Colors"
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

/** A palette's five colors as a row of pixel squares. */
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
