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
      arrow keys nudge a focused splitter. (Widths are now remembered; see
      below.)
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
      around the pane. Motion stops with macOS "Reduce motion". The
      rise plays once, when a list turns empty; moving to another empty
      view only cross-fades the glyph and words in place. The icon is pinned
      at the centre with the words hanging below, so different messages
      can't shift it, and the list keeps showing until the next view's
      arrives instead of blanking
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
- [x] Search moved from the list card to the center of the title bar, as
      in VS Code: magnifier, `/` hint, clear button. Searches the view picked
      in the sidebar. Focus shows as the blue border plus a soft glow; the
      inner focus box is gone
- [x] Sidebar tidy: icons on every view; Inbox, Starred, Sent, Drafts,
      Archive up top and All Mail, Important, Spam, Trash folded under
      "More"; labels under a "Labels" heading, grouped by "/" and
      "Prefix: " ("Acme" holds Review, Scam, …) with folds that animate
      open; IMAP brackets dropped ("[Orbit]" → "Orbit"); every label dot
      had a faint outline so dark Gmail colors still show (removed in M3,
      owner's call). Folds reset on
      relaunch
- [x] Unread counts in the sidebar (Inbox, Starred and labels), per account
      and summed for unified views
- [x] Reader cards line up with the list panel: same 8px gaps (window
      edge and splitter), same 10px corners and hairline edge, so at the end
      of a conversation the bottoms match (to the pixel: the reader's content
      height is kept whole so the last card's edge isn't cropped); the
      reader's bottom corners stay rounded while scrolling
- [x] Clearer glass: tints found with a temporary transparency slider
      (owner's pick, 45% clearer than before: dark 6.5% sidebar/reader and
      34% list panel), then the slider was removed
- [x] Sidebar counts only where unread is actionable: Inbox, Starred and
      labels (owner picked this over "Everything", which added Unread,
      Archive and All Mail, and over no counts)
- [x] A calmer, more glanceable sidebar (owner picked "Tidy" of three
      layouts tried in the app; Switcher and Mimestream-style Nested were
      the others): unread counts, the account ring in each header,
      accounts fold away (open by default, Inbox count shown while
      folded), labels in their own fold (closed by default), no grey dots
      on labels without a Gmail colour
- [x] "Add account" is a small "+" in an icon bar at the sidebar's foot
      (owner picked option A), with room for settings and the log console
- [x] While a browser sign-in waits, the "+" becomes a cancel button; and
      clicking "+" again (e.g. after closing the browser tab) starts over
      instead of failing with "a sign-in is already in progress"
- [x] Thread rows line up: a fixed gutter for the unread dot; senders
      medium weight; star and attachment as icons instead of emoji
- [x] List titles drop the account when there's only one ("Inbox"), and
      searches read "Results for “newsy”"
- [x] Archive, Delete, Star, Label and More dim with nothing selected
- [x] Read rows use medium weight throughout; unread subjects step up to
      semibold so unread still stands out
- [x] The empty-state glow is drawn towards the pointer while it's over
      the pane (still drifting), and eases back to its usual path when the
      pointer leaves. Off under "Reduce motion". Reworked after it stuttered: it
      now glides per frame instead of restarting a CSS transition on every
      pointer move, and the glow is a soft gradient instead of a blur filter;
      it then centres on the cursor (its drift is cancelled out while
      attracted) instead of stopping short; it spans the whole list card,
      title row included (it was cut off below it), and follows the pointer
      anywhere on the card. It lingers 2s where the pointer left before
      drifting home, and drifts back about half as fast, so a trip to the
      sidebar doesn't send it rebounding to the middle
- [x] Smoother switching between conversations: the previous one stays
      up (dimmed) until the next is ready instead of blanking; the new one
      fades in (a small rise was dropped: it bounced when paging); each email card stays hidden until it has
      its full height, then fades in (a soft placeholder holds its place
      while loading); and the reader always reserves its scrollbar gutter,
      so a long email no longer narrows the reader and reflows mid-view
- [x] Account avatar ends flush with the selected row's right edge, and
      the account header is a 28px row with a little room before Inbox
      (briefly tried on the left; the owner preferred the right)

Wrapped up 2026-10-15. Everything below stays open and
moves into later milestones as it's picked up.

### Proposed but not built

Options offered during the spike that the owner didn't pick (yet):

- Sync status as a toolbar activity icon with a per-account popover
  (option B); best once it can open the log console
- Sync status as a hairline shimmer on the list card (option C); can't
  show which account is syncing
- Add-account area as an account menu on the avatar (option C): accounts,
  add, remove, settings. *(Partly built in Milestone 2: the avatar now
  opens a per-account menu with "Sync now" and "Remove account…"; adding
  stays on the "+".)*
- Reader as its own rounded card, if text on the glass proves hard to read
- Stronger, adjustable blur (private `CGSSetWindowBackgroundBlurRadius`,
  Rust, as in Synara and MonoCode) if the system material looks too faint
- `j`/`k` leaving a hidden reader hidden (today they bring it back)

### Deferred ideas

- Remember which panels are hidden between launches (pane widths are
  remembered now)
- Remember which sidebar folds are open
- Thread row density (rows are still 72px, three lines)
- Unread count in the list title (sidebar counts are done)
- Reader header, message stacking, how the white email card sits in dark mode
- Log console: hidden by default, opens at the bottom with a
  terminal-like, syntax-highlighted view of the sync log (far future;
  needs Rust to stream log lines to the UI)
- Real sync progress (e.g. "1,200 of 5,000") needs a new field from Rust
- Loading states (skeleton rows)
- Empty states: an illustration instead of an icon, and more personality
  per view (owner liked Google Chat's "All quiet here in message land")
- Visible focus and shortcut hints (toolbar tooltips show some today)
- Light mode: built alongside dark but never reviewed by the owner
- Broken "?" boxes where remote images are blocked inside emails *(done
  in Milestone 3)*
- The traffic lights once jumped during live resize in MonoCode; not seen
  here, but worth watching

### After the spike (owner request, 2026-10-15)

- [x] Remote images load by default outside Spam (option A of three):
      Spam always blocked, Trash blocked unless the sender is allowed, a
      per-sender "Block images" / "Load images" choice wins otherwise.
      Known trackers are still removed. CLAUDE.md's security rule updated
- [x] Long emails scroll on the first swipe: the email frame no longer
      scrolls vertically itself, so it can't catch the gesture and
      rubber-band (wide emails can still scroll sideways)
- [x] The reader's account marker and address only show with more than
      one account
- [x] Emails on the glass, step 1: plain-text emails and HTML emails whose
      colors are inline sit straight on the reader's glass, text aligned
      with the subject. In dark mode their colors are remapped (Rust,
      `mail/colors.rs`): near-white backgrounds turn see-through, light
      greys and pale tints turn dark, dark text and links get lighter,
      strong brand colors and images stay. Light mode keeps the email's own
      colors. Emails with their own style sheet or that ask for light only
      keep the white card
- [x] Reader refinement (owner feedback): each message is a rounded card in
      layers of glass (open messages a little firmer than collapsed ones,
      the image notice a lighter strip inside); headers are one tidy row
      with a sender initial, the name and a short date (full date on
      hover), and the addresses on a single truncated line; avatar, notice,
      white card and adapted email text share one left edge
- [x] Opening or closing a message no longer jumps: the first header line
      is the same in both states, the snippet fades, and the addresses and
      body fold in with a short animation; the image notice is shorter
      ("Block images", sender in the tooltip) so it never truncates
- [x] Collapsed message cards are 44px with the header centred (a stray
      5px descender gap under the header button is gone); the padding
      eases open with the message
- [x] New app icon (owner picked variant A3 of six): a sky-blue M drawn
      as an envelope's sides and flap on a frosted glass card, over the
      app's glow, in a macOS rounded square. Source and the variants
      offered are in `design/icon/`. Enlarged after a look in the Dock: the
      card and M fill about two thirds of the tile, like other apps
      Then (owner picked T2 + B3): a brighter, glowing M on a midnight
      background (navy to near-black) instead of navy-to-violet, which made
      the M hard to read. Tweaks and backgrounds offered are kept too
- [x] New app icon, round two: a green M drawn as a ribbon folding over
      itself at each corner (after VS Code's logo) on a flat near-black
      tile, replacing the glass icon (owner wanted flat, high-contrast
      icons). Picked fold style S4 and colour C13 from the sheets in
      `design/icon/sheets/`; the other colours are kept in
      `design/icon/choices/`
- [x] Clicking the empty area below the list's rows clears the selection
      and slides the reader closed (as Escape does), like Mail and
      Mimestream
- [x] Splitter positions are remembered between launches. The sidebar
      keeps its width when the window resizes; the list and reader resize
      together, since the list is stored as a share of the space beside the
      sidebar
- [x] Icon colour changed after living with it: green (C13), then cobalt
      (C04) and sky (C03), now Apple's system blue (C17), matched to Mail's
      icon as macOS renders it
- [x] The icon gets macOS's Liquid Glass rim and depth, like other apps:
      it also ships as an Icon Composer icon (`Assets.car`), and dev builds
      run from a signed `Mailboat.app` so the Dock shows it there too
- [x] Tell unread apart from the account in mixed-account lists (both
      were blue dots): the account is now a hollow ring in a softened
      account colour, unread stays a solid dot. Owner picked it after two
      rounds in the app (round 1: bar, no unread dot, avatar, all too busy;
      round 2: glass bar, ring, glass dot)
- [x] Emails on the glass: grey borders (hairlines meant for a white card)
      become a faint line in dark mode instead of stark white; colored
      borders stay. Seen on Gmail's confidential-mode notice, which also
      has no top border by design. (Its content can't be shown in any
      client: it only opens on Gmail's site, via "View the email".)
- [x] Emails on the glass: a white card on a light grey page stays
      distinct (the page gets a faint lift, the card a slightly darker
      tint, as Mimestream shows them), so cards without a top border keep
      their top edge; plain white emails still show the glass
- [x] Emails shown on the white card ignore their own dark-mode rules (an
      a software vendor email's text went white on white, in Mimestream too), and an
      email's page title no longer shows at the top of the body
- [ ] Emails on the glass, step 2: remap colors set in an email's own style
      sheet (needs a CSS parser), so more newsletters can adapt
- [ ] Dark mode for emails that declare it (`color-scheme: light dark`, as
      a vendor's do): apply their own dark rules plus our remap of their
      inline colours, as Mail.app does, instead of the white card. Their
      dark rules alone aren't enough (a vendor's turn text white but never
      darken its inline white backgrounds). Fall back to the white card if
      their style sheet sets text colours outside its dark-mode block
- [ ] "Original colors" toggle per message, for emails the remap gets wrong
- [ ] Softer look for the remaining white cards on the glass
- [ ] A setting to switch the default back to "blocked"
- [ ] Load by default only for people you've written to (option B, not
      built)
- [ ] Background image prefetch during sync, like Apple Mail, so senders
      can't tell when you opened (option C, not built)

- [x] Sidebar spacing matches the panes: its rows end 8px before the list
      (was 16px, an extra right padding), the same gap as list to reader

## Milestone 2: Multiple accounts and unified inbox

- [x] Add and remove accounts from the UI. Clicking an account's avatar
      (or right-clicking its header) opens a menu with its sync status,
      "Sync now" and "Remove account…", which asks first. Removing stops
      that account's sync and waits for it to end, then deletes its cached
      mail and its keychain sign-in; Gmail itself is untouched. A view that
      only showed that account falls back to the default. *(Verified in the
      real app, 2026-10-16.)* Fixed after testing: a right-click menu
      closed as soon as the mouse button came up; and the menu now works
      like macOS's, with nothing highlighted until ↓/↑ or the pointer picks
      an item (↓ used to skip to the second one). Fixes verified 2026-10-16
- [x] "All Inboxes" view across accounts *(verified with two real
      accounts, 2026-10-16)*
- [x] Per-account colors on rows *(verified with two real accounts,
      2026-10-16)*
- [x] Independent sync workers *(verified with two real accounts,
      2026-10-16)*
- All Mail, Archive, Spam/Trash/Drafts/Important views and the wider sync
  scope: *pulled forward into Milestone 1 (see above)*
- [x] Load older mail on demand when scrolling past the cached window
      *(promised in the M1 plan)*. Reaching the end of a list fetches the
      next 25 conversations Gmail has for that view, per account at once,
      ahead of background sync; rows appear in fives, with "Loading older
      mail…" under the list. Works for every view except search (remote
      search is Milestone 5). A failure shows "Try again" instead of
      retrying on every scroll. *(Verified in the real app, 2026-10-16.)*

Wrapped up 2026-10-16: everything above verified by the owner with two
real accounts.

## Milestone 3: Actions

All routed to the owning account, applied optimistically in the UI, and
split per account for selections that span accounts.

- [x] Archive (`e`, toolbar). On archived mail the same button and key
      move it back to the Inbox. The next conversation opens, as in Mail
- [x] Star / unstar (`s`, toolbar; the star lights up when starred)
- Read / unread: *moved to M1 follow-ups* (now also works on several
  conversations at once)
- [x] Apply and remove labels: `l` or the toolbar opens a picker with the
      account's labels; type to filter, ↑/↓ and Enter or click to toggle.
      A tick means every chosen conversation has it, a dash only some.
      Labels can't be picked across accounts (they belong to one).
      Creating new labels isn't built yet (see Milestone 5)
- [x] Move to Trash (`#`, toolbar); in the Trash the same button restores.
      Trashed mail now leaves Inbox, Starred, labels and their counts, as
      in Gmail. "Delete forever" isn't offered: it needs Google's full-mail
      scope, and Gmail empties the Trash after 30 days itself
- [x] Undo: archive, trash and label changes show a toast with Undo
      (also `z` or ⌘Z while it's up); errors show there too
- [x] Several conversations at once: ⌘-click picks one, ⇧-click a
      range, `x` the open one; Esc clears. Every action applies to all
      picked, split per account in Rust
- [x] Received attachments: list them in the reader, open, save, Quick Look
      preview *(split from M4 Compose, 2026-10-15: reading attachments doesn't
      depend on composing)*. Chips under each message: click opens with the
      default app, the eye is Quick Look, the arrow saves to Downloads
      ("Show in Finder" in the toast). Files download once and are tagged
      as downloaded from the internet, so macOS checks them first. Mail
      opened before this update fetches its body again once to find its
      attachments
- [x] Inline (`cid:`) images inside emails, shown as placeholders today
      *(moved from Later: uses the same attachment download as above)*.
      They show even where remote images are blocked (they're part of the
      email)
- [x] The paperclip for mail with attachments sits in the row's left
      gutter, under the unread dot on the subject line, instead of after
      the subject *(owner request, 2026-10-16)*. It never showed at all
      before: sync only fetches headers, which don't list attachments. Now
      sync treats `multipart/mixed` mail as having attachments, an opened
      message's real attachment list corrects that, and a one-time
      catch-up asks Gmail which cached messages have attachments
- [x] Rows keep an icon column: the account ring on the sender line, the
      star under it on the subject line, so sender, subject and snippet
      always start at the same place *(owner request, 2026-10-16)*
- [x] Fixes after testing (2026-10-16): removing the current label view's
      label from the picker closes the picker (the next conversation had
      opened under it, still ticked); conversations opened in the first
      M3 build get their paperclips (a one-time recount); sidebar label
      dots lose their grey outline (owner's call)
- [x] Tidy placeholders instead of broken "?" boxes where images don't
      load (blocked remote images, missing inline ones), sized as the
      email asked *(moved from the UX Spike's deferred ideas)*

Wrapped up 2026-10-16: verified by the owner in the real app with two
accounts (actions round-trip to Gmail, undo, multi-account selection,
attachments, inline images, paperclips).

## Milestone 4: Compose

**Design discussion first** (owner request, 2026-10-16). Starting point:
a compose card floating over the window in the lower right, as in Gmail
on the web. It must not block the rest of the app: a conversation stays
open and readable beside it, so text can be copied between them (Notion
Mail can't do this; the owner relies on it in Gmail).

- [ ] Compose window design agreed with the owner (placement, sizes,
      minimise, several drafts, replies inline or in the card)
- [ ] New message, reply, reply-all, forward with quoted HTML
- [ ] Sending attachments *(receiving moved to M3)*
- [ ] Drafts synced back to Gmail
- [ ] Choice of From account, defaulting to the conversation's account
- [ ] Signatures: use each address's Gmail signature when composing
      (read with the current `gmail.modify` scope) *(owner request,
      2026-10-16)*. Managing them is in Milestone 6

## Milestone 5: Polish

- [ ] Report spam (and "Not spam" in the Spam view) as an action, routed
      per account like the others *(owner request, 2026-10-16)*
- [ ] Right-click menus on conversations (archive, trash, read, star,
      labels, spam, …) and other places where macOS apps have them
      *(owner request, 2026-10-16)*
- [ ] Swipe on a conversation (trackpad, two fingers): one way archives,
      the other toggles read/unread *(owner request, 2026-10-16)*.
      **Discuss the animation with the owner first** (what shows behind
      the row, how far to swipe, what commits or springs back)
- [ ] Create, rename and delete labels (the label picker only applies
      existing ones) *(not in the M3 list; noted while building it)*
- [ ] Command palette (cmdk)
- [ ] Full keyboard shortcuts
- [ ] Remote Gmail search (`q=`) fanned out per account, merged by date
- [ ] Notifications
- [ ] Settings: choose the app icon from `design/icon/choices/` (the
      folded M in 16 colours, or the earlier glass icon)
- [ ] Settings screen *(owner request, 2026-10-16: **discuss first** how
      it opens (⌘, menu, the sidebar's icon bar), and whether it's its own
      window, a sheet, or a page in the main window)*, with a transparency
      slider per area (sidebar and reader, list panel). Per area, because one shared slider scaling
      each tint by the same share changed the list far more than the
      sidebar
- [ ] Remember the window between launches: position, size, and
      maximized/full-screen state *(owner request, 2026-10-16)*. Works with
      several monitors: reopens on the display it was last on, and if that
      display is gone (unplugged, or the arrangement changed) or the saved
      spot would be off-screen, it moves fully onto a connected display
      instead of opening out of sight. Likely Tauri's `window-state`
      plugin, which would need a reason recorded for the new plugin
- [ ] Offline mode

## Milestone 6: Rules and signatures

Both need Gmail's settings scope (`gmail.settings.basic`), which Mailboat
doesn't ask for yet: adding it means each account signs in again once to
approve it, and an ARCHITECTURE decision row.

- [ ] Rules (Gmail filters): list, create, edit, delete *(owner request,
      2026-10-16)*
- [ ] Create a rule from a message, as Gmail's "Filter messages like
      these": sender, subject and so on filled in from it
- [ ] Manage signatures per address (using them is in Milestone 4)

## Later / unscheduled

- [ ] Replace hand-built Gmail fixtures with scrubbed real recordings
- [ ] Windows build and testing; Linux nice-to-have
- [ ] Windows: scrollbars. The app uses the system's own (macOS overlay
      ones that hide when not scrolling); check they look right on
      Windows, and style them there only if needed
- [ ] Release signing and packaging
- [ ] AI-drafted replies with user-supplied OpenAI/Anthropic keys (see `CLAUDE.md`)
