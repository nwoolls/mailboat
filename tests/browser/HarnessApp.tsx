import { useEffect, useRef } from "react";
import type { Account, Identity, ThreadDetail } from "../../src/platform/tauri/bindings";
import type { Spot } from "../../src/features/compose/model/snap";
import { ComposeCard } from "../../src/features/compose/ui/ComposeCard";
import { ReplyArea } from "../../src/features/compose/ui/ReplyArea";
import { ThreadReader } from "../../src/features/reader/ui/ThreadReader";
import { pageReader, stepEmail } from "../../src/features/reader/ui/readerKeys";
import { Menu, MenuItem } from "../../src/shared/ui/Menu";
import { ShortcutsHelp } from "../../src/features/mailbox/ui/ShortcutsHelp";
import { ShowOriginalDialog } from "../../src/features/reader/ui/ShowOriginalDialog";
import { ArchiveIcon } from "../../src/shared/ui/icons";
import {
  setCardSpot,
  useComposeActions,
  useComposeState,
} from "../../src/features/compose/ui/useCompose";

const params = new URLSearchParams(location.search);

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
  const actions = useComposeActions([account]);
  const mode = params.get("mode");
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

  if (mode === "shortcuts") return <ShortcutsHelp onClose={() => {}} />;
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
