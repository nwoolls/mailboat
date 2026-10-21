import { useEffect, useRef } from "react";
import type { Account, Identity, ThreadDetail } from "../../src/platform/tauri/bindings";
import type { Spot } from "../../src/features/compose/model/snap";
import { ComposeCard } from "../../src/features/compose/ui/ComposeCard";
import { ReplyArea } from "../../src/features/compose/ui/ReplyArea";
import { ThreadReader } from "../../src/features/reader/ui/ThreadReader";
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
