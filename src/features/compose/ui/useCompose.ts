import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { commands } from "../../../platform/tauri/bindings";
import type { Account, AccountId, DraftId, ThreadId } from "../../../platform/tauri/bindings";
import { unwrap } from "../../../platform/tauri/ipc";
import { keys } from "../../../shared/lib/queries";
import { showToast } from "../../../shared/lib/toast";
import * as S from "../model/composeState";
import type { Size, Spot } from "../model/snap";
import {
  type ComposeKind,
  type Draft,
  hasChanges,
  newDraft,
  replyDraft,
  toOutgoing,
} from "../model/draft";

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
  const entry = S.entryById(state, id);
  if (entry && hasChanges(entry.draft)) scheduleSave(id);
}

/**
 * Saving to Gmail's Drafts as you write: once typing pauses for a moment,
 * the draft is created (first time) or replaced. Saves of one draft never
 * overlap, so it can't be created twice; a save that finishes after the
 * draft was discarded deletes what it made.
 */
const SAVE_DELAY_MS = 2500;
type SaveSlot = {
  timer?: number;
  running?: Promise<void>;
  again?: boolean;
  discarded?: boolean;
  /** The latest saved draft ID, kept here too in case the entry closed meanwhile. */
  savedId?: DraftId;
};
const saves = new Map<number, SaveSlot>();

function slot(id: number): SaveSlot {
  let s = saves.get(id);
  if (!s) saves.set(id, (s = {}));
  return s;
}

function scheduleSave(id: number) {
  const s = slot(id);
  window.clearTimeout(s.timer);
  s.timer = window.setTimeout(() => void saveNow(id), SAVE_DELAY_MS);
}

/** Saves now (waiting for any save already running), and settles when done. */
export async function saveNow(id: number): Promise<void> {
  const s = slot(id);
  window.clearTimeout(s.timer);
  if (s.running) {
    s.again = true;
    return s.running;
  }
  const entry = S.entryById(state, id);
  if (!entry || !hasChanges(entry.draft)) return;
  set(S.setSaved(state, id, "saving"));
  s.running = unwrap(commands.draftSave(entry.draft.savedId, toOutgoing(entry.draft)))
    .then((savedId) => {
      s.savedId = savedId;
      if (s.discarded) {
        void unwrap(commands.draftDelete(savedId));
        return;
      }
      set(S.setSaved(state, id, "saved", savedId));
    })
    .catch(() => set(S.setSaved(state, id, "failed")))
    .finally(() => {
      s.running = undefined;
      if (s.again && !s.discarded) {
        s.again = false;
        void saveNow(id);
      }
    });
  return s.running;
}

/** Closes a new message, keeping it in Gmail's Drafts (saved first). */
export function closeKeepingDraft(id: number) {
  const entry = S.entryById(state, id);
  if (entry && hasChanges(entry.draft)) {
    void saveNow(id).then(() => {
      const saved = S.entryById(state, id)?.draft.savedId;
      set(S.close(state, id));
      saves.delete(id);
      if (saved !== null && saved !== undefined) showToast({ message: "Saved to Drafts" });
    });
    return;
  }
  closeDraft(id);
}

export function minimizeCard(id: number) {
  set(S.minimize(state, id));
}

export function expandCard(id: number) {
  set(S.expand(state, id));
}

/** Discards a draft: closes it and deletes its saved copy from Gmail. */
export function closeDraft(id: number) {
  const entry = S.entryById(state, id);
  const s = slot(id);
  window.clearTimeout(s.timer);
  s.discarded = true;
  set(S.close(state, id));
  const savedId = entry?.draft.savedId;
  if (savedId !== null && savedId !== undefined)
    unwrap(commands.draftDelete(savedId)).catch((e: unknown) =>
      showToast({
        tone: "error",
        message: `Couldn’t delete the draft from Gmail: ${e instanceof Error ? e.message : String(e)}`,
      }),
    );
  if (!s.running) saves.delete(id);
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
        // The newest real message: drafts sit in conversations too.
        const last = detail.messages.findLast((m) => !m.draft);
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
    // No more saving: the pending save is dropped, and one in flight is
    // waited for so the right draft is deleted once sent.
    const pending = slot(draft.id);
    window.clearTimeout(pending.timer);
    const inFlight = pending.running ?? Promise.resolve();
    set(S.close(state, draft.id));
    let undone = false;
    let started = false;
    const timer = window.setTimeout(() => {
      if (undone) return;
      started = true;
      saves.delete(draft.id);
      inFlight
        .then(() => {
          // The latest saved ID, if a save finished meanwhile.
          const savedId = pending.savedId ?? entry.draft.savedId;
          return unwrap(commands.messageSend(toOutgoing({ ...draft, savedId })));
        })
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
          const savedId = pending.savedId ?? entry.draft.savedId;
          set(S.reopen(state, { ...entry, draft: { ...entry.draft, savedId } }));
        },
      },
    });
  }, []);

  return useMemo(() => ({ startNew, startReply, send }), [startNew, startReply, send]);
}
