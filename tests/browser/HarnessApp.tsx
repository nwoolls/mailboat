import { useEffect, useRef, useState } from "react";
import type { Account, Identity, ThreadDetail } from "../../src/platform/tauri/bindings";
import type { Spot } from "../../src/features/compose/model/snap";
import { ComposeCard } from "../../src/features/compose/ui/ComposeCard";
import { ReplyArea } from "../../src/features/compose/ui/ReplyArea";
import { ThreadReader } from "../../src/features/reader/ui/ThreadReader";
import { pageReader, stepEmail } from "../../src/features/reader/ui/readerKeys";
import { Menu, MenuItem } from "../../src/shared/ui/Menu";
import { ShortcutsHelp } from "../../src/features/mailbox/ui/ShortcutsHelp";
import { ShowOriginalDialog } from "../../src/features/reader/ui/ShowOriginalDialog";
import { ThreadList } from "../../src/features/mailbox/ui/ThreadList";
import { EmptyState } from "../../src/features/mailbox/ui/EmptyState";
import { CommandPalette } from "../../src/features/palette/ui/CommandPalette";
import { TitleSearch } from "../../src/app/TitleSearch";
import { ArchiveIcon } from "../../src/shared/ui/icons";
import { inbox } from "./demoMail";
import { GeneralSection, ToyboxSection } from "../../src/features/settings/ui/SettingsSections";
import { UpdateNotice } from "../../src/features/updates/ui/UpdateNotice";
import { Sidebar } from "../../src/features/accounts/ui/Sidebar";
import { useSignIn } from "../../src/features/accounts/ui/useSignIn";
import {
  SignedOutNotices,
  useSignedOutNotices,
} from "../../src/features/accounts/ui/SignedOutNotices";
import { systemSelection } from "../../src/features/mailbox/model/views";
import { Onboarding } from "../../src/features/onboarding/ui/Onboarding";
import { Shell } from "../../src/app/Shell";
import {
  useAccounts,
  useMailEvents,
  useOAuthSetup,
  useSyncStates,
} from "../../src/shared/lib/queries";
import {
  setCardSpot,
  updateDraft,
  useComposeActions,
  useComposeState,
} from "../../src/features/compose/ui/useCompose";

const params = new URLSearchParams(location.search);

// The demo's Inbox (demo/mail.json), the rows whose first words fill two
// preview lines, so every preview-lines choice can be measured.
const listRows = inbox()
  .filter((t) => t.snippet.length >= 140)
  .slice(0, 5);

/** The components under test (harness.tsx sets up the fake Rust side). */
export function Harness({
  account,
  identity,
  detail,
}: {
  account: Account;
  identity: Identity;
  detail: ThreadDetail;
}) {
  const compose = useComposeState();
  const states = useSyncStates().data ?? [];
  const signIn = useSignIn();
  const notices = useSignedOutNotices([account], states);
  const actions = useComposeActions([account]);
  const mode = params.get("mode");
  // `&summary=live`: mail events refresh queries as Shell's do.
  useMailEvents();
  // Once: the actions object is new on every render.
  const started = useRef(false);
  useEffect(() => {
    if (mode !== "card" || started.current) return;
    started.current = true;
    setCardSpot((params.get("spot") as Spot | null) ?? "bottom-right");
    void actions.startNew(account.id);
  }, [mode, actions, account.id]);
  const card = compose.cards.find((c) => !c.minimized);
  // The reader's own keys, as Shell passes them on (it isn't mounted here).
  useEffect(() => {
    if (mode !== "unread") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "n" || e.key === "p") stepEmail(e.key === "n" ? "next" : "prev");
      else if (e.key === " " && pageReader(e.shiftKey ? -1 : 1)) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode]);

  if (mode === "onboarding") return <OnboardingHarness />;
  if (mode === "shell") return <Shell />;
  // `?mode=updates&draft=1`: a message being written, so there is something to save.
  const draftStarted = useRef(false);
  useEffect(() => {
    if (mode !== "updates" || !params.has("draft") || draftStarted.current) return;
    draftStarted.current = true;
    void actions.startNew(account.id);
  }, [mode, actions, account.id]);
  const writing = compose.cards[0];
  useEffect(() => {
    if (mode === "updates" && params.has("draft") && writing && writing.draft.subject === "")
      updateDraft(writing.draft.id, (d) => ({ ...d, subject: "Lunch on Friday" }));
  }, [mode, writing]);
  // Settings → About with the update row, and the update notice.
  if (mode === "updates")
    return (
      <div style={{ width: 720, padding: 16 }}>
        <GeneralSection />
        <div className="fixed top-12 right-3 z-50">
          <UpdateNotice />
        </div>
      </div>
    );
  // Settings → Toybox.
  if (mode === "toybox")
    return (
      <div style={{ width: 720, padding: 16 }}>
        <ToyboxSection />
      </div>
    );
  if (mode === "signedout")
    return (
      <div style={{ display: "flex", height: 600, width: 900 }}>
        <Sidebar
          accounts={[account]}
          width={240}
          syncStates={states}
          selection={systemSelection("inbox")}
          onSelect={() => {}}
          onAccountRemoved={() => {}}
          onOpenSettings={() => {}}
          signIn={signIn}
          errorInNotice={notices.list.some((a) => a.email === signIn.hint)}
        />
        <div className="fixed top-12 right-3 z-50">
          <SignedOutNotices list={notices.list} onDismiss={notices.dismiss} signIn={signIn} />
        </div>
      </div>
    );
  if (mode === "shortcuts") return <ShortcutsHelp onClose={() => {}} />;
  if (mode === "palette") return <PaletteOverSearch />;
  if (mode === "search") return <SearchBar />;
  // The list card: a title row, then the empty view under it.
  if (mode === "empty")
    return (
      <div
        className="panel"
        style={{
          position: "relative",
          height: 600,
          width: 480,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <button type="button" data-card-title style={{ height: 40 }}>
          Inbox
        </button>
        <EmptyState state={{ icon: "caughtUp", title: "All caught up" }} swapKey="inbox" />
      </div>
    );
  if (mode === "list")
    return (
      <div style={{ height: 600, width: 420, display: "flex", flexDirection: "column" }}>
        <ThreadList
          viewKey="harness"
          placeholder={false}
          threads={listRows as never}
          accounts={new Map([[account.id, account]])}
          showAccount
          selectedId={null}
          cursorId={null}
          keepInView={null}
          checked={new Set()}
          onSelect={() => {}}
          onClearSelection={() => {}}
          onRowMenu={() => {}}
          menuRowId={null}
          hasMore={false}
          loadMore={() => {}}
          loading={false}
          older={{ status: "idle", busy: false, retry: () => {} }}
          empty={null}
          onSwipe={() => {}}
        />
      </div>
    );
  if (mode === "original")
    return <ShowOriginalDialog threadId={detail.thread.id} onClose={() => {}} />;
  // A menu with one very long item (Bug Spike 2: it stretched the menu).
  if (mode === "menu")
    return (
      <Menu anchor={{ x: 100, y: 100 }} onClose={() => {}} label="Conversation">
        <MenuItem icon={ArchiveIcon} hint="e" onSelect={() => {}}>
          Archive
        </MenuItem>
        <MenuItem icon={ArchiveIcon} onSelect={() => {}}>
          {`Block ${"someone.with.a.very.long.name".repeat(4)}@example.com`}
        </MenuItem>
      </Menu>
    );
  if (mode === "card")
    return card ? (
      <ComposeCard
        entry={card}
        identities={[identity]}
        accounts={[account]}
        onSend={() => {}}
        onSwitch={() => {}}
      />
    ) : null;
  // The real reader: the conversation, then the reply at its foot.
  return (
    <div style={{ height: 640, width: 760, display: "flex", flexDirection: "column" }}>
      <ThreadReader
        threadId={detail.thread.id}
        accounts={new Map([[account.id, account]])}
        renderFooter={(d) => (
          <ReplyArea
            detail={d}
            identities={[identity]}
            accounts={[account]}
            onStart={(kind) => void actions.startReply(kind, d.thread.id)}
            onSwitch={() => {}}
            onSend={() => {}}
          />
        )}
      />
    </div>
  );
}

/** ⌘K open over a search box, as in the app; "Search mail" focuses the box. */
function PaletteOverSearch() {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <input id="search" aria-label="Search" />
      {open && (
        <CommandPalette
          onClose={() => setOpen(false)}
          items={[
            {
              id: "search",
              group: "Actions",
              title: "Search mail",
              run: () => document.getElementById("search")?.focus(),
            },
          ]}
        />
      )}
    </div>
  );
}

/** The title bar's search over a panel, as in the app. */
function SearchBar() {
  const [text, setText] = useState("");
  return (
    <div style={{ width: 900 }}>
      <header className="relative h-10">
        <TitleSearch value={text} onChange={setText} />
      </header>
      <div className="panel" style={{ position: "relative", height: 400 }}>
        <output aria-label="Searching for">{text}</output>
      </div>
    </div>
  );
}

/** Onboarding as Shell shows it, the account list and setup from the fake Rust. */
function OnboardingHarness() {
  const setup = useOAuthSetup().data;
  const accounts = useAccounts().data ?? [];
  return (
    <div style={{ height: "100vh" }}>
      <Onboarding setup={setup} accounts={accounts} />
    </div>
  );
}
