import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { commands } from "../../../platform/tauri/bindings";
import type { Account, AccountId, ThreadId } from "../../../platform/tauri/bindings";
import { unwrap } from "../../../platform/tauri/ipc";
import { keys } from "../../../shared/lib/queries";
import { showToast } from "../../../shared/lib/toast";
import * as S from "../model/composeState";
import type { Size, Spot } from "../model/snap";
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

/**
 * Where the card rests (lower right at first). Shared, so the next new
 * message opens where the last one was left, and the tabs keep clear.
 */
let spot: Spot = "bottom-right";
export function useCardSpot(): Spot {
  return useSyncExternalStore(subscribe, () => spot);
}
export function setCardSpot(next: Spot) {
  spot = next;
  for (const l of listeners) l();
}

/** The window's size, kept current on resize. */
export function useViewport(): Size {
  const [size, setSize] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return size;
}

export function updateDraft(id: number, change: (d: Draft) => Draft) {
  set(S.updateDraft(state, id, change));
}

export function minimizeCard(id: number) {
  set(S.minimize(state, id));
}

export function expandCard(id: number) {
  set(S.expand(state, id));
}

export function closeDraft(id: number) {
  set(S.close(state, id));
}

/** How long Undo send waits before sending (Gmail's default). */
export const UNDO_SEND_MS = 5000;

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

  /**
   * Undo send, as Gmail: the message closes at once and "Sending…" offers
   * Undo (or z / ⌘Z) for 5 seconds before anything goes to Google.
   * Undo puts it back as it was; if sending then fails, it reopens with
   * the error.
   */
  const send = useCallback((draft: Draft) => {
    const entry = S.entryById(state, draft.id);
    if (!entry) return;
    set(S.close(state, draft.id));
    let undone = false;
    let started = false;
    const timer = window.setTimeout(() => {
      if (undone) return;
      started = true;
      unwrap(commands.messageSend(toOutgoing(draft)))
        .then(() => showToast({ message: "Message sent" }))
        .catch((e: unknown) => {
          const message = e instanceof Error ? e.message : String(e);
          set(S.reopen(state, entry, message));
          showToast({ tone: "error", message: `Couldn’t send: ${message}` });
        });
    }, UNDO_SEND_MS);
    showToast({
      message: "Sending…",
      action: {
        label: "Undo",
        run: () => {
          // Past the 5 seconds it's on its way; say so rather than
          // reopening a message that was sent.
          if (started) {
            showToast({ message: "Too late to undo: the message was sent" });
            return;
          }
          undone = true;
          window.clearTimeout(timer);
          set(S.reopen(state, entry));
        },
      },
    });
  }, []);

  return useMemo(() => ({ startNew, startReply, send }), [startNew, startReply, send]);
}
