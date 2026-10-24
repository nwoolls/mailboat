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
  AiProvider,
  AccountFilter,
  AccountId,
  AccountSyncState,
  Answer,
  AppSettings,
  MessageId,
  RuleActions,
  AccountVacation,
  RuleCriteria,
  ThreadId,
  VacationSettings,
} from "../../platform/tauri/bindings";
import { IS_TAURI, unwrap } from "../../platform/tauri/ipc";
import { newRequestId } from "../../features/ai/ui/stream";
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
  original: (id: MessageId) => ["original", id] as const,
  identities: ["identities"] as const,
  contacts: ["contacts"] as const,
  appInfo: ["appInfo"] as const,
  defaultMailApp: ["defaultMailApp"] as const,
  appSettings: ["appSettings"] as const,
  imageCache: ["imageCache"] as const,
  invite: (id: MessageId) => ["invite", id] as const,
  rules: ["rules"] as const,
  vacations: ["vacations"] as const,
  ruleMatch: (account: AccountId, criteria: RuleCriteria) =>
    ["ruleMatch", account, criteria] as const,
  aiStatus: ["aiStatus"] as const,
  aiUsage: ["aiUsage"] as const,
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
    // Every page loaded stays until the app quits (not 5 minutes after
    // leaving), so a view comes back scrolled as far down as it was left
    // (`ThreadList`). Not searches: each typed letter is a new one.
    gcTime: selection.view.kind === "search" ? undefined : Infinity,
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

/**
 * A message ready to show, with its sender's choices applied (images,
 * original colors). A changed choice refetches it; the current one stays
 * up until the new one arrives.
 */
export function useOpenedMessage(id: MessageId) {
  return useQuery({
    queryKey: keys.message(id),
    queryFn: () => unwrap(commands.messageOpen(id)),
    enabled: IS_TAURI,
    staleTime: Infinity,
    placeholderData: keepPreviousData,
  });
}

/**
 * An email as it arrived ("Show original"). Not kept once the dialog
 * closes: it can be megabytes, and is only looked at now and then.
 */
export function useOriginal(id: MessageId | null) {
  return useQuery({
    queryKey: keys.original(id ?? -1),
    queryFn: () => unwrap(commands.messageOriginal(id!)),
    enabled: IS_TAURI && id !== null,
    staleTime: Infinity,
    gcTime: 0,
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

/**
 * Which app opens `mailto:` links (Settings → General). Read fresh each
 * time Settings shows it: it can change in another app.
 */
export function useDefaultMailApp() {
  return useQuery({
    queryKey: keys.defaultMailApp,
    queryFn: () => commands.mailAppDefault(),
    enabled: IS_TAURI,
    staleTime: 0,
  });
}

/** Asks macOS to make Mailboat the default email reader (macOS confirms). */
export function useMakeDefaultMailApp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(commands.mailAppMakeDefault()),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.defaultMailApp }),
  });
}

/** Settings Rust acts on (Settings page). */
/** How much the images downloaded ahead of time take (Settings → Viewing). */
export function useImageCacheSize() {
  return useQuery({
    queryKey: keys.imageCache,
    queryFn: () => unwrap(commands.imageCacheSize()),
    enabled: IS_TAURI,
  });
}

export function useClearImageCache() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(commands.imageCacheClear()),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.imageCache }),
  });
}

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
    // Open emails follow a new remote-image default at once.
    onSuccess: (_saved, next, context) => {
      if (context?.previous?.remoteImages !== next.remoteImages)
        void qc.invalidateQueries({ queryKey: ["message"] });
      // A smaller limit trims the cache at once.
      if (context?.previous?.imageCacheMb !== next.imageCacheMb)
        void qc.invalidateQueries({ queryKey: keys.imageCache });
    },
  });
}

/** Whether Apple Intelligence, Claude and ChatGPT can be used now. */
export function useAiStatus() {
  return useQuery({
    queryKey: keys.aiStatus,
    queryFn: () => unwrap(commands.aiStatus()),
    enabled: IS_TAURI,
    staleTime: 60_000,
  });
}

/**
 * Connects Claude or ChatGPT, signing in through its own tool (the
 * browser opens) if needed. Settings come back with it added.
 */
export function useAiConnect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (provider: AiProvider) => unwrap(commands.aiConnect(provider)),
    onSuccess: (saved) => qc.setQueryData(keys.appSettings, saved),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.aiStatus }),
  });
}

export function useAiDisconnect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (provider: AiProvider) => unwrap(commands.aiDisconnect(provider)),
    onSuccess: (saved) => qc.setQueryData(keys.appSettings, saved),
  });
}

/**
 * The writing assistant's suggestion chips for a conversation being
 * answered or forwarded, written from it (saved per conversation in
 * Rust, so asking again is instant until new mail arrives). Leaving
 * stops it. Shared with `prefetchAiReplyIdeas`, so Reply with AI can
 * start them before the reply has loaded.
 */
function aiReplyIdeasQuery(thread: ThreadId | null, forward: boolean, provider: AiProvider) {
  return {
    queryKey: ["aiReplyIdeas", thread, forward, provider] as const,
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      const id = newRequestId();
      signal.addEventListener("abort", () => void commands.aiCancel(id));
      return unwrap(commands.aiReplyIdeas(thread!, forward, id));
    },
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    retry: false,
  };
}

/** `null` skips asking (new mail). */
export function useAiReplyIdeas(thread: ThreadId | null, forward: boolean, provider: AiProvider) {
  return useQuery({
    ...aiReplyIdeasQuery(thread, forward, provider),
    enabled: IS_TAURI && thread !== null,
  });
}

/** Starts writing a reply's chips now (Reply with AI, while the reply loads). */
export function usePrefetchAiReplyIdeas() {
  const qc = useQueryClient();
  return (thread: ThreadId, provider: AiProvider) => {
    if (IS_TAURI) void qc.prefetchQuery(aiReplyIdeasQuery(thread, false, provider));
  };
}

/** The ChatGPT models Codex offers (Settings → AI). */
export function useChatgptModels(enabled: boolean) {
  return useQuery({
    queryKey: ["chatgptModels"],
    queryFn: () => unwrap(commands.aiChatgptModels()),
    enabled: IS_TAURI && enabled,
    staleTime: Infinity,
  });
}

/** Requests, tokens and cost per provider, today and over 30 days. */
export function useAiUsage(todayStart: number) {
  return useQuery({
    queryKey: [...keys.aiUsage, todayStart],
    queryFn: () => unwrap(commands.aiUsage(todayStart)),
    enabled: IS_TAURI,
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

/** Every account's rules (Gmail filters), read from Gmail each time Settings shows them. */
export function useRules() {
  return useQuery({
    queryKey: keys.rules,
    queryFn: () => unwrap(commands.rulesList()),
    enabled: IS_TAURI,
  });
}

/**
 * How many conversations match a rule's criteria now, for the editor.
 * Pass the criteria once typing has paused; null asks nothing.
 */
export function useRuleMatchCount(account: AccountId, criteria: RuleCriteria | null) {
  return useQuery({
    queryKey: keys.ruleMatch(account, criteria!),
    queryFn: () => unwrap(commands.ruleMatchCount(account, criteria!)),
    enabled: IS_TAURI && criteria !== null,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    retry: false,
  });
}

export type RuleSave = {
  accountId: AccountId;
  /** The rule being edited, or null for a new one. */
  filterId: string | null;
  criteria: RuleCriteria;
  actions: RuleActions;
  applyToExisting: boolean;
};

/** Creates or replaces a rule; the rules list refreshes. */
export function useSaveRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (r: RuleSave) =>
      unwrap(
        r.filterId === null
          ? commands.ruleCreate(r.accountId, r.criteria, r.actions, r.applyToExisting)
          : commands.ruleUpdate(r.accountId, r.filterId, r.criteria, r.actions, r.applyToExisting),
      ),
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.rules }),
  });
}

export function useDeleteRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ accountId, filterId }: { accountId: AccountId; filterId: string }) =>
      unwrap(commands.ruleDelete(accountId, filterId)),
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.rules }),
  });
}

/**
 * Every account's vacation responder. Settings shows and edits it; the
 * mail view shows a banner while one is replying. Asked again every few
 * minutes at most (1 quota unit per account).
 */
export function useVacations() {
  return useQuery({
    queryKey: keys.vacations,
    queryFn: () => unwrap(commands.vacationList()),
    enabled: IS_TAURI,
    staleTime: 5 * 60_000,
  });
}

/** Saves an account's vacation responder; the banner follows. */
export function useSaveVacation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ account, settings }: { account: AccountId; settings: VacationSettings }) =>
      unwrap(commands.vacationSet(account, settings)),
    onSuccess: (saved) =>
      qc.setQueryData<AccountVacation[]>(keys.vacations, (list) =>
        list?.map((v) => (v.accountId === saved.accountId ? saved : v)),
      ),
  });
}

/** Changes one address's signature in Gmail; compose uses it straight away. */
export function useSetSignature() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ account, email, html }: { account: AccountId; email: string; html: string }) =>
      unwrap(commands.signatureSet(account, email, html)),
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.identities }),
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
        // A new sign-in may have added the permission rules need.
        void qc.invalidateQueries({ queryKey: keys.rules });
        void qc.invalidateQueries({ queryKey: keys.vacations });
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
