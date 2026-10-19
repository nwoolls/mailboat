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

- Remember which panels are hidden between launches, and which sidebar
  folds are open: *moved to Milestone 7 (owner, 2026-10-19)*
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
- Its open follow-ups (email colours and dark mode, remote-image
  options) moved to UX Spike 2 (owner, 2026-10-17)

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
      *Fixed (owner report, 2026-10-19):* Undo used to open the
      conversation it brought back even if it wasn't open before (e.g.
      swiped away to Inbox Zero, then Undo). It now reopens only the
      conversation that was open when the action ran
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
- [x] Links with more than one query parameter opened broken: the
      sanitizer passed `&amp;` through instead of `&`, so Google Calendar's
      Yes/No/Maybe buttons failed with "400 Bad Request" (owner report,
      2026-10-16). They now open intact, as do images with such URLs
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

Design agreed with the owner, 2026-10-16:

- **New messages** open in a card floating over the window, starting in
  the lower right, as in Gmail on the web. It never blocks the app: a
  conversation stays open, readable and selectable beside it, so text
  can be copied between them (Notion Mail can't do this; the owner relies
  on it in Gmail).
- **Moving the card works like iOS picture-in-picture:** it can't be left
  just anywhere; dragged towards a corner or the middle of a side, it
  springs (rubber-bands) into that spot when released. No pop-out window.
- **Replies, reply-all and forwards are inline,** at the bottom of the
  conversation in the reader, as Gmail does by default.
- **Full formatting from the start:** fonts, sizes, colours, bold,
  italic, underline, lists, links, quotes, alignment (as Gmail's
  toolbar), not a basic set first.
- **Undo send as Gmail:** 5 seconds (Gmail's default) to take a message
  back.
- **Card size:** start around Gmail's (about 500×560) and adjust once
  it's in use.
- Proposed and not objected to: Esc minimises (never discards); drafts
  save to Gmail as you type; several minimised drafts sit side by side
  along the bottom; keys `c` new, `r` reply, `a` reply all, `f` forward,
  ⌘↩ send; the card shows the From account's colour; quoted text folds
  behind "…".

Owner's answers before starting, 2026-10-16:

- **Address suggestions** come from mail Mailboat already has (every
  account) **and from Google Contacts**. Contacts needs a new permission
  (`contacts.readonly` and `contacts.other.readonly`, through Google's
  People API), so each account signs in again once, and the People API
  has to be turned on in the owner's Cloud project.
- **From** lists every account and its Gmail "Send mail as" aliases, each
  with its own signature. Replies default to the address the mail was
  sent to.
- **A Drafts view** in the sidebar, unified across accounts: drafts
  started in Gmail elsewhere show there and resume in Mailboat.
- **Built in stages, each tried by the owner in the app before the next.**

Stage 1: sending, plain text *(built 2026-10-16; waiting for the
owner to try it in the app)*

- [x] New message, reply, reply-all and forward, sent through Gmail and
      shown in the conversation straight away (plain text for now). The
      reply quotes the original under "On …, … wrote:"; the forward
      carries Gmail's "Forwarded message" block. Replies follow Reply-To,
      and replying to your own sent mail goes to its recipients again
- [x] Choice of From: accounts and their aliases, defaulting to the
      conversation's account (the address the mail was sent to). The
      menu only shows when there's more than one address. Replying from
      another account starts a new conversation in that account
- [x] To / Cc / Bcc with suggestions from mail already in Mailboat. People
      you've written to come first. Comma, Return or Tab makes a chip;
      Backspace takes the last one back; double-click a chip to edit it
- [x] Keys: `c` new, `r` reply, `a` reply all, `f` forward, ⌘↩ send.
      Buttons under the conversation (Reply all only when there's
      someone else to include) and the toolbar's pencil do the same
- [x] Basic floating card (lower right, the From account's colour on
      its top edge) and basic inline replies *(pulled forward from stage
      2 so there was somewhere to write; their polish stays there)*
- Sending isn't retried after a timeout or server error (it might
  already have gone); the message stays open with the error so you can
  decide. *(Closing no longer asks: drafts are saved since stage 4.)*

Stage 2: the card and inline replies

- [x] Several new messages at once, and minimise: Esc or the – button
      folds the card into a tab along the bottom (nothing is lost).
      Opening another message minimises the one open (an untouched one
      just closes); clicking a tab swaps it back in
- [x] Floating compose card: the snapping behaviour above. Drag it by
      its header; on release it springs (overshooting a little) to the
      nearest corner or side middle, and a quick flick carries it to
      where it was heading. The next new message opens in the same spot
- [x] Compose card transparency *(owner request, 2026-10-16; done early
      at the owner's request)*: glass instead of the menus' solid
      surface, with its own blur since it floats over the app's content.
      Tint 72% dark / 78% light (`--glass-compose-strength`); tune once
      seen in use
- [x] Pop out a reply *(owner, 2026-10-17: "yes" to Gmail's)*: the
      button at the top right of an inline reply moves it into the
      floating card (not a separate window), so other mail can be read
      while writing. The conversation then says it's open in its own card,
      with "Show it"; replying again brings it forward
- [x] Switch kind *(owner, 2026-10-17: "yes" to Gmail's)*: a small
      button showing the current kind, on the To line by Cc and Bcc (as in
      Mimestream; first built at the top of the reply, where the owner
      missed it), turns it into Reply, Reply all or Forward without
      starting over. What was written, From, Bcc and
      attached files stay; recipients, subject and the quote change. Not
      offered for a reopened draft (its quote is part of its saved text)
- [x] Inline replies and forwards: the rest of the polish, after the
      owner tried them (2026-10-17): `r` shows the whole reply; keys work
      after clicking into a message; deleting a draft reply takes it out
      at once; the newest real message opens, not the hidden draft; the
      Reply / Reply all / Forward switch sits by the recipients. Leaving a
      half-written reply keeps it as a draft (no complaint from the owner)

Stage 3: formatting, signatures, attachments

- [x] Full formatting toolbar (TipTap), as Gmail's: font (Gmail's 11),
      size (small/normal/large/huge), bold, italic, underline, text
      colour (the macOS colour picker), alignment, numbered and bulleted
      lists, quote, link, remove formatting. Links (owner's pick of three
      designs, 2026-10-16): ⌘K or the button opens a popup under the text,
      as in Google Docs; Return applies, Esc or a click elsewhere cancels.
      With the cursor in a link, the popup shows its address with Edit,
      Open and Remove. Sent as HTML with a plain-text
      copy; spacing in the email matches the editor
- [x] Reply and forward with quoted HTML (folded behind "…"). The
      original is quoted with its own formatting (tables, bold, lists,
      links, colours and fonts: style blocks and inline styles are kept;
      scripts, forms and event handlers are removed in Rust), in
      Gmail's quote style. It stays out of the editor, as in Gmail: a
      "•••" under your text shows it as it will be sent, in a sandboxed
      frame (forwards start open), read-only,
      and it's added when sending. Replies start with one blank line
      above it *(owner request, 2026-10-16)*; Gmail collapses that gap
      visually, which can be looked at later
- [x] Signatures: use each address's Gmail signature when composing
      (read with the current `gmail.modify` scope) *(owner request,
      2026-10-16)*. Managing them is in Milestone 6. New mail and replies
      open with the From address's signature (above the quote, after a
      blank line); changing From swaps it until you've typed something.
      Images in signatures hosted on the web (as Gmail's are) show and
      are sent; images embedded in the email itself need attachments
- [x] Sending attachments *(receiving moved to M3)*: the paperclip next
      to Send opens the system file picker (several files at once; no new
      plugin or permission); files show as chips with their size and ✕.
      Up to Gmail's 25 MB, checked before sending and again in Rust. Mail
      now goes through Gmail's upload endpoint (up to 35 MB per message).
      Not yet: dragging files onto the composer, and forwarding the
      original's attachments

Stage 4: drafts and undo send

- [x] Drafts synced back to Gmail as you type: saved about 2.5s after
      you stop typing ("Saving…" / "Saved to Drafts" beside Send), created
      once then replaced, and moved if From changes account. ✕ closes and
      keeps the draft; Discard deletes it from Gmail too; sending deletes
      it once the mail has gone. Quitting during Undo send no longer
      loses the message. Drafts show as "Draft" in their conversation,
      and replies skip them
- [x] Drafts open as Gmail opens them *(owner feedback, 2026-10-16: the
      first try previewed a draft with Edit/Discard buttons)*: clicking a
      conversation that's only a draft (a new message) opens it straight
      in the compose card; opening a conversation with a draft reply
      shows the real messages, with the draft already open as the reply
      at the foot. Works for drafts made in Gmail elsewhere too. Discard
      is the composer's own trash button (deleted from Gmail, and gone
      from the list at once). ✕ closes at once and saves in the
      background; if that fails, the card comes back with the error.
      Closing a reopened draft leaves it in Drafts (only Discard deletes;
      owner report, 2026-10-16), and a saved draft shows in Drafts at
      once instead of after the next sync. A reopened draft keeps its
      attachments (see the leftovers below)
- [x] Undo send (5 seconds): Send closes the message at once and
      "Sending…" offers Undo (or `z` / ⌘Z) for 5 seconds before anything
      goes to Google; Undo puts it back exactly as it was. If sending then
      fails, the message reopens with the error. Quitting within those 5
      seconds leaves the message in Drafts (saved as you typed)

Stage 5: Google Contacts

- [x] Suggestions from Google Contacts (saved and "other" contacts) as
      well as from mail. Saved contacts rank right after people you've
      written to, and their names win over header names. Needs the owner
      to turn on the People API in the Cloud project and each account to
      sign in again (the + in the sidebar, same account); until then that
      account suggests from mail only (noted in the sync log)

Found while testing stage 3 (owner, 2026-10-16):

- [x] Signatures don't look as in Gmail *(owner report with screenshots,
      2026-10-16)*: extra blank lines before the image, and colours and
      fonts lost in sent mail. The editor (TipTap) was rewriting Gmail's
      signature HTML. The signature now stays out of the editor, like the
      quote: shown read-only under the text, and sent as Gmail's own HTML
      in Gmail's `gmail_signature` wrapper. Switching From swaps it even
      after typing. Its preview first sat on a white box (owner:
      unconventional); it now goes through the reader's sanitizer and
      sits on the glass with colours adjusted for dark mode
- [x] Reader: a CI service's pipeline email rendered squeezed ("Failed"
      one letter per line, icons missing) while Gmail showed it correctly.
      The reader's page style used `overflow-wrap:anywhere`, which lets a
      narrow (1%) table cell shrink to one letter; it's now `break-word`,
      as mail apps use. Small fixed-size images (64px or less) are also
      exempt from `max-width:100%`, which shrank the cell's icons to
      nothing
- [x] Sending attachments (rest of stage 3)

Left over from Milestone 4 *(listed 2026-10-16 so they don't get lost;
each was a "not yet" note above)*:

- [x] Drag files onto the composer to attach them ("Drop to attach"
      shows while dragging over a message being written; files dropped
      elsewhere do nothing)
- [x] Forwarding includes the original's attachments, as Gmail does:
      they show as chips (✕ leaves one out), are fetched through the
      attachment cache with the original's account, and go with the
      forward and its saved draft; Gmail's 25 MB limit counts them
- [x] Reopening a draft brings back its saved attachments: downloaded
      when the draft opens and kept as ordinary attachments (the draft's
      own message, and its parts, are replaced on the next save)
- [x] Images embedded in an email itself (`cid:`), in quotes and
      forwards: the quote keeps its `cid:` links and the original's
      embedded images go along as inline parts with the same Content-IDs,
      so recipients see them. Still shown as placeholders in the "•••"
      preview while writing; signatures with embedded (not web-hosted)
      images aren't handled (Gmail stores signature images on the web)
- [x] Gmail visually collapses the blank line between a reply and its
      quote: Mailboat's gap is now one line, as Gmail sends, and a shorter
      signature no longer leaves the old one's height behind (owner
      reviewed, 2026-10-17)

## Milestone 5: Polish

*Open at the end of the 2026-10-17 session, in the order agreed: the
Settings page and its app icon chooser, then meeting invitations: all
built (2026-10-17), including the emailed-reply fallback, and the
owner has seen invitations and the Dock icon working.*

- [x] Answer meeting invitations in the reader *(owner request,
      2026-10-16; first in this milestone)*: a card with the event (time,
      place, organizer, your current answer) and Yes / No / Maybe, instead
      of the email's own buttons, which open the browser.
      **Decided (owner, 2026-10-17): through Google Calendar's API**, as
      Gmail does, and use what it offers, starting with conflicts:
      - New scope `calendar.events` (read and answer events on your
        calendars). Each account signs in again once, and the Calendar API
        is turned on in the owner's Cloud project (README to say how)
      - The card shows the event, your current answer, and whether it
        clashes with other events on your calendar at that time
      - Yes / No / Maybe updates the event on your calendar; Google then
        tells the organizer
      - An invitation not on your calendar yet (some from outside Google)
        is added first, then answered; if that fails, fall back to an
        emailed reply (the standard calendar reply, as Apple Mail sends)
      - Updates and cancellations show as such; a cancelled event offers
        "Remove from calendar"
      - Groundwork done (2026-10-17, needs no new permission):
        `mail::invite` reads an email's calendar part (title, time with
        its time zone resolved, place, organizer, your current answer,
        update/cancel, and the event's id the Calendar API looks it up
        by), and `gmail::parse::extract_calendar` finds that part. Still
        to do, with the owner: the new permission and Calendar API setup,
        storing the part when a message is fetched, the card and answering
      - Permissions (2026-10-17): Mailboat now asks for `calendar.events` and
        `gmail.settings.basic` (Milestone 6) together. Each account records
        the permissions Google says its sign-in carries (on sign-in and
        every token refresh); Settings → Accounts says when an account
        should sign in again, and for what
      - **Built; the owner tried it against real Google and it works
        (2026-10-17):** the
        card at the top of an opened invitation: what it is (invitation,
        updated, cancelled, or "Sam accepted your invitation"), title,
        when (in your time zone), place, organizer, clashes on your
        calendar, Yes / Maybe / No with your current answer, "Open in
        Calendar", and "Remove from calendar" for a cancelled event still
        on it. Not on your calendar yet: answering adds it first. An
        account without the permission gets "Sign in again" on the card.
        The Calendar API is turned on in the owner's project. The
        emailed-reply fallback is its own item below
- [x] Invitations Calendar can't add (e.g. a time zone Google doesn't
      know): answer by email instead, with the standard calendar reply
      (as Apple Mail sends). Split out of the invitations item when that
      was done (2026-10-17). Built: when Calendar refuses to add
      the event, Yes / Maybe / No sends the organizer a calendar reply
      email (`METHOD:REPLY`, from the invited address and its name),
      which Google Calendar and Outlook read; the card says it went by
      email. Not tried against a real refusal (rare; tested against a
      stand-in Google)
- [x] Report spam (and "Not spam" in the Spam view) as an action, routed
      per account like the others *(owner request, 2026-10-16)*. Toolbar
      button and `!` (Gmail's key); Report spam moves conversations out
      of the Inbox into Spam, Not spam back to the Inbox; both with Undo
- [x] Right-click menus on conversations (archive, trash, read, star,
      labels, spam, …) and other places where macOS apps have them
      *(owner request, 2026-10-16)*. Conversations: Reply, Reply all,
      Forward (one conversation), then Archive / Move to Trash / Mark as
      read / Star / Report spam (each worded for what it would do now)
      and Labels…. A right-click never opens or previews anything *(owner,
      2026-10-17)*: the menu acts on the clicked conversation (outlined
      while the menu is open), or on all picks if it's one of them; only
      Reply and Forward open it, since that's where you write. Also on sidebar labels (Rename, Delete) and
      account headers (already there). More places as they come up
- [x] Swipe on a conversation (trackpad, two fingers) *(owner request,
      2026-10-16; owner approved 2026-10-17)*. Decided (owner, 2026-10-17):
      - Left archives (Trash where Archive doesn't apply, e.g. in
        Archive or Sent); right toggles read/unread
      - A long swipe commits on release; a short one stops with the
        button(s) showing, to click
      - **Not** Mail's or Mimestream's coloured strips (garish, worse on
        glass). Closer to iOS 26/27 notification swipes, in Mailboat's own
        style rather than Liquid Glass: the row stretches rather than
        slides, the button grows out of it joined to the row with its
        label fading in, then breaks away as a separate button. Committing
        needs only a little further, with an indicator, not a full-width
        swipe
      - Built to try by feel (2026-10-17), then tuned after the owner's
        first go (it outran the fingers, the button was a smaller pill,
        it never visibly separated, it started too easily): a small dead
        zone first, then the row follows the fingers one to one; the
        space it leaves fills with the button, same height and corners as
        the row, so it looks like the row growing; at 84px the button
        stops growing and as the row goes on the join necks and snaps
        (apart at 10px; 18px looked too far); 44px further a ring round
        the icon has filled and the button takes an accent wash: armed.
        One button per side; no trackpad "tick" yet. Swiping back past
        closed keeps moving the row the other way, but that side's button
        only shows on a new swipe, as in Mail and Mimestream
      - Round three (owner): only letting go acts (macOS now reports the
        lift; holding still or swiping back never acts); the button has a
        fixed width (104px, more padding) and is uncovered by the row,
        drawn as one shape with it until its inner corners would show,
        then splits off with a small elastic snap; arming takes 72px past
        separation (was 44)
      - Putting a row back is eager (owner): a 16px push back on an open
        row closes it on release (was about 66px), and it goes home on a
        quicker, barely bouncing spring
      - The open button has a hover (a touch more fill, icon and word to
        full). The ring stays empty while the button settles open and for
        20px past it, so a swipe that only reveals it shows no progress
      - *Fixed (owner report, 2026-10-19):* a full swipe flashed the row
        back in its place for a moment before it left the list (the list
        drops it a beat after the slide-out ended). The row now stays
        hidden until the list has dropped it, glides back if it stays in
        the view (e.g. archived from All Mail), and the rows below glide up
        into the gap instead of jumping (also when archiving with `e`)
      - *Fixed (owner report, 2026-10-19):* a quick full swipe could
        archive the next row too, untouched. After the fingers lift macOS
        keeps sending coasting scroll events; a pause in them started a
        new swipe on the row that had moved under the pointer. On a
        trackpad a new swipe now only begins while fingers are on it
- [x] Create, rename and delete labels (the label picker only applies
      existing ones) *(not in the M3 list; noted while building it)*.
      Typing a new name in the picker (`l`) offers "Create “name”", which
      creates it in the conversations' account and applies it. Right-click
      a sidebar label for Rename… (labels nested under it follow, as in
      Gmail) and Delete… (asks first; its conversations stay)
- [x] Command palette (cmdk): ⌘K (outside the editor, where ⌘K adds a
      link). Type to find: the open or picked conversations' actions
      (Reply, Archive, Report spam, Labels…), New message, Search, Sync
      now, the panels, and every view to go to (unified and per account,
      labels included). Each shows its key. Fixed (2026-10-18, owner
      report): holding ↓ jumped the pick back up whenever the list
      scrolled, because WebKit's still-cursor pointer events made cmdk
      pick the row under the idle mouse; only real pointer moves count
- [x] Full keyboard shortcuts: Gmail's "go to" keys (`g` then `i`
      Inbox, `s` Starred, `t` Sent, `d` Drafts, `a` All Mail, `e`
      Archive; they keep the accounts being viewed), and `?` for a sheet
      of every shortcut (also in the ⌘K palette). The rest were already
      there: j/k, e, #, u, s, !, l, x, z, c, r, a, f, /, ⌘K, ⌃⌘S, ⌃⌘R
- [x] Remote Gmail search (`q=`) fanned out per account, merged by date.
      Search shows local matches at once; once the text has stayed the
      same for 0.7s and you reach the end of the local results, each
      account asks Gmail's own search ("Searching Gmail…"), fetches the
      matches it doesn't have, and every Gmail match joins the results
      (even ones matched on a body Mailboat hasn't downloaded). Gmail's
      operators (`from:`, `has:attachment`, …) work there
- [x] Notifications: new unread mail arriving in any account's Inbox
      (not your own, not drafts, not during a first full sync or when
      loading older mail) shows a macOS notification with the sender and
      subject, and the account's address when there are several. More
      than three at once become one "N new messages". macOS asks once for
      permission; turn them off or change their style in System Settings
      → Notifications → Mailboat. Not yet: clicking one opening that
      conversation (it brings Mailboat forward)
- [x] Settings: choose the app icon from `design/icon/choices/` (the
      folded M in 16 colours, or the earlier glass icon). In Appearance,
      after Theme: a grid of the choices (System blue, the built-in one,
      is the default). Owner checked the Dock change (2026-10-17), then
      asked to drop the earlier glass icon (the odd one out) and sort the
      rest by hue, red first, white and silver last. The choice shows in the Dock while Mailboat runs;
      Finder and the Dock after quitting keep the built-in icon, because
      changing the app's own files would break its code signature (and
      with it the keychain's "Always Allow"). The flat pictures have no
      glass rim; only the built-in icon gets macOS's. *Not yet seen
      working in the Dock (2026-10-17): the picker was checked, the Dock
      change wasn't; owner to try it.* Since tried by the owner: works.
- [x] Settings screen *(owner request, 2026-10-16)*. Decided (owner,
      2026-10-17):
      - **A page in the main window** (as MonoCode): the sidebar becomes
        the list of sections with Back at its foot; Esc or Back returns to
        the mail as it was. Each section is a column of grouped rows (a
        title, a line saying what it does, the control on the right),
        MonoCode's layout, which suits Mailboat's look better than Mail's
        label-colon forms
      - **Opens with** ⌘, and Mailboat → Settings… in the menu bar, and a
        gear in the sidebar's foot bar, on the right (the "+" stays left)
      - **Plan for most of Mail's and Mimestream's options in the long
        run, in a conventional order.** Sections, in order, with what
        each will hold (✱ = has something to put there now):
        1. General ✱: default email reader, text size, delete key
           (trash or archive), sounds, unread count on the Dock icon,
           which searches include Trash and Spam, About and version
        2. Accounts ✱: each account's colour, name, sign in again, remove;
           its aliases and signatures shown (edited in Gmail until
           Milestone 6)
        3. Notifications ✱: on/off, which mail (Inbox only, all, VIP),
           sound
        4. Appearance ✱: transparency per area (sidebar and reader, list),
           app icon (`design/icon/choices/`), light/dark/system, accent
        5. Sidebar & List: list density, preview lines, which views show,
           swipe actions (what left and right do)
        6. Viewing: remote images (the policy in `mail/images`, allowed
           and blocked senders), mark as read (on open, after a delay,
           never), conversation order
        7. Composing: default From, reply quoting, undo send delay,
           default font and size
        8. Signatures and Templates (Milestone 6 and later)
        9. Rules / Filters (Milestone 6)
        10. Keyboard ✱: the shortcuts (`?` sheet), later rebinding
        11. Toybox (added 2026-10-19): the empty-list glow and screensavers
        12. Advanced: sync log, cache size and clearing, reset; later the
            MCP server and AI keys (see Later)
      - First build: the page itself, openers, and the ✱ sections with
        what exists today; the others appear as their features arrive
      - **Built (2026-10-17):** the page, its three openers (⌘, from the
        menu bar, the gear, and "Settings" in ⌘K), Esc/Back back to the mail
        as it was. General: About and version. Accounts: colour (from the
        eight account colours), sync status and Sync now, Sign in again,
        Remove…, Add account, and each account's "Send mail as" addresses
        with which has a signature ("Open in Gmail" to change them).
        Notifications: an on/off switch for new-mail notifications, and a
        button to macOS's settings for style and sound. Appearance: two
        transparency sliders (sidebar and reader, list) with Restore
        defaults; they show how see-through each area is, in percent,
        and right is clearer (owner found "+5"/"−5" confusing). Then (owner
        request) first in Appearance: Theme (System, the default, Light,
        Dark) and an accent colour (seven, as macOS offers, minus yellow),
        with Restore defaults now for the whole page. Keyboard: every shortcut. Still to come in the ✱
        sections, with their features: default email reader, text size,
        delete key, sounds, Dock unread count, search scope (General);
        renaming an account; which mail notifies, VIP (Notifications);
        nothing more yet (Appearance); rebinding keys (Keyboard)
- [x] Remember the window between launches: position, size, and
      maximized/full-screen state *(owner request, 2026-10-16)*. Works with
      several monitors: reopens on the display it was last on, and if that
      display is gone (unplugged, or the arrangement changed) or the saved
      spot would be off-screen, it moves fully onto a connected display
      instead of opening out of sight. Likely Tauri's `window-state`
      plugin, which would need a reason recorded for the new plugin. Built with `tauri-plugin-window-state`
      (position, size, maximized, full screen; Rust side only) plus
      `src-tauri/src/window_place.rs`, which moves a window that's partly
      off screen fully onto the display it's mostly on (shrinking it if
      that display is smaller); the plugin alone accepts partly visible
- Offline mode: moved to Later, lowest priority *(owner, 2026-10-17)*

## Milestone 6: Rules and signatures

**Closed (owner, 2026-10-19).** What was left moved to Later /
unscheduled ("From Milestone 6").

**Goal (owner, 2026-10-17): stop needing Gmail on the web.** Wanted soon
rather than later.

These need Gmail's settings permission (`gmail.settings.basic`). Mailboat
asks for it since 2026-10-17, together with `calendar.events` (meeting
invitations, Milestone 5), so each account signs in again only once for
both; Settings → Accounts says when an account still lacks it. The
editors live in Settings (Signatures, Rules), which now exists.

*Order (owner, 2026-10-18): rules first (used most), then signatures.*

- [x] Rules (Gmail filters): list, create, edit, delete *(owner request,
      2026-10-16)*. **Built (2026-10-18):** Settings → Rules (between
      Appearance and Keyboard) lists each account's rules as a sentence
      ("From news@x.com" / "Skip the Inbox, label “News”"), with a search,
      New rule, Edit and Delete. One editor, laid out like Gmail's filter
      form: From, To, Subject, Has the words, Doesn't have, Size, Has an
      attachment; then Skip the Inbox, Mark as read, Star, Never send to
      Spam, Delete, labels (with "Create" as in the label picker),
      Importance and Category. While you type it says how many
      conversations match now, and "Also apply to the N matching
      conversations already here" does what Gmail's checkbox does (newest
      10,000 messages). ⌘↩ saves. Forwarding can't be set (needs the
      `gmail.settings.sharing` permission); forwarding set up in Gmail is
      shown and kept. An account without the permission shows "Sign in
      again" in its group. Not yet tried by the owner against real Gmail.
      *Owner feedback (2026-10-19):* the list ran far off the page, so each
      account's rules now show 10 at a time with "11–20 of N" and
      Previous / Next (a new search starts at the first page; an account
      picker may follow later); and quoted phrases Gmail stores (`"weekly
      report"`) showed doubled quotes, now shown once
- [x] Create a rule from a message, as Gmail's "Filter messages like
      these": sender, subject and so on filled in from it. **Built
      (2026-10-18):** "Filter messages like this…" in the toolbar's More
      menu (its first item; the button did nothing before), the
      conversation's right-click menu, and ⌘K. It opens the rule editor
      for the conversation's account with From filled in, as Gmail does:
      who started the conversation (not you), or several senders joined
      with OR when several conversations are picked. Conversations from
      different accounts can't share a rule, so the item is greyed out
- [x] Manage signatures per address (using them is in Milestone 4).
      **Built (2026-10-18):** Settings → Signatures lists every "Send mail
      as" address per account with its signature shown as compose shows
      it, and Add / Edit opens the composer's editor (fonts, colours,
      links, web images) with Save, Cancel and Remove signature; ⌘↩
      saves. Gmail keeps its own cleaned-up copy, which Mailboat stores, so
      compose uses the new one at once (Gmail too). Signatures laid out
      with a table (from signature generators) get a warning that saving
      here will simplify them. Settings → Accounts now points here. Not
      yet tried by the owner against real Gmail
- Several signatures to choose from *(owner feedback, 2026-10-19;
      decided 2026-10-19: left as is, one signature per address as Gmail's
      API offers; not planned)*.
      Gmail's API only has one signature per address (the one Mailboat
      edits now); Gmail on the web's named signatures and its "for new
      mail / for replies" defaults aren't in the API. So Mailboat would keep
      its own named signatures on this Mac, with defaults per address and
      a picker in compose, copying the "new mail" default to Gmail so
      other apps use it. Gmail's own named signatures can't be imported.
      Waiting on the owner's go-ahead
- [x] Vacation responder (same permission). **Built (2026-10-18):**
      Settings → Vacation responder, per account, as Gmail's form: on/off,
      first day, optional last day, subject, message (the composer's
      editor), only my contacts, and only my organization (Workspace
      accounts only; @gmail.com has none). Save and Discard changes. While
      a responder is replying, a banner above the conversation list says
      so ("Vacation responder is on until the end of Fri, Oct 24") with
      Turn off and Settings, so it's never left on by mistake. Not yet
      tried by the owner against real Gmail
- [x] Reply, Forward and Send stay on screen *(owner request, 2026-10-19,
      before trying the Milestone 6 items; as Gmail does)*: replying to
      or forwarding a long email, and sending a forward, needed scrolling
      to the end. The reader's foot (Reply / Reply all / Forward, or an
      inline reply's formatting bar and Send) now stays pinned to the
      bottom of the window while the email scrolls under it, with a
      blurred tint while it covers the email. In a short window (reader
      under 24rem, about 384px) it scrolls with the email instead, so the
      message isn't hidden. The line being typed stays above the pinned
      bar. The owner tried it (2026-10-19): works; the Reply / Forward bar
      was too tall with its buttons above centre, so its padding is now
      even (10px above and below) and the reply's Send bar evened out too
- [x] A second copy of Mailboat running (installed app plus a dev build)
      refreshes when the other one syncs new mail *(owner request,
      2026-10-19)*: both share one database, and each checks every 2
      seconds whether the other wrote to it, then refreshes its lists.
      Both copies still sync with Gmail on their own
- [x] Block sender *(from the list below; 2026-10-18)*: "Block
      sender@x.com…" in the toolbar's More menu, the right-click menu and
      ⌘K, offered when the picked conversations have one sender other
      than you. After a confirmation it makes the rule "From them →
      Delete it" and applies it to their mail already here, so it all
      goes to the Trash. Undo by deleting the rule in Settings → Rules.
      Gmail's own Blocked addresses list (which sends to Spam) has no
      API, so this is the filter Gmail's form would make. Not yet tried
      by the owner against real Gmail
- [x] What else still sends the owner to Gmail on the web: settled
      (owner, 2026-10-19). The owner uses none of what was left, so it
      moved to Later / unscheduled ("From Milestone 6") rather than being
      built: Snooze, Schedule send, "Send mail as" aliases and forwarding,
      inbox category tabs. Blocked senders was built (Block sender above)

## Milestone 7: Settings everyday

*Agreed with the owner (2026-10-19) after comparing Mimestream's and
Mail.app's settings with Mailboat's (client-only, IMAP and junk-mail
settings left out). The other gaps went to Later ("From the settings
comparison"), or to "Considered, not planned" there.*

- [x] Default email reader: Mailboat registers for `mailto:` links, opens a
      new message filled in from one (to, cc, bcc, subject, body), and
      Settings → General shows whether it's the default with "Make Mailboat
      the default" (macOS asks once). A dev build and the installed app
      both register; macOS opens whichever is the default
      *Built (2026-10-19), waiting for the owner to try it: Settings →
      General → Email links. A `mailto:` link clicked inside an email now
      opens a new message here too, instead of in the system's mail app.
      Windows comes with the Windows work*
      *First try (owner, 2026-10-19): links did nothing. macOS keeps the
      default by app ID, which the dev build and installed app share, and
      sent links to the installed copy, built before this. "Use this
      copy" is gone; Settings now says which copy gets links. Owner
      confirmed (2026-10-19) a link handed to the dev build opens a filled-in
      message; plain links reach the installed copy once it's rebuilt*
- [x] Unread count on the Dock icon (unread Inbox conversations, every
      account), with a setting for Inbox only / all unread / off
      *Built (2026-10-19), waiting for the owner to try it: Settings →
      Notifications → Dock badge (Inbox, the default; All unread; Off;
      now "Unread count" in its own "Dock" group there).
      Counts match the sidebar's (Spam and Trash left out). Choices
      renamed after the folders they match (owner, 2026-10-19): All
      Inboxes, Unread, Off. Owner confirmed it works (2026-10-19)*
- [x] What opens after archiving or deleting the open conversation: the
      next one down, the one above, or none (check what happens today
      first)
      *Built (2026-10-19), waiting for the owner to try it. Today it was
      the next one below, else the nearest above, else nothing; that stays
      the default. Settings → Viewing (a new section, where the settings
      plan put reading choices) → After archiving or deleting: Next
      below, Next above (else below), Nothing. Applies to anything that
      takes the open conversation out of the list (archive, Trash, Spam,
      a label change), from any key, button, menu or swipe. Owner
      confirmed it works (2026-10-19)*
- [x] Reply quotes the selected text: with text selected in a message,
      `r` / `a` / `f` quote just that; otherwise the whole message
      *Built (2026-10-19), waiting for the owner to try it. Any way of
      replying or forwarding (keys, toolbar, menus, ⌘K, the reply bar)
      answers the message the selection is in, quoting only that;
      switching to Reply all or Forward keeps it. The selection is quoted
      as plain text (line breaks kept): the email on screen carries
      Mailboat's own link addresses, which mustn't go out in mail. Quoting
      it with its formatting could come later. Owner confirmed it works
      (2026-10-19)*
- [x] Undo send delay: 5 (today), 10, 20 or 30 seconds, as Gmail offers
      *Built (2026-10-19), waiting for the owner to try it: Settings →
      Composing (a new section, where the settings plan put it) → Undo
      send. The "Sending…" notice now stays up for the whole wait, so its
      Undo (and z / ⌘Z) work to the end; it used to vanish after 6s.
      Another notice (archiving, say) still replaces it, as in Gmail.
      Owner confirmed it works (2026-10-19)*
- [ ] Text size for the reader and list
      *Built (2026-10-19), waiting for the owner to try it: Settings →
      Appearance → Text size (Small, Default, Large, Larger), in
      Appearance rather than General as the settings plan had it, since
      it's about how Mailboat looks. Scales the list's rows (which grow to
      fit), the reader's subject and message headers, and each email
      itself; Restore defaults resets it. Sidebar, toolbar and Settings
      keep their size*
- [ ] Mark as read: on open (today), after a few seconds, or never; and
      conversation order (oldest first, today, or newest first)
- [ ] Default From for new mail (today: the account being viewed) and
      the composer's starting font
- [ ] Menus trued up *(owner request, 2026-10-19)*: the macOS menu bar
      is still Tauri's default plus "Settings…", so mail actions live only
      in the toolbar, the right-click menu and ⌘K. Give the menu bar the
      app's actions with their shortcuts (New Message; Reply, Reply all,
      Forward; Archive, Trash, Spam, Read/Unread, Star, Labels…; Make a
      rule / Block sender; Sync now; show/hide sidebar and reader; go to
      views), and make the toolbar, right-click menu, ⌘K and menu bar
      offer the same actions under the same names, ideally from one list
      so they can't drift apart again
- [ ] Remember between launches whether the sidebar and the reader are
      hidden, and which sidebar folds are open *(moved from UX Spike 1's
      deferred ideas, owner, 2026-10-19)*. Today both panels start shown
      every launch; pane widths and the window are already remembered
- [x] Settings wording trued up *(owner request, 2026-10-19)*: section
      subtitles said what the sections held before Milestone 7 (General's
      was "About Mailboat."). General, Notifications and Viewing now
      describe what's there; the Dock badge has its own "Dock" group
      instead of sitting under "New mail"; Toybox no longer says
      "Remembered on this Mac", which only it said though most settings are
      kept that way
- [ ] The screensaver sometimes didn't start *(owner report,
      2026-10-19)*. Likely cause, fixed: when the idle minute ran out
      while the window was hidden it waited another minute instead of
      starting, and macOS counts a window that another app covers
      completely as hidden. It now starts anyway (the canvas pauses while
      hidden). To tick once the owner hasn't seen it again; if they do,
      diagnose further

## UX Spike 2

*Polish, gathered here at the owner's request (2026-10-17): the
email-display and remote-image follow-ups left open in UX Spike 1, and the
look-and-feel items from Later. As with Spike 1, built to try in the app
and settled with the owner one at a time.*

**Done (owner, 2026-10-18):** the owner called the spike complete with
the app as it stands. The email-colour and remote-image items it carried
weren't built and moved to Later / unscheduled ("From UX Spike 2").

- [x] Icon, round three *(owner request, 2026-10-17)*: the folded-ribbon
      M now folds like an envelope. The V folds over the front of the
      sides and meets them edge to edge at the top corners (the fold and
      its shadow sit left and right, nothing folds in the middle), the
      sides a shade darker. Owner picked N7 after four sheets in
      `design/icon/sheets/` (8 to 11); every colour in Settings → App
      icon, the built-in icon and the Liquid Glass layer use it
- [x] Idle screensavers for the empty list *(owner request,
      2026-10-17; discuss first, then pick one to try and iterate)*: an
      alternative to the pointer-following glow. Interactive pixel art
      that starts after about a minute without input and stops on any
      key or pointer move. It might play with the empty state's icon and
      text, or the pointer. Owner's starting ideas, not commitments:
      falling sand (like the old desk sand-art frames), a fish aquarium,
      fireworks. To settle: which one first, the idle delay, whether it
      replaces the glow or comes on after it, and keeping it light on
      battery (pause when the window is hidden or unfocused)
      *First try (2026-10-17): falling sand poured from a spout, draining
      like an hourglass. Fixed after the owner found it never started (any
      pointer event, even WebKit's still-cursor ones, cancelled the start
      and reset the idle wait). Second try, after the owner pointed to
      sandscapes (the sand-and-liquid frames you turn over): a layered
      ceiling leaks through three wandering gaps in
      slow curtains that lay down fine dark and light layers in steep
      hills, heaping on the icon box, the letters of the words and the
      pointer (moving it digs and stirs). The icon nods and shrugs its
      heap off. Once the ceiling is spent it rests 12s, the frame turns
      over (the canvas rotates 180°), and the landscape is the next
      ceiling. The sand is as see-through as the list card's glass and
      follows the Transparency setting. Starts after 60s without input,
      even with another app in front (owner's request), or at once from
      the palette's "Start screensaver"; a key, click or scroll ends it.
      Off with "Reduce motion"; paused only when the window is hidden*
      *Six more (owner's pick of the ideas offered, 2026-10-18), all pixel
      art and playing with the icon, words or pointer: an envelope flock
      (perches on the icon and words, scatters from the pointer, the odd
      one glides off as a paper plane), Life (the words dissolve into
      Conway's Game of Life and return), rain on the glass (drops slide in
      fits, pool on the icon, the pointer wipes a streak), a koi pond
      (koi nibble the letters, ripples from the pointer), fireflies (blink
      into step, gather into the M), and a lava lamp (wax flows around the
      icon and words). Settings → Advanced → Screensaver picks one or
      Random (a different one each time), plus colours: six palettes,
      "Mono + accent" (greys plus the Appearance accent) by default, then
      Accent, Ocean (the original sand colours), Desert, Dusk, Forest. ⌘K
      can start any of them by name. The owner kept them as they are
      (2026-10-18), behind the Screensavers feature flag*

- [x] Feature flags *(owner request, 2026-10-18)*: Settings → Advanced
      (the roadmap's last section, started early) has switches for
      features still being tried: the empty-list glow and the
      screensavers (first just the sandscape), both on by default.
      Window-only, kept in the web view's storage like Appearance. Whether
      they stay flags is to rethink later (owner, 2026-10-18). The glow now fades out while the
      screensaver plays. *Moved (owner, 2026-10-19):* the two switches and the screensaver
      picker now live in their own Settings → Toybox section (Pac-Man
      icon, last in the list) instead of "Feature flags" under Advanced;
      Advanced comes back when it has its planned contents. Choices made
      before are kept. Its group is headed "Inbox Zero" (owner's pick, 2026-10-19, over
      "Empty list", which read like a missing word), with the rows "Glow"
      and "Screensavers"; it applies to any view with no mail

## UX Spike 3: Reading

*Milestones 8 onward and UX Spike 3 were laid out with the owner
(2026-10-19) from what was in Later. Releasing to other people is the
Release Spike, last: the owner may never distribute Mailboat.*

*How email looks and how private opening it is. Built to try by feel and
settled with the owner one at a time, as in the earlier spikes.*

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
- [ ] Load by default only for people you've written to (option B of UX
      Spike 1's remote-image choice, not built)
- [ ] Background image prefetch during sync, like Apple Mail, so senders
      can't tell when you opened (option C of the same choice, not built)
- [ ] With the screensaver set to Random, switch to another screensaver
      every hour while it keeps playing *(owner request, 2026-10-19)*;
      today Random picks one each time it starts

## Milestone 8: Triage and notifications

*Getting through mail faster, plus the tools for when something goes
wrong (Advanced and Show original, moved here from the Release Spike
idea because they're useful without distributing).*

- [ ] Choose what each swipe does, plus a second swipe each way
- [ ] Delete key: Trash or Archive (in the Settings plan)
- [ ] List density and preview lines (also a UX Spike 1 deferred idea)
- [ ] Include Trash and Spam in search (in the Settings plan)
- [ ] Which mail notifies (Inbox only / all; already in the Settings
      plan) and quiet hours
- [ ] Sounds for new mail and for actions, if wanted
- [ ] Duplicate a rule
- [ ] Advanced section: clear the cache, reset, the sync log (in the
      Settings plan)
- [ ] Show original (the raw message and its headers)

## Milestone 9: Writing

- [ ] Templates: saved replies to insert while writing (Gmail's own
      templates aren't in its API, so these would be Mailboat's)
- [ ] Warn about outside recipients (addresses not ending with chosen
      domains are marked while writing)
- [ ] Remove an address from compose suggestions

## AI Spike

*The AI work, gathered from Later at the owner's request (2026-10-17).
Sending an email to a model is always an explicit choice (`CLAUDE.md`).*

- [ ] AI-drafted replies with user-supplied OpenAI/Anthropic keys (see `CLAUDE.md`)
- [ ] MCP server, so AI apps (Claude Desktop, Claude Code) can work with
      Mailboat's mail *(owner request, 2026-10-16)*. Worth it because Mailboat
      already has every account's mail in one local, searchable cache
      and their sign-ins: one connection covers all accounts, with no
      extra Google setup. Design to agree before building:
      - **Off by default;** turned on in Settings, per account. Turning it
        on is the explicit choice `CLAUDE.md` requires before any email
        reaches a model
      - **Read-only first:** search (local, all accounts), list a view,
        read a conversation, list labels. Then, each opt-in: label,
        archive, create drafts. **Never send:** drafts only, the owner
        sends from Mailboat
      - **How it connects:** the running app serves MCP on localhost
        (with an access token), or a small `mailboat-mcp` command that
        Claude starts and that talks to the app. Either way sync, quota
        and tokens stay in the app. Likely the official Rust MCP SDK
        (`rmcp`), recorded in ARCHITECTURE when chosen
      - Every request logged (what was read, never the content), so the
        owner can see what an AI looked at

## Milestone 10: Windows

- [ ] Windows build and testing; Linux nice-to-have
- [ ] Windows: scrollbars. The app uses the system's own (macOS overlay
      ones that hide when not scrolling); check they look right on
      Windows, and style them there only if needed

## Release Spike (last; only if Mailboat is distributed)

*Making Mailboat installable by other people. The owner is unsure whether
it will ever be distributed (2026-10-19), so this comes last.*

- [ ] Release signing and packaging, with automatic software updates
      (Mimestream has an update channel setting) *(updates added
      2026-10-19, settings comparison)*
- [ ] Onboarding *(owner request, 2026-10-17)*: a first-launch flow
      instead of today's single Welcome screen. At least: add one or
      more accounts (each shown as it signs in, with its first sync
      under way). Maybe also: choose the theme and the app icon, allow
      notifications. Steps after accounts can be skipped, and all of it
      is in Settings afterwards. To design with the owner before
      building. Today's Welcome screen also needs its Google setup steps
      brought up to date: it names only the Gmail API, but the README
      now lists the People and Google Calendar APIs too
- [ ] Replace hand-built Gmail fixtures with scrubbed real recordings

## Bug backlog

*Bugs found in passing and not yet fixed (started 2026-10-19 at the
owner's request). Each says how it was found and whether it has been
seen for real.*

- [ ] "Load older mail" can ask Gmail again and again for an empty view.
      `threads_load_older` (src-tauri/src/commands.rs) answers "not
      exhausted" when one account fails (no Gmail client, say) while
      another succeeds. The list then asks again at once, because an
      empty view is always "near the end", so the requests repeat for as
      long as that account keeps failing, and the empty view (and its
      screensaver wait) restarts each time. Found reading the code while
      looking into the screensaver (2026-10-19); the sync log shows no
      such loop so far. Likely fix: wait for "Retry" after a partial
      failure, as after a full one

## Later / unscheduled


- [ ] Offline mode *(moved from Milestone 5; owner, 2026-10-17: likes all
      three ideas, but lowest priority: almost never offline, and doesn't
      expect to send while offline)*. Today reading cached mail and local
      search work offline; actions and sending fail with an error (a send
      reopens, nothing is lost); sync catches up when back. Ideas, in the
      order they'd likely be built:
      - Actions (archive, star, label…) apply at once and go to Gmail when
        the connection returns, as Gmail's offline mode does
      - An Outbox: Send while offline queues the message and it goes once
        online
      - Download recent message bodies ahead (say 30 days) so any recent
        mail opens offline; costs disk space and Gmail quota

### From Milestone 6 (moved unbuilt when it closed, 2026-10-19; the owner uses none of these)

- [ ] Snooze. No Gmail API: Mailboat would do it itself (likely a "Snoozed"
      label plus a timer, acting only while Mailboat runs), so it would
      differ from Gmail's own. Design to agree first
- [ ] Schedule send. No Gmail API either: a draft Mailboat sends at the time,
      only while it's running. Design to agree first
- [ ] "Send mail as" aliases and forwarding. Need the more sensitive
      `gmail.settings.sharing` permission; for now they're set up in Gmail
      (Settings → Accounts has "Open in Gmail")
- [ ] Inbox category tabs (Promotions, Social…). Rules can already put
      mail in a category

### Considered, not planned (settings comparison, 2026-10-19)

Turning off conversation grouping (Gmail is conversations); fonts for the
list and messages, fixed-width plain text and coloured quote levels;
automatically Cc/Bcc myself; full addresses while writing and "smart
addresses"; link previews; extensions; split view in full screen; a
downloads folder choice and removing unedited downloads; large
attachments through Google Drive (needs a Drive permission); profiles
(the unified inbox and account filtering cover them; quiet hours is
listed above). Mail Privacy Protection's ideas are already in "From UX
Spike 2"; summaries and smart replies belong with the AI Spike.
