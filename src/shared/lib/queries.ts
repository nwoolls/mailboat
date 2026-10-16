import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect } from "react";
import { commands, events } from "../../platform/tauri/bindings";
import type {
  AccountFilter,
  AccountSyncState,
  MessageId,
  ThreadId,
} from "../../platform/tauri/bindings";
import { IS_TAURI, unwrap } from "../../platform/tauri/ipc";
import { upsertSyncState } from "../../features/accounts/model/accounts";
import { type Selection, selectionKey, toListQuery } from "../../features/mailbox/model/views";

export const keys = {
  accounts: ["accounts"] as const,
  oauthSetup: ["oauthSetup"] as const,
  syncStates: ["syncStates"] as const,
  labels: (filter: AccountFilter) => ["labels", filter] as const,
  unreadCounts: ["unreadCounts"] as const,
  // The view rides along so optimistic updates know which lists a
  // conversation leaves (see `useThreadAction`).
  threads: (s: Selection) => ["threads", selectionKey(s), s.view] as const,
  thread: (id: ThreadId) => ["thread", id] as const,
  message: (id: MessageId) => ["message", id] as const,
  identities: ["identities"] as const,
  contacts: (text: string) => ["contacts", text] as const,
};

export function useAccounts() {
  return useQuery({
    queryKey: keys.accounts,
    queryFn: () => unwrap(commands.accountsList()),
    enabled: IS_TAURI,
  });
}

export function useOAuthSetup() {
  return useQuery({
    queryKey: keys.oauthSetup,
    queryFn: () => commands.oauthSetup(),
    enabled: IS_TAURI,
  });
}

export function useSyncStates() {
  return useQuery({
    queryKey: keys.syncStates,
    queryFn: () => unwrap(commands.syncStatusList()),
    enabled: IS_TAURI,
  });
}

export function useLabels(filter: AccountFilter) {
  return useQuery({
    queryKey: keys.labels(filter),
    queryFn: () => unwrap(commands.labelsList(filter)),
    enabled: IS_TAURI,
  });
}

/** Unread conversations per label, every account, for the sidebar's counts. */
export function useUnreadCounts() {
  return useQuery({
    queryKey: keys.unreadCounts,
    queryFn: () => unwrap(commands.unreadCounts({ kind: "all" })),
    enabled: IS_TAURI,
  });
}

export function useThreads(selection: Selection) {
  return useInfiniteQuery({
    queryKey: keys.threads(selection),
    queryFn: ({ pageParam }) => unwrap(commands.threadsList(toListQuery(selection, pageParam))),
    initialPageParam: null as Parameters<typeof toListQuery>[1],
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: IS_TAURI,
    // Keep showing the previous view's list until the next one arrives (a
    // local query, so a few milliseconds). Without this the list blanked
    // in between, and an empty state was removed and re-added on every
    // first visit to an empty label, replaying its entrance.
    placeholderData: keepPreviousData,
  });
}

export function useThread(id: ThreadId | null) {
  return useQuery({
    queryKey: keys.thread(id ?? -1),
    queryFn: () => unwrap(commands.threadGet(id!)),
    enabled: IS_TAURI && id !== null,
    // Keep showing the previous conversation (dimmed) until the next one
    // arrives, rather than blanking the reader in between.
    placeholderData: keepPreviousData,
  });
}

export function useOpenedMessage(id: MessageId) {
  return useQuery({
    queryKey: keys.message(id),
    queryFn: () => unwrap(commands.messageOpen(id)),
    enabled: IS_TAURI,
    staleTime: Infinity,
  });
}

/** Every address mail can be sent from (accounts and their Gmail aliases). */
export function useIdentities() {
  return useQuery({
    queryKey: keys.identities,
    queryFn: () => unwrap(commands.identitiesList()),
    enabled: IS_TAURI,
    staleTime: Infinity,
  });
}

/** People matching what's typed in an address field, from cached mail. */
export function useContactSuggestions(text: string) {
  const trimmed = text.trim();
  return useQuery({
    queryKey: keys.contacts(trimmed.toLowerCase()),
    queryFn: () => unwrap(commands.contactsSuggest(trimmed)),
    enabled: IS_TAURI && trimmed.length > 0,
    staleTime: 30_000,
    // Keep the previous matches up while the next ones arrive (a local
    // query), so the list doesn't flicker on every key.
    placeholderData: keepPreviousData,
  });
}

/** Keeps the cache in step with Rust: sync status updates and mail changes. */
export function useMailEvents() {
  const qc = useQueryClient();
  useEffect(() => {
    if (!IS_TAURI) return;
    const unlisteners = [
      events.syncStatusEvent.listen((e) => {
        qc.setQueryData<AccountSyncState[]>(keys.syncStates, (list) =>
          upsertSyncState(list ?? [], e.payload),
        );
      }),
      events.mailChangedEvent.listen(() => {
        // Lists are cheap local queries, so refresh all of them.
        void qc.invalidateQueries({ queryKey: ["threads"] });
        void qc.invalidateQueries({ queryKey: ["thread"] });
        void qc.invalidateQueries({ queryKey: ["labels"] });
        void qc.invalidateQueries({ queryKey: keys.unreadCounts });
        void qc.invalidateQueries({ queryKey: ["contacts"] });
      }),
      events.identitiesChangedEvent.listen(() => {
        void qc.invalidateQueries({ queryKey: keys.identities });
      }),
    ];
    return () => {
      for (const u of unlisteners) void u.then((fn) => fn());
    };
  }, [qc]);
}
