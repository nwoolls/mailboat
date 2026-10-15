# Mailboat roadmap

The single list of what is done, in progress and planned. Every piece of
work updates this file in the same commit: tick what you finished, and when
something moves between milestones, move it here and say why.

`[x]` done · `[ ]` to do · *(moved from Mx)* notes where an item came from.

## Milestone 1: Foundation

- [x] Scaffold: Tauri v2, React, Vite, Tailwind, Bun tooling, `CLAUDE.md`
- [x] Account-scoped SQLite schema and one query layer for every list view
- [x] Two-account test with overlapping Gmail IDs (`two_accounts_with_overlapping_gmail_ids`)
- [x] Gmail REST client: batching, retry/backoff, quota pacing
- [x] Google sign-in (loopback + PKCE), refresh tokens in the OS keychain
- [x] Initial sync of INBOX/STARRED/SENT, incremental `history.list` sync,
      full resync when the historyId expires, resumable full sync
- [x] Independent sync worker per account
- [x] Virtualized thread list, sidebar, keyboard navigation (j/k, `/`)
- [x] Safe HTML reader: sanitizer, sandboxed iframe, image blocking,
      tracker removal, per-sender "load images"
- [x] Sync diagnostics log (`~/Library/Logs/com.nwoolls.mailboat/sync.log`)

### Milestone 1 follow-ups (owner feedback, 2026-10-15)

- [x] `README.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, conventions in `CLAUDE.md`
- [ ] Use the `oauth2` crate for PKCE, the consent URL and token exchange
- [ ] Opening a message skips ahead of background sync in the quota queue
- [ ] Cancel button while waiting for browser sign-in (closing the tab left
      the app waiting)
- [ ] Mark a message read when opened; `u` toggles read/unread
      *(pulled forward from M3: first action, routed to the owning account)*

### Not yet verified in the real app

- [ ] Clicking a link in an email opens the default browser
- [ ] Keychain prompt no longer returns after rebuilds (signed dev builds)

## Milestone 2: Multiple accounts and unified inbox

- [ ] Add and remove accounts from the UI (add exists; remove needs UI)
- [ ] "All Inboxes" view across accounts (query exists; needs a second
      account to try for real)
- [ ] Per-account colors on rows (exists; review with two accounts)
- [ ] Independent sync workers (exist; verify with two real accounts)
- [ ] All Mail view (every message except Spam and Trash) *(moved from M1 feedback)*
- [ ] Spam, Trash, Drafts and Important in the sidebar *(moved from M1 feedback)*
- [ ] Sync scope: first sync covers the newest All Mail threads plus small
      Spam/Trash/Drafts windows, not only INBOX/STARRED/SENT *(moved from M1 feedback)*
- [ ] Load older mail on demand when scrolling past the cached window
      *(promised in the M1 plan, never built)*

## Milestone 3: Actions

All routed to the owning account, applied optimistically in the UI, and
split per account for selections that span accounts.

- [ ] Archive
- [ ] Star / unstar
- Read / unread: *moved to M1 follow-ups*
- [ ] Apply and remove labels
- [ ] Delete / move to trash

## Milestone 4: Compose

- [ ] New message, reply, reply-all, forward with quoted HTML
- [ ] Attachments (send, and download/open received ones)
- [ ] Drafts synced back to Gmail
- [ ] Choice of From account, defaulting to the conversation's account

## Milestone 5: Polish

- [ ] Command palette (cmdk)
- [ ] Full keyboard shortcuts
- [ ] Remote Gmail search (`q=`) fanned out per account, merged by date
- [ ] Notifications
- [ ] Offline mode

## Later / unscheduled

- [ ] Inline (`cid:`) images in emails (shown as placeholders today)
- [ ] Replace hand-built Gmail fixtures with scrubbed real recordings
- [ ] Windows build and testing; Linux nice-to-have
- [ ] Release signing and packaging
- [ ] AI-drafted replies with user-supplied OpenAI/Anthropic keys (see `CLAUDE.md`)
