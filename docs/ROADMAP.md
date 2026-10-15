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
- [x] Use the `oauth2` crate for PKCE, the consent URL and token exchange
- [x] Opening a message skips ahead of background sync in the quota queue
- [x] Cancel button while waiting for browser sign-in (closing the tab left
      the app waiting)
- [x] Mark a message read when opened; `u` toggles read/unread
      *(pulled forward from M3: first action, routed to the owning account)*

### Pulled forward from Milestone 2 (owner request, 2026-10-15)

Nearly all of the owner's mail is archived (Inbox Zero), so without these
most mail was missing from Mailboat.

- [x] Sync scope: first sync covers the newest 5,000 All Mail threads (so
      archived mail is cached and locally searchable), the Inbox, Starred,
      and small Drafts/Spam/Trash windows. Accounts synced under the old
      INBOX/STARRED/SENT scope get a one-time widening pass that only
      fetches what's missing.
- [x] All Mail view (every message except Spam and Trash)
- [x] Archive view: All Mail minus Inbox. Gmail has no "archived" label;
      archived just means not in INBOX.
- [x] Spam, Trash, Drafts and Important in the sidebar (search now skips
      Spam and Trash, as Gmail's does)

### Not yet verified in the real app

- [x] Read/unread round trip against real Gmail (change shows up in Gmail on the web)
- [x] Clicking a link in an email opens the default browser (web and
      mailto links) *(first attempt failed: the web view doesn't deliver
      clicks inside the sandboxed frame; reworked to a `mailboat-link:` scheme
      handler, verified 2026-10-15)*
- [x] Keychain prompt no longer returns after rebuilds (signed dev builds)

## UX Spike 1 (before Milestone 2)

Polish pass so the app feels good to use. Direction: the owner's
screenshots of Tern (terminal), Arc (browser) and MonoCode: glass sidebars,
a darker glass body, rounded corners where they meet, resizable panes.

- [x] Glass window: native macOS blur behind a transparent window; sidebar
      on thin glass, list and reader on a near-opaque tint for legibility
- [x] Rounded body panel inset from the window edge, sidebar on the glass
- [x] Resizable splitters (sidebar | list | reader); reader can be dragged
      narrow (300px) to act as a right-hand side panel. Double-click resets;
      arrow keys nudge a focused splitter. Widths reset on relaunch.
- [x] Owner feedback round 1: wider splitters (8px gap, 16px grab area);
      the list is now its own rounded card (the body) and the reader sits on
      the glass like a right-hand sidebar; both glass tints more transparent,
      closer to Tern
- [x] Toolbar across the top (Tern-style) with mail action buttons on the
      right; traffic lights centered in it. Only read/unread works (same as
      `u`); archive, delete, star, label, more and compose are placeholders
      until Milestones 3 and 4
- [x] Splitter gaps match the rest of the glass: the list card's soft
      shadow darkened them; now only a hairline edge, as in Tern
- [x] Show/hide toggles for the sidebar (toolbar, left; ⌃⌘S) and the
      reader (toolbar, right; ⌃⌘R). With both hidden only the list shows,
      full width. Not remembered between launches yet
- [x] The reader only appears when a conversation is selected (no more
      "No conversation selected" panel); Escape closes it
- [x] Empty states instead of "Nothing here": an icon, a title and a line
      per view. An empty Inbox is just a thumbs-up that nods and "All caught
      up" (owner dropped the rotating second line); a soft accent glow drifts slowly
      around the pane. Motion stops with macOS "Reduce motion"
- [x] Panels slide open and closed (220ms ease-out, from MonoCode): the
      sidebar and reader content fade and drift in from their own side, and
      the list grows or gives way in step. The reader keeps showing the
      last conversation while it slides away
- [x] Selecting a conversation (click or j/k) brings a hidden reader back
- [x] Text on the glass (sidebar, reader) one weight step up (500), so it
      holds up over the blurred backdrop; the list card stays regular
- [x] Quiet sync status (owner picked option A of three): no more
      "Syncing…" line pushing the sidebar down. A thin arc circles the
      account avatar only when a sync runs past 1.5s; an amber dot while
      retrying; a red dot plus one line only for errors you can act on.
      Hover the avatar for the status and last sync time. With the sidebar
      hidden, a problem shows as a dot on the sidebar toggle
- [x] The account's Google profile picture replaces the initial (saved at
      sign-in already; falls back to the initial if it can't load)

### Ideas for later in this spike (not started)

- Remember pane widths and which panels are hidden between launches
- Reader as its own rounded card, if text on the glass proves hard to read
- Stronger, adjustable blur (private `CGSSetWindowBackgroundBlurRadius`,
  Rust) if the system material looks too faint
- Sidebar grouping: demote Spam/Trash/Important/All Mail, labels as folders
- Thread row density, icons, hover/selection states
- Reader header, message stacking, how the white email card sits in dark mode
- Sync activity icon in the toolbar with a per-account popover (option B,
  not built); best once it can open the log console below
- Log console: hidden by default, opens at the bottom with a
  terminal-like, syntax-highlighted view of the sync log (far future;
  needs Rust to stream log lines to the UI)
- Hairline shimmer on the list card during long syncs (option C, not
  built; can't show which account is syncing)
- Real sync progress (e.g. "1,200 of 5,000") needs a new field from Rust
- Loading states (skeleton rows)
- Empty states: an illustration instead of an icon, and more personality
  per view (owner liked Google Chat's "All quiet here in message land")
- Visible focus and shortcut hints

## Milestone 2: Multiple accounts and unified inbox

- [ ] Add and remove accounts from the UI (add exists; remove needs UI)
- [ ] "All Inboxes" view across accounts (query exists; needs a second
      account to try for real)
- [ ] Per-account colors on rows (exists; review with two accounts)
- [ ] Independent sync workers (exist; verify with two real accounts)
- All Mail, Archive, Spam/Trash/Drafts/Important views and the wider sync
  scope: *pulled forward into Milestone 1 (see above)*
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
- [ ] Received attachments: list them in the reader, open, save, Quick Look
      preview *(split from M4 Compose, 2026-10-15: reading attachments doesn't
      depend on composing)*
- [ ] Inline (`cid:`) images inside emails, shown as placeholders today
      *(moved from Later: uses the same attachment download as above)*

## Milestone 4: Compose

- [ ] New message, reply, reply-all, forward with quoted HTML
- [ ] Sending attachments *(receiving moved to M3)*
- [ ] Drafts synced back to Gmail
- [ ] Choice of From account, defaulting to the conversation's account

## Milestone 5: Polish

- [ ] Command palette (cmdk)
- [ ] Full keyboard shortcuts
- [ ] Remote Gmail search (`q=`) fanned out per account, merged by date
- [ ] Notifications
- [ ] Offline mode

## Later / unscheduled

- [ ] Replace hand-built Gmail fixtures with scrubbed real recordings
- [ ] Windows build and testing; Linux nice-to-have
- [ ] Release signing and packaging
- [ ] AI-drafted replies with user-supplied OpenAI/Anthropic keys (see `CLAUDE.md`)
