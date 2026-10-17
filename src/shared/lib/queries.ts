import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect } from "react";
import { commands, events } from "../../platform/tauri/bindings";
import type {
  AccountFilter,
  AccountId,
  AccountSyncState,
  Answer,
  AppSettings,
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
  contacts: ["contacts"] as const,
  appInfo: ["appInfo"] as const,
  appSettings: ["appSettings"] as const,
  invite: (id: MessageId) => ["invite", id] as const,
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

/**
 * Everyone compose can suggest, best first, loaded once and filtered as
 * you type (a query per keystroke lagged). Refreshed when mail changes.
 */
export function useContacts() {
  return useQuery({
    queryKey: keys.contacts,
    queryFn: () => unwrap(commands.contactsList()),
    enabled: IS_TAURI,
    staleTime: Infinity,
  });
}

/** The app's version and the colours an account can have. */
export function useAppInfo() {
  return useQuery({
    queryKey: keys.appInfo,
    queryFn: () => commands.appInfo(),
    enabled: IS_TAURI,
    staleTime: Infinity,
  });
}

/** Settings Rust acts on (Settings page). */
export function useAppSettings() {
  return useQuery({
    queryKey: keys.appSettings,
    queryFn: () => unwrap(commands.settingsGet()),
    enabled: IS_TAURI,
    staleTime: Infinity,
  });
}

/** Saves settings, showing the change at once and undoing it if saving fails. */
export function useSaveAppSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (next: AppSettings) => unwrap(commands.settingsSet(next)),
    onMutate: (next) => {
      const previous = qc.getQueryData<AppSettings>(keys.appSettings);
      qc.setQueryData(keys.appSettings, next);
      return { previous };
    },
    onError: (_error, _next, context) => {
      if (context?.previous) qc.setQueryData(keys.appSettings, context.previous);
    },
  });
}

/** Marks an account with another colour; every view showing it refreshes. */
export function useSetAccountColor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ account, color }: { account: AccountId; color: string }) =>
      unwrap(commands.accountSetColor(account, color)),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.accounts }),
  });
}

/**
 * The meeting invitation in an opened message, if any, with what Google
 * Calendar says. Asked once the message is open (its body, which holds
 * the invitation, is stored by then).
 */
export function useInviteCard(id: MessageId, enabled: boolean) {
  return useQuery({
    queryKey: keys.invite(id),
    queryFn: () => unwrap(commands.inviteCard(id)),
    enabled: IS_TAURI && enabled,
    staleTime: 60_000,
  });
}

/** Yes / No / Maybe, or removing a cancelled event; the card updates. */
export function useInviteAction(id: MessageId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (action: Answer | "remove") =>
      unwrap(action === "remove" ? commands.inviteRemove(id) : commands.inviteAnswer(id, action)),
    onSuccess: (card) => qc.setQueryData(keys.invite(id), card),
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
      events.accountsChangedEvent.listen(() => {
        void qc.invalidateQueries({ queryKey: keys.accounts });
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
