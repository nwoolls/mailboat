import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { commands } from "../../../platform/tauri/bindings";
import type { Account, AccountId, ThreadId } from "../../../platform/tauri/bindings";
import { unwrap } from "../../../platform/tauri/ipc";
import { keys } from "../../../shared/lib/queries";
import { showToast } from "../../../shared/lib/toast";
import * as S from "../model/composeState";
import { type ComposeKind, type Draft, newDraft, replyDraft, toOutgoing } from "../model/draft";

/**
 * Drafts on screen, shared app-wide (the toolbar, keys and the reader all
 * open them), like the toast.
 */
let state: S.ComposeState = S.EMPTY;
const listeners = new Set<() => void>();
function set(next: S.ComposeState) {
  state = next;
  for (const l of listeners) l();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useComposeState(): S.ComposeState {
  return useSyncExternalStore(subscribe, () => state);
}

export function updateDraft(id: number, change: (d: Draft) => Draft) {
  set(S.updateDraft(state, id, change));
}

export function closeDraft(id: number) {
  set(S.close(state, id));
}

/** Opens, replies and sends. Needs the accounts to know each one's address. */
export function useComposeActions(accounts: Account[]) {
  const qc = useQueryClient();
  const identities = useCallback(
    () =>
      qc.fetchQuery({
        queryKey: keys.identities,
        queryFn: () => unwrap(commands.identitiesList()),
      }),
    [qc],
  );
  const emailOf = useCallback(
    (id: AccountId) => accounts.find((a) => a.id === id)?.email ?? "",
    [accounts],
  );

  const startNew = useCallback(
    async (accountId: AccountId) => {
      const list = await identities();
      set(S.openCard(state, newDraft(list, accountId, emailOf(accountId))));
    },
    [identities, emailOf],
  );

  /** Replies to (or forwards) the newest message of a conversation. */
  const startReply = useCallback(
    async (kind: Exclude<ComposeKind, "new">, threadId: ThreadId) => {
      try {
        const detail = await qc.fetchQuery({
          queryKey: keys.thread(threadId),
          queryFn: () => unwrap(commands.threadGet(threadId)),
        });
        const last = detail.messages.at(-1);
        if (!last) return;
        const [source, list] = await Promise.all([
          unwrap(commands.replySource(last.id)),
          identities(),
        ]);
        set(S.openReply(state, replyDraft(kind, source, list, emailOf(source.accountId))));
      } catch (e) {
        showToast({
          tone: "error",
          message: `Couldn’t start the ${kind === "forward" ? "forward" : "reply"}: ${
            e instanceof Error ? e.message : String(e)
          }`,
        });
      }
    },
    [qc, identities, emailOf],
  );

  const send = useCallback(async (draft: Draft) => {
    set(S.setSending(state, draft.id, true, null));
    try {
      await unwrap(commands.messageSend(toOutgoing(draft)));
      set(S.close(state, draft.id));
      showToast({ message: "Message sent" });
    } catch (e) {
      set(S.setSending(state, draft.id, false, e instanceof Error ? e.message : String(e)));
    }
  }, []);

  return useMemo(() => ({ startNew, startReply, send }), [startNew, startReply, send]);
}
