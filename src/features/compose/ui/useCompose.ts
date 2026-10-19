import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { commands } from "../../../platform/tauri/bindings";
import type {
  Account,
  AccountId,
  DraftId,
  Mailto,
  MessageId,
  ThreadId,
} from "../../../platform/tauri/bindings";
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
  resumedDraft,
  switchedKind,
  toOutgoing,
  withSelection,
} from "../model/draft";
import { selectedInMessage } from "../../reader/ui/MessageFrame";
import { draftFromMailto } from "../model/mailto";

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

/**
 * Draft messages that were reopened and then closed, sent or discarded
 * this session. A conversation opens its draft reply automatically, but
 * not one of these: the cached copy lingers until the next sync.
 */
const finishedDrafts = new Set<MessageId>();

export function draftFinished(message: MessageId): boolean {
  return finishedDrafts.has(message);
}

function finish(entry: S.ComposeEntry | undefined) {
  if (entry?.draft.resumedFrom != null) finishedDrafts.add(entry.draft.resumedFrom);
}
type SaveSlot = {
  timer?: number;
  running?: Promise<boolean>;
  /** The draft as it was closed: saving carries on after the card is gone. */
  closed?: S.ComposeEntry;
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

/**
 * Saves now (after any save already running), resolving to whether it
 * worked. Works for a draft whose card has closed, from `closed`.
 */
export async function saveNow(id: number): Promise<boolean> {
  const s = slot(id);
  window.clearTimeout(s.timer);
  if (s.running) {
    // One save at a time: wait, then save the latest content.
    await s.running;
    return saveNow(id);
  }
  const entry = S.entryById(state, id) ?? s.closed;
  if (!entry || !hasChanges(entry.draft)) return true;
  set(S.setSaved(state, id, "saving"));
  const savedId = s.savedId ?? entry.draft.savedId;
  s.running = unwrap(commands.draftSave(savedId, toOutgoing(entry.draft)))
    .then((saved) => {
      s.savedId = saved;
      if (s.discarded) {
        void unwrap(commands.draftDelete(saved));
        return true;
      }
      set(S.setSaved(state, id, "saved", saved));
      return true;
    })
    .catch(() => {
      set(S.setSaved(state, id, "failed"));
      return false;
    })
    .finally(() => {
      s.running = undefined;
    });
  return s.running;
}

/**
 * Closes a new message at once, keeping it in Gmail's Drafts: it saves in
 * the background. If that fails the card comes back with the error, so
 * nothing written is lost.
 */
export function closeKeepingDraft(id: number) {
  const entry = S.entryById(state, id);
  if (!entry || !hasChanges(entry.draft)) {
    // Nothing new to save. Just close: a reopened draft stays in Drafts
    // as it was (only Discard deletes), and an empty new one never saved.
    finish(entry);
    set(S.close(state, id));
    saves.delete(id);
    return;
  }
  const s = slot(id);
  s.closed = entry;
  finish(entry);
  set(S.close(state, id));
  void saveNow(id).then((ok) => {
    saves.delete(id);
    if (ok) showToast({ message: "Saved to Drafts" });
    else {
      const savedId = s.savedId ?? entry.draft.savedId;
      set(
        S.reopen(
          state,
          { ...entry, draft: { ...entry.draft, savedId } },
          "Couldn’t save the draft. Try again, or send it.",
        ),
      );
    }
  });
}

/** Opens a saved draft (from its conversation) for editing. */
export async function resumeDraft(messageId: MessageId): Promise<boolean> {
  try {
    const opened = await unwrap(commands.draftOpen(messageId));
    const already = [...state.cards, ...state.replies].find(
      (e) => e.draft.savedId === opened.draft,
    );
    if (already) {
      set(
        state.cards.includes(already)
          ? S.expand(state, already.draft.id)
          : S.focus(state, already.draft.id),
      );
      return true;
    }
    const draft = resumedDraft(opened, messageId);
    set(draft.kind === "new" ? S.openCard(state, draft) : S.openReply(state, draft));
    return true;
  } catch (e) {
    // Not offered again this session (it may be gone from Gmail).
    finishedDrafts.add(messageId);
    showToast({
      tone: "error",
      message: `Couldn’t open the draft: ${e instanceof Error ? e.message : String(e)}`,
    });
    return false;
  }
}

/** Opens a conversation that's only a draft straight into the composer. */
export async function resumeThreadDraft(threadId: ThreadId) {
  try {
    const detail = await unwrap(commands.threadGet(threadId));
    const draft = detail.messages.findLast((m) => m.draft);
    if (draft) await resumeDraft(draft.id);
  } catch (e) {
    showToast({
      tone: "error",
      message: `Couldn’t open the draft: ${e instanceof Error ? e.message : String(e)}`,
    });
  }
}

/** Moves an inline reply into the floating card. */
export function popOutReply(id: number) {
  set(S.popOut(state, id));
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
  finish(entry);
  const savedId = entry?.draft.savedId;
  const from = entry?.draft.resumedFrom;
  // A reopened draft is discarded by its message, which also takes it out
  // of the conversation and the Drafts list at once.
  const deleting =
    savedId !== null && savedId !== undefined ? unwrap(commands.draftDelete(savedId)) : null;
  const discarding =
    from != null
      ? (deleting ?? Promise.resolve()).then(() => unwrap(commands.draftDiscard(from)))
      : deleting;
  discarding?.catch((e: unknown) =>
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

  /** A new message filled in from a `mailto:` link. */
  const startFromMailto = useCallback(
    async (accountId: AccountId, link: Mailto) => {
      const list = await identities();
      const draft = newDraft(list, accountId, emailOf(accountId));
      set(S.openCard(state, draftFromMailto(draft, link)));
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
        // Text selected in one of its messages: answer that message,
        // quoting just the selection. Otherwise the newest real message
        // (drafts sit in conversations too), quoted whole.
        const picked = selectedInMessage();
        const selectedIn = picked
          ? detail.messages.find((m) => m.id === picked.messageId && !m.draft)
          : undefined;
        const target = selectedIn ?? detail.messages.findLast((m) => !m.draft);
        if (!target) return;
        const [original, list] = await Promise.all([
          unwrap(commands.replySource(target.id)),
          identities(),
        ]);
        const selection = selectedIn && picked ? picked.text : undefined;
        const source = selection ? withSelection(original, selection) : original;
        const draft = replyDraft(kind, source, list, emailOf(source.accountId));
        set(S.openReply(state, { ...draft, quotedSelection: selection }));
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

  /** Turns a reply into reply all or a forward (or back), keeping the text. */
  const switchKind = useCallback(
    async (id: number, kind: Exclude<ComposeKind, "new">) => {
      const current = S.entryById(state, id)?.draft;
      const replyingTo = current?.replyingTo;
      if (replyingTo == null) return;
      try {
        const [original, list] = await Promise.all([
          unwrap(commands.replySource(replyingTo)),
          identities(),
        ]);
        const selection = current?.quotedSelection;
        const source = selection ? withSelection(original, selection) : original;
        const fresh = replyDraft(kind, source, list, emailOf(source.accountId));
        updateDraft(id, (d) => switchedKind(d, fresh));
      } catch (e) {
        showToast({
          tone: "error",
          message: `Couldn’t switch: ${e instanceof Error ? e.message : String(e)}`,
        });
      }
    },
    [identities, emailOf],
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
    const inFlight = pending.running ?? Promise.resolve(true);
    finish(entry);
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

  return useMemo(
    () => ({ startNew, startFromMailto, startReply, switchKind, send }),
    [startNew, startFromMailto, startReply, switchKind, send],
  );
}
