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

**Closed (owner, 2026-10-19).** Every item built and tried by the owner.
The screensaver item, waiting to see whether the fix holds, moved to
Bug Spike 1, which comes next.

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
- [x] Text size for the reader and list
      *Built (2026-10-19), waiting for the owner to try it: Settings →
      Appearance → Text size (Small, Default, Large, Larger), in
      Appearance rather than General as the settings plan had it, since
      it's about how Mailboat looks. Scales the list's rows (which grow to
      fit), the reader's subject and message headers, and each email
      itself; Restore defaults resets it. Sidebar, toolbar and Settings
      keep their size Owner confirmed it works (2026-10-19)*
- [x] Mark as read: on open (today), after a few seconds, or never; and
      conversation order (oldest first, today, or newest first)
      *Built (2026-10-19), waiting for the owner to try it: Settings →
      Viewing → Mark as read (On open, After 3 seconds, Never; with the
      delay, moving on sooner leaves it unread, so skimming with j/k
      doesn't mark everything read) and Message order (Oldest first,
      Newest first). With newest first the reply bar stays under the
      last card, the oldest message Owner confirmed it works (2026-10-19)*
- [x] Default From for new mail (today: the account being viewed) and
      the composer's starting font
      *Built (2026-10-19), waiting for the owner to try it: Settings →
      Composing → New mail. "Send from" is "The account you're viewing"
      (as before) or any address of any account; it applies to new mail
      and mailto: links, and replies still start from the address the
      conversation was sent to. "Font" picks one of Gmail's fonts and
      sizes; the editor shows it and sent mail carries it around what was
      written (signature and quote keep theirs), "Default" sending as
      before. An address that's gone (account removed) falls back to the
      viewed account Owner confirmed it works (2026-10-19)*
- [x] Menus trued up *(owner request, 2026-10-19)*: the macOS menu bar
      is still Tauri's default plus "Settings…", so mail actions live only
      in the toolbar, the right-click menu and ⌘K. Give the menu bar the
      app's actions with their shortcuts (New Message; Reply, Reply all,
      Forward; Archive, Trash, Spam, Read/Unread, Star, Labels…; Make a
      rule / Block sender; Sync now; show/hide sidebar and reader; go to
      views), and make the toolbar, right-click menu, ⌘K and menu bar
      offer the same actions under the same names, ideally from one list
      so they can't drift apart again
      *Built (2026-10-19), waiting for the owner to try it. One list
      (`features/commands`) names every action once, with its key; the
      menu bar, right-click menu, ⌘K, the toolbar's tooltips and More menu,
      and the `?` sheet all read it. The menu bar gains File → New message,
      View (sidebar, reader, command palette, keyboard shortcuts),
      Mailbox (Sync now, Search, Go to Inbox / Starred / Sent / Drafts /
      All Mail / Archive) and Message (Reply, Reply all, Forward, Archive,
      Move to Trash, Mark as read, Star, Report spam, Labels…, Filter
      messages like this…, Block sender…), names following what each will
      do. Mail's ⌘ shortcuts come with it (⌘N, ⌘R, ⇧⌘R, ⇧⌘F, ⌃⌘A, ⇧⌘U,
      ⇧⌘L, ⇧⌘J, ⇧⌘N); Gmail's single keys stay. Delete has no ⌘⌫ (in a
      text field that deletes the line), and the actions that change a
      conversation grey out while typing in a field. The right-click menu
      now shows each action's key. Not verified in the app by the agent:
      that ⌃⌘S, ⌃⌘R and ⌘K toggle once, not twice (the page and the menu
      both know them)*
      *Owner's first try (2026-10-19): works, but Go to Drafts had no
      shared Drafts to go to, and the menu said Inbox where the sidebar
      said All Inboxes. Now: a shared Drafts in "All accounts" (after
      Sent, as under each account); "All Inboxes" is "Inbox" everywhere
      (sidebar, list heading, ⌘K, the Dock badge choice), as the shared
      Starred and Sent were already named; `g then u` goes to Unread
      (Gmail has g+i/s/t/d/a, checked in Google's help, but no Unread;
      `g then e` for Archive was already Mailboat's own); and the Go to items
      are ⌘1 to ⌘7 in the sidebar's order, as Mail numbers its favourite
      mailboxes. Owner confirmed (2026-10-19)*
- [x] Remember between launches whether the sidebar and the reader are
      hidden, and which sidebar folds are open *(moved from UX Spike 1's
      deferred ideas, owner, 2026-10-19)*. Today both panels start shown
      every launch; pane widths and the window are already remembered
      *Built (2026-10-19), waiting for the owner to try it: whether the
      sidebar and reader are shown, and every sidebar fold (accounts,
      their More and Labels), now come back as they were, kept with the
      pane widths in the window's storage. Opening a conversation still
      brings a hidden reader back, as before; only the reader toggle
      itself is remembered. Owner confirmed it works (2026-10-19)*
- [x] Settings wording trued up *(owner request, 2026-10-19)*: section
      subtitles said what the sections held before Milestone 7 (General's
      was "About Mailboat."). General, Notifications and Viewing now
      describe what's there; the Dock badge has its own "Dock" group
      instead of sitting under "New mail"; Toybox no longer says
      "Remembered on this Mac", which only it said though most settings are
      kept that way

## Bug Spike 1

**Closed (owner, 2026-10-20).** Every item built and tried by the owner
(the older-mail fix, never seen for real, ticked on the owner's say-so).
The screensaver item, still waiting to see whether its fix holds, moved
to the Bug backlog to keep watching. UX Spike 3 is next.

*Added at the owner's request (2026-10-19): with these, Mailboat isn't
usable day to day yet. Next, straight after Milestone 7 (closed
2026-10-19), in its own session. The first five came from the Bug
backlog, most pressing first; "Load older mail" was found reading code
and hasn't been seen for real. The last two came from Milestone 7: a
fix waiting to be seen holding, and a check the agent couldn't make in
the app. As with the UX spikes, each is tried by the owner before it's
ticked.*

- [x] The list keeps its scroll position when switching views *(owner
      report, 2026-10-19)*. Scrolled down in Unread, then going to
      Archive (or any other view), the new list opens scrolled down too,
      by the same distance. Cause, from the code: every view's list is
      drawn in one scroll area (`ThreadList`), and nothing scrolls it
      back to the top when the view changes, so it keeps whatever offset
      it had. Fix: start each view at the top (or, if wanted, remember
      each view's own position)
      *Built (2026-10-19), waiting for the owner to try it: every view
      (and each new search) now opens at the top, as Gmail does. Views
      don't remember their own positions; say if that's wanted*
      *Owner tried it (2026-10-19): works, but would rather each view
      remembered its own position. Now each view comes back scrolled as
      far as it was left, until the app quits; a view not seen yet, or a
      new search, starts at the top. Its loaded pages stay cached for the
      session so the old position can be reached. Owner confirmed it
      works (2026-10-20)*

- [x] Reply all: the sender in To, everyone else in Cc *(owner request,
      2026-10-19)*. Today (`replyRecipients` in compose/model/draft.ts)
      To is the sender plus the original's To, and Cc the original's Cc,
      minus your own addresses, so when everyone was in To they all land
      in To again. Gmail on the web puts the sender alone in To and
      everyone else (the original's To and Cc, minus you) in Cc; the
      owner showed it with screenshots after an agent wrongly said Gmail
      worked like Mailboat does today. Fix: do what Gmail does, as the only
      behaviour (no setting needed). Replying to your own message keeps
      its To as To
      *Built (2026-10-19), waiting for the owner to try it: Reply all
      now puts the sender (or the Reply-To address) alone in To and
      everyone else from To and Cc in Cc, minus your own addresses.
      Replying to your own message keeps To as To and Cc as Cc. Owner
      confirmed it works (2026-10-20)*
- [x] Addresses can't be dragged between To, Cc and Bcc *(owner report,
      2026-10-19)*. In other mail apps an address can be dragged from one
      field to another (say from To down to Cc); in the composer nothing
      happens, so moving someone means deleting and retyping them. Needs
      the address chips in `AddressField` to be draggable and each field
      to accept a drop (moving the address, never copying it, and keeping
      its name)
      *Built (2026-10-19), waiting for the owner to try it: drag a chip
      onto another line (it follows the pointer, the line under it
      shades); it moves there with its name, and if that line already
      has it, it just leaves the first. Cc or Bcc must be showing to
      drop on it. Pointer-based rather than the web view's drag and
      drop, which Tauri's window file-drop handling can swallow. Owner
      confirmed it works (2026-10-20)*

- [x] "Download Image" in an email's right-click menu does nothing
      *(owner report, 2026-10-19)*. Right-clicking an image inside an
      email shows the web view's own menu (Mailboat doesn't make it; it may
      or may not be wanted there), and its "Download Image" saves nothing
      to Downloads. Saving an image is what the owner wanted to do. Likely
      cause, not yet checked: macOS's web view hands downloads to the app,
      and Mailboat (through Tauri) doesn't take them. To decide when fixing:
      make that item work (Tauri's download hook, saving to Downloads as
      attachments do), or replace the web view's menu over emails with
      Mailboat's own (Save image, Copy image, Copy link)
      *Owner chose Mailboat's own menu (2026-10-19). Built, waiting for the
      owner to try it: right-clicking an image or link in an email shows
      Save Image (to Downloads, with Show in Finder), Copy Image, Open
      Link and Copy Link; over text the system menu stays. macOS only;
      Windows comes with the Windows work. Owner confirmed it works
      (2026-10-19)*

- [x] "Load older mail" can ask Gmail again and again for an empty view.
      `threads_load_older` (src-tauri/src/commands.rs) answers "not
      exhausted" when one account fails (no Gmail client, say) while
      another succeeds. The list then asks again at once, because an
      empty view is always "near the end", so the requests repeat for as
      long as that account keeps failing, and the empty view (and its
      screensaver wait) restarts each time. Found reading the code while
      looking into the screensaver (2026-10-19); the sync log shows no
      such loop so far. Likely fix: wait for "Retry" after a partial
      failure, as after a full one
      *Fixed (2026-10-19): the command now says how many accounts
      failed, and after any failure the list shows "Couldn't load older
      mail. Try again" and waits, as after a full failure. Try again asks
      only the accounts with more to give. Never seen for real, so there's
      nothing for the owner to watch for; tick on the owner's say-so.
      Ticked on the owner's say-so (2026-10-20)*
- [x] Check that ⌃⌘S, ⌃⌘R and ⌘K act once, not twice *(from Milestone
      7, 2026-10-19)*. Since the menus were trued up, both the page and
      the menu bar know these keys. The page stops the key reaching the
      menu (it calls `preventDefault`, which WebKit is expected to honour,
      as web apps overriding ⌘B in Safari rely on); if it didn't, the
      sidebar or reader would hide and show again at once, or the palette
      open twice. Not checked in the app by the agent. If it does happen:
      drop those three accelerators from the menu bar, or the page's own
      handling of them
      *Owner checked (2026-10-20): each acts once*

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

**Closed (owner, 2026-10-20).** Every item built and approved by the
owner ("LGTM", 2026-10-20). Milestone 8 is next.

*Milestones 8 onward and UX Spike 3 were laid out with the owner
(2026-10-19) from what was in Later. Releasing to other people is the
Release Spike, last: the owner may never distribute Mailboat.*

*How email looks and how private opening it is. Built to try by feel and
settled with the owner one at a time, as in the earlier spikes.*

- [x] Emails on the glass, step 2: remap colors set in an email's own style
      sheet (needs a CSS parser), so more newsletters can adapt
      *Built (2026-10-20), waiting for the owner to try it: each style
      rule that sets a color is repeated for dark mode with the color
      remapped (`mail/stylesheet.rs`, parsed with `cssparser`), the same
      way inline colors are. Most cached HTML emails now sit on the glass; the rest keep the white card (light gradients, `var()` colors, "light
      only"). Also new: Outlook's `windowtext`, every CSS color name,
      `hsl()` and 8-digit hex are understood, in inline styles too.
      Checked by rendering several newsletters in dark mode outside the app;
      "Original colors" is the way out for any that look wrong*
- [x] Dark mode for emails that declare it (`color-scheme: light dark`, as
      a vendor's do): apply their own dark rules plus our remap of their
      inline colours, as Mail.app does, instead of the white card. Their
      dark rules alone aren't enough (a vendor's turn text white but never
      darken its inline white backgrounds). Fall back to the white card if
      their style sheet sets text colours outside its dark-mode block
      *Built (2026-10-20) with step 2, waiting for the owner to try it:
      these emails now sit on the glass with their own dark rules kept
      and our remap of their inline and style-sheet colors added. Where
      their dark rules set the same thing for the same selector, theirs
      win. Instead of falling back to the white card when their sheet
      sets text colors outside the dark block, those colors are remapped
      too (step 2 made that possible)*
- [x] "Original colors" toggle per message, for emails the remap gets wrong
      *Built (2026-10-20), waiting for the owner to try it: hovering an
      email that sits on the glass shows "Original colors" at its top
      right; it reshows that email on the white card with its own colors,
      and the button stays as "Adapted colors" to switch back.
      Remembered per message until the app quits. Plain-text emails and
      ones already on the white card don't offer it. Not in ⌘K yet; say
      if wanted*
      *Owner (2026-10-20): less obtrusive, glassy. Now a smaller pill of
      the app's glass (blurs the email under it, hairline edge, no
      shadow) with softer text; once switched, "Adapted colors" rests
      at 60% and brightens when the email is hovered*
- [x] Softer look for the remaining white cards on the glass
      *First try built (2026-10-20), waiting for the owner's eye: in dark
      mode the white card is dimmed to 90% brightness (images too) with a
      faint light edge and a small shadow instead of the grey ring, and
      rounded like the message cards (10px). Light mode is unchanged
      apart from the rounding. After step 2 only a small share of emails still use the card, plus any switched to "Original colors". Numbers are
      in `.email-card` in `src/styles/index.css`*
- [x] A setting to switch the default back to "blocked"
      *Built (2026-10-20), waiting for the owner to try it: Settings →
      Viewing → Privacy → Remote images, "Block until I allow a sender".
      The reader's notice then offers "Load images" per sender, as for
      Trash. Open emails follow a change at once*
- [x] Load by default only for people you've written to (option B of UX
      Spike 1's remote-image choice, not built)
      *Built (2026-10-20), waiting for the owner to try it: the same
      setting's middle choice, "Load for people I've written to". It
      counts anyone on To or Cc of mail you've sent from any account
      (the same test that ranks compose suggestions), not Google
      Contacts you've never mailed. "Load for everyone" stays the default*
- [x] Background image prefetch during sync, like Apple Mail, so senders
      can't tell when you opened (option C of the same choice, not built)
      *Built (2026-10-20), waiting for the owner to try it (owner: "sane
      defaults, start with how Apple does it, the rest configurable").
      Apple's guide says Protect Mail Activity downloads remote content
      "in the background when you receive a message" and hides your IP;
      Mailboat copies the timing but has no relay servers, so senders still
      see the IP. After each sync pass, each account downloads the images
      of its newest arrivals (25 per pass, received in the last 14 days),
      only where the image rule would load them anyway (never Spam,
      blocked senders or Trash; trackers skipped), up to 40 images of
      5 MB each per message. Opening the email shows the saved copies
      with no request. Settings → Viewing → Privacy: "Download images
      when mail arrives" (on by default, like Apple), "Space for saved
      images" (250 MB / 500 MB default / 1 GB / 2 GB, least recently
      viewed removed first) and Clear. Images set in style sheets
      (`background: url()`) and the `background` attribute still load
      when opened. The sync log notes how many were downloaded*
- [x] With the screensaver set to Random, switch to another screensaver
      every hour while it keeps playing *(owner request, 2026-10-19)*;
      today Random picks one each time it starts
      *Built (2026-10-20), waiting for the owner to try it: with Random
      chosen, a screensaver left playing changes to another scene every
      hour (a straight cut, not a fade). One started by name from the ⌘K
      palette stays. The hour is `SCREENSAVER_ROTATE_MINUTES` in
      `screensaver/model/catalog.ts`*

## Milestone 8: Triage and notifications

*Getting through mail faster, plus the tools for when something goes
wrong (Advanced and Show original, moved here from the Release Spike
idea because they're useful without distributing).*

*Under way (2026-10-24, owner: "start in on the next milestone", away
meanwhile). Items that need no decision from the owner are built first;
each is ticked once the owner has tried it.*

- [x] The AI panel opens and closes smoothly *(owner request,
      2026-10-21)*. Floating card: the form no longer moves; the panel
      springs open on the side with room (left at the card's home, the
      lower right; right when the card sits at the left), with the card's
      existing bounce, and collapses back the same way. The card moves
      only if neither side has room. Inline reply: the panel grows and
      shrinks quickly (0.18s) above the reply, and the reader scrolls with
      it so the reply stays in place and the conversation above moves up.
      *Owner feedback:* the card should bounce as a whole when the panel
      opens, as it does closing (now the left edge springs while the
      width eases, so both ways the whole card bounces and settles with
      the form in place); and inline, the reply still slid under the
      pinned Send bar, more so when closing. The reply is now held at its
      on-screen position each frame (adding up size changes drifted, and
      the browser's own scrolling as content shrank at the bottom doubled
      it). *Owner feedback:* no bounce with the card on the left (the
      panel opens to the right, so the springing left edge never moved),
      and the inline reply still crept under the Send bar after several
      opens and closes. Now the bounce is a small nudge of the whole card
      the way it grows or shrinks (14px, settling back), the same on
      either side, while the edge and width ease into place; and the
      inline panel stays drawn until its closing animation has certainly
      ended (it was removed a frame early, leaving a fraction of a pixel
      uncorrected per close). Not seen in the app by the agent. *Now
      covered by browser tests (owner request, 2026-10-21):*
      `tests/browser/ai-panel.spec.ts` checks, in WebKit, that the card
      opens the panel on the side with room and bounces as a whole on
      either side with the form ending where it was, and that the inline
      reply stays within 2px through 12 opens and closes. Each fails when
      the old behaviour is put back (no nudge; no scroll correction; the
      version that crept)
- [x] Settings → Appearance → Transparency: "Sidebar and reader" is now
      "Window" *(owner: it affects the list too)*, since it's the
      window's glass behind everything; each slider says what it covers
- [x] Both transparency sliders run the full 0% to 100% see-through
      *(owner request, 2026-10-21)*. They were limited to a range around
      each default (the sidebar's could only get 6 points clearer). Saved
      settings keep their value; the sliders now work in see-through
      percent from each area's default for the current light or dark
      look, and both ends are reachable in either
- [ ] Choose what each swipe does, plus a second swipe each way
- [ ] Delete key: Trash or Archive (in the Settings plan)
      *Built (2026-10-24), waiting for the owner to try it. Mailboat had no
      Delete key; now ⌫ (and the forward delete key) moves the selected
      or picked conversations to Trash, as in Mail, or archives them:
      Settings → Viewing → Delete key. Unlike `#` and `e` it never undoes
      (Delete in Trash does nothing rather than restoring). The `?` sheet
      lists it. ⌘⌫ stays unused (in a text field it deletes the line)*
- [ ] List density and preview lines (also a UX Spike 1 deferred idea)
- [ ] Include Trash and Spam in search (in the Settings plan)
      *Built (2026-10-24), waiting for the owner to try it: Settings →
      Viewing → Search → Include Spam and Trash (off, as Gmail). On, both
      the cache search and Gmail's own search (`includeSpamTrash`) look
      there too, in every account searched; rows found there act as they
      would in Spam or Trash (Not spam, Restore)*
- [ ] Which mail notifies (Inbox only / all; already in the Settings
      plan) and quiet hours
      *Built (2026-10-24), waiting for the owner to try it: Settings →
      Notifications → Notify about: Inbox (as before) or All new mail
      (anything new and unread except Spam and Trash, so mail a rule
      skipped the Inbox for notifies too; never your own or drafts).
      Quiet hours: off by default; on, pick from and to times (22:00 to
      07:00 to start; overnight works), and no notification shows then,
      by this Mac's clock. Mail still syncs, the Dock count still moves,
      and sign-in codes still show in the window*
- [ ] Sounds for new mail and for actions, if wanted
- [ ] Duplicate a rule
      *Built (2026-10-24), waiting for the owner to try it: Settings →
      Rules → Duplicate, by Edit, opens "Duplicate rule" filled in from
      that rule, saved as a new one. The account can be changed (to copy
      a rule to another account); its labels then become that account's
      labels of the same name, where it has them (before, changing the
      account in a new rule cleared every label)*
- [ ] Advanced section: clear the cache, reset, the sync log (in the
      Settings plan)
- [ ] Show original (the raw message and its headers)
      *Built (2026-10-24), waiting for the owner to try it: Message → Show
      original (⌥⌘U, Mail's Raw Source key), also in ⌘K, the right-click
      menu and the toolbar's More menu. A dialog shows the newest email
      of the conversation (any other can be picked) as Gmail's page does:
      Message ID, when it was written, From, To, Subject, and the SPF,
      DKIM and DMARC results Gmail recorded (anything but a pass in red),
      then the source itself. Copy puts the source on the clipboard;
      Download saves it to Downloads as "<subject>.eml". At most 1 MB of
      source shows (big attachments); the download is always whole. A
      browser test checks the dialog stays in the window with a long
      source scrolling inside it*
- [ ] Mute a conversation *(owner request, 2026-10-21)*: later replies
      skip the Inbox and don't notify, as Gmail's Mute does
- [ ] Clicking a new-mail notification selects that email and shows it
      in the reader *(owner request, 2026-10-21; today it only brings
      Mailboat forward, see Milestone 5 → Notifications)*
- [ ] Research other "empty state" designs and build a few to try
      *(owner request, 2026-10-21)*: what an empty list (Inbox zero, an
      empty label or search) shows, alongside today's icon and words with
      the pointer-following glow and the idle screensavers. Look well
      beyond mail apps: newer apps and design work shared on X (and
      sites like Dribbble, Mobbin), including interactive empty states
      such as small minigames (owner, 2026-10-21: "seen newer stuff
      that's interactive with eg minigames"), as well as mail and
      calendar apps (Notion Mail, Superhuman, Spark, Apple Mail, Things).
      Then try the best few behind a feature flag, as with the
      screensavers
- [ ] Empty Spam *(owner request, 2026-10-21)*: one button at the top of
      Spam, as in Gmail ("Delete all spam messages now"), with a
      confirmation; per account in the unified view, split per account
      (rule 5). Catch to decide first: deleting for good needs Gmail's
      full-access scope (`https://mail.google.com/`), which Mailboat doesn't
      ask for (it has `gmail.modify`). Without it, "Empty" can only move
      Spam to Trash, which Gmail deletes after 30 days. Adding the scope
      means every account signs in again and a scarier consent screen.
      Empty Trash has the same catch and would come with it

## Milestone 9: Writing

- [ ] Templates: saved replies to insert while writing (Gmail's own
      templates aren't in its API, so these would be Mailboat's)
- [ ] Warn about outside recipients (addresses not ending with chosen
      domains are marked while writing)
- [ ] Remove an address from compose suggestions
- [ ] Images inline in the email being written, as Gmail does *(owner
      request, 2026-10-22)*: dropping (or pasting) an image into the
      composer puts it in the body where it lands, while other files
      (documents, PDFs…) still become attachments. Today every dropped
      file is an attachment. Sent as inline parts with Content-IDs
      (`cid:`), the same way forwards already carry the original's
      embedded images; to decide: resizing in the editor (Gmail offers
      small / best fit / original), and a large image's share of
      Gmail's 25 MB limit

## AI Spike

**Closed (owner, 2026-10-21).** Everything built was tried and approved
by the owner. Moved out when it closed: the MCP server and the AI ideas
not built (to Later, "From the AI Spike"), and Connect from a signed-out
Claude Code or Codex, never tried for real (to the Bug backlog, to watch).

*The AI work, gathered from Later at the owner's request (2026-10-17).
Sending an email to a model is always an explicit choice (`CLAUDE.md`).*

*Started 2026-10-20 at the owner's request, built while they were away
("do what you can without asking"). Their brief: several providers, Apple
Intelligence on by default; ChatGPT and Claude added by signing in, not
with API keys; usage tracking if easy; summaries in the list and above the
email; AI replies from their own prompt with the conversation as context,
chat-style, with a button to put the result in the email, and no overlay
on top of the composer's overlay; maybe new mail too. Everything below is
built, tested and waiting for the owner to try.*

- [x] Providers *(built 2026-10-20)*: Apple Intelligence through Mailboat's
      own Swift helper (on-device; default for everything), Claude through
      Claude Code (`claude`) and ChatGPT through Codex (`codex`), each
      signed in with the owner's subscription. Settings → AI → Connect
      runs the tool's sign-in, which opens the browser; no key is typed
      into Mailboat. Every request runs with all tools off (see ARCHITECTURE
      decisions). Checked live on this Mac: all three answer (Apple ~1s,
      Claude ~2s, ChatGPT ~5s). *Replaces the plan of user-supplied API
      keys (owner, 2026-10-20: sign in, not keys).* Not tried: Connect for
      a tool that's signed out (both were already signed in here)
- [x] Usage *(built 2026-10-20)*: Settings → AI → Usage, per provider,
      today and last 30 days: requests (and failures), tokens in and out,
      Claude's API-price estimate, and Claude's plan limits (5-hour and
      weekly) as of its latest answer. Apple and Codex report no cost
      (Codex reports tokens)
- [x] Summaries in the list *(built 2026-10-20)*: one line in place of
      the email's first words, with a small sparkle; hover for the
      original. Written in the background for the rows on screen, newest
      first, cached until new mail arrives in the conversation; never for
      Spam or Trash. Settings → AI → In the list: Off or a provider (a
      warning says when every conversation scrolled past would be sent to
      Claude or ChatGPT). Seen working in the dev app: summaries written by Apple Intelligence on the visible rows
- [x] Summary above the email *(built 2026-10-20)*: a card of a few
      points above the messages, streamed as it's written, with
      "Summarize again" and Hide. Automatically for conversations long
      enough to need one (default), with a Summarize button, or off; its
      own provider choice. Apple's guardrails sometimes refuse an email;
      the card then says why with "Try again"
- [x] AI replies and new mail *(built 2026-10-20)*: ⌘J or the ✦ by the
      paperclip opens a chat. In the floating card it opens beside the
      form and the card widens (no overlay on the overlay); inline in
      the reader it opens above the reply inside its card. Say what to
      write (or pick a suggestion: Say yes, Politely decline…); each
      answer is a whole draft with "Use this", which replaces the text
      (signature and quote stay); ask again to refine it. It reads the
      conversation and what's written so far; new mail takes a suggested
      subject if it has none. Provider picker in the panel, Stop, Esc
      closes. The prompt was tuned after trying all three (Apple signed
      off as an invented name). *Not seen in the window by the agent*
      (it can't screenshot from its shell): checked by component tests
      and live provider tests. To decide with the owner: side panel vs
      above for the card, its width (340px), and whether "Insert" (keep
      what's written) is wanted beside "Use this" (done: see below)
- [x] Owner feedback on the first try (2026-10-20), with a screenshot:
      - With a signature, the sign-off had the owner's name too: now just
        "Thanks," when a signature follows (the name stays without one)
      - "Use this" lost the blank lines between paragraphs: drafts now
        reach the editor as HTML with blank lines as empty paragraphs
      - Formatting: drafts may use bullets, numbered lists, bold, italics
        and tables, shown formatted in the chat and in the editor, sent
        without list margins or a font of their own (tables with thin
        grey lines). Checked live: all three providers wrote a numbered
        agenda, a table and bold text when asked
      - "Use this" became two buttons *(owner's pick, 2026-10-20)*:
        **Insert** (at the cursor, keeping what's written) and **Replace**
        (in place of the text; signature and quote stay either way)
      - The ✦ button didn't put the cursor in the chat box *(owner
        report)*: opening the panel in the floating card rebuilt the form,
        and the editor took the focus back. The layout no longer changes
        when the panel opens, and the chat box is focused once the
        provider is known to be ready
- [x] Small items (owner, 2026-10-20):
      - Opening Settings minimizes a message being written in the
        floating card (it floated over the Settings page)
      - Providers listed alphabetically everywhere: Apple Intelligence,
        ChatGPT, Claude
      - The AI panel stays open when a message is minimized and restored
        (or a reply popped out): it was the card's own state, lost while
        minimized; now kept per message
      - The suggestion chips for a reply or forward are written from the
        email (e.g. "Ask which budget numbers to bring"), by the writing
        provider, once per conversation per session; new mail keeps the
        general ones, also the fallback if asking fails. Apple's model
        copied example lines word for word and invented PO numbers, so
        its prompt asks for four kinds of response (agree, decline, ask,
        suggest) with no examples, after the email. Checked live on two
        emails with all three providers
      - The pinned Reply bar's tint follows Settings → Appearance →
        "Window" (then "Sidebar and reader") *(owner report: it had its own fixed tint,
        the compose card's)*, offset so it still hides the email under
        it; at the default it looks as before. Owner confirmed (2026-10-20)
      - "Reply with AI" on the reply bar (after Forward, while the
        writing provider is ready): starts a Reply with the AI panel
        open. A plain Reply rather than Reply all, so nobody extra is
        emailed by default; the reply's kind menu switches it. Fixed (owner
        report): the cursor landed in the email text, not the chat box;
        a reply opening with the assistant now leaves it in the chat
      - Model choice for writing (Settings → AI → Writing → Model):
        Claude's Haiku / Sonnet (default) / Opus; ChatGPT's models from
        Codex's own list (`codex debug models`; "Codex's default" first).
        *First built as Quick / Balanced / Thorough for ChatGPT, on the
        agent's wrong belief that Codex had no model list.* Summaries and
        chips always use the quick model
      - Faster chips *(owner, 2026-10-20: "many seconds")*. Measured per
        email: ChatGPT was the slowest, Claude and Apple faster, and part of Codex's time is starting up. Now: ChatGPT's quick requests (chips, summaries)
        use Codex's fast model (the catalog's newest "fast" one, today
        GPT-6-Luna) with no reasoning, faster, with ideas as specific in testing; chips are saved per conversation like summaries
        (instant until new mail arrives); Reply with AI starts them
        while the reply loads. Not done: writing chips as soon as a
        conversation opens (it would send every opened email to a cloud
        provider unasked), and keeping Codex running between requests
      - The Reply / Reply all / Forward switch is in the floating card
        too, not only inline (owner report): the card was never given it.
        Shown for replies and forwards that started here, not new mail

## Bug Spike 2

*Started 2026-10-21 at the owner's request, to do soonish: every open
bug from the Bug backlog moved here, and new bugs go straight here until
it starts. Each says how it was found and whether it has been seen for
real. Connect from a signed-out CLI is only to watch: it ticks once
seen working.*

*Under way (2026-10-24, owner: "start the bug fix spike"). Built one item
at a time; each is ticked once the owner has tried it.*

- [ ] Menus grow as wide as their longest item *(owner report with a
      screenshot, 2026-10-21)*: "Block <address>" in the list's context
      menu stretched the menu across most of the window for a very long
      sender address. Cap the menu's width and cut long items off with
      "…", with the full text in a tooltip
      *Built (2026-10-24), waiting for the owner to try it: every menu
      is now at most 320px wide; a longer item ends in "…" and shows
      in full on hover. A browser test checks it (the old menu measured
      933px). To try: right-click a conversation from a long address*
- [ ] Moving with j/k doesn't preview when no preview shows *(owner
      request, 2026-10-24, building on the Esc item)*. Without a preview,
      j/k and the arrows only move the selection; Enter or `o` previews,
      a click still previews, Esc hides the preview. The buttons and
      keys for a conversation (archive, star, reply, …) work on the
      selected row whether or not it's previewed; reply previews it.
      With a preview showing, j/k preview the next one as before
      *Built (2026-10-24), waiting for the owner to try it. Also covers
      the reader hidden with its toolbar button: j/k then just select*
- [ ] More conventional keyboard reading *(owner, 2026-10-24, from a
      list of suggestions)*: Space / ⇧Space scroll the open conversation
      a screenful; n / p go to the next or previous email in it (to the
      top of the reader, opened if folded); ⇧↓ / ⇧↑ pick a range from the
      selected conversation, as in Mail; PgDn / PgUp move a page in the
      list. The `?` sheet lists them, with a new Reading group, and says
      j/k only preview when a preview shows. Not taken up: a different
      look for selected-but-not-previewed rows (owner: the row is
      focused either way)
      *Built (2026-10-24), waiting for the owner to try it. Browser tests
      cover n / p and Space on the real reader; the range and page logic
      has unit tests*
      *Owner (2026-10-24): Esc should hide the reader just as its button
      does (it closed the conversation instead, so the button then needed
      two clicks to bring the preview back). Built, waiting to be tried:
      Esc hides the reader and remembers it, the conversation stays
      selected, and Return or `o` shows it again (remembered too)*
      *Owner (2026-10-24): a click bringing the reader back should be
      remembered too: what's remembered is whether the reader shows.
      Built: it's saved whenever it changes, whatever changed it*
- [ ] Rethink where the "Original colors" button sits *(owner report with
      a screenshot, 2026-10-21)*: it floats over the top right of the
      email, so it covers the first line when that line runs to the edge
      (the end of a long first line hidden under it). Options: the message header
      row (by the time), the "…" menu, or showing it only on hover
      *Owner (2026-10-24, with a screenshot of it hiding text):
      "obscuring email text isn't an option", try something. Built,
      waiting for the owner to try it: it's now in the line above the
      email, at the right of "Images shown · Block images" when that
      line shows, otherwise on a quiet line of its own. Always shown (no
      longer only on hover). A browser test checks it ends above the
      email in both cases*
- [ ] Esc while previewing an image moves the selection to the top
      email *(owner report, 2026-10-21)*. Esc should only close the
      preview; it likely also reaches the list's own Esc handling
      (clear selection), so the list falls back to its first row
      *Owner clarified (2026-10-24): it's Esc with an email open in the
      reader, not an image. Esc closed the conversation and cleared the
      selection, so j/k started again from the first row. Owner chose:
      close the reader but keep the row. Built, waiting for the owner to
      try it: after Esc the row stays highlighted, j/k move on from it,
      and `o` (or Enter) opens it again. Clicking the list's empty area
      or changing view drops it. Keys like `e` still act only on an open
      or picked conversation; say if they should act on that row too*
      *Owner (2026-10-24): yes, they should; see the next item*
- [x] A conversation's summary missed its newest reply *(owner report, 2026-10-21)*: a summary still described a thread as waiting on an answer after a one-line reply had arrived. Cause: Apple's small on-device model gave a one-line reply too little weight after a longer email. Fixed: the newest email is headed "Newest message" in what the model reads, and the summary is told to start with where things stand by it, even when it is one line. The list's one-line summaries are told the same. To try: press "Summarize again" (saved summaries stay until then or until a new reply)
- [ ] The floating composer flashes see-through just after its bounce
      *(owner report, 2026-10-21; likely since the whole-card bounce,
      commits 25c03a7 / 3429692)*: opening or closing the AI panel, right
      after the bounce settles, the content behind the window shows
      through for a moment. Likely cause, not yet confirmed: the bounce
      is a `translate` animation on the card (`.nudge-*` in
      `index.css`), and when it ends WebKit rebuilds the card's
      compositing layer and draws one frame without its backdrop blur.
      Things to try: keep the card on its own layer all the time (e.g. a
      resting `translate: 0 0` or `will-change: translate`), or bounce
      an inner element rather than the glass card. The browser tests
      can't see backdrop blur, so this one needs checking in the app
      *Built (2026-10-24), waiting for the owner to check it in the
      app: the card now keeps its own layer all the time (`will-change:
      translate`), the first of the two ideas. That makes it the frame
      for fixed-positioned content inside it, but everything floating
      from it is a top-layer popover, which a WebKit check confirmed
      isn't affected. To try: open a new message and toggle the AI panel
      (⌘J) several times, watching just after each bounce settles. If it
      still flashes, the next try is bouncing an inner element*
      *Owner (2026-10-24): still flashes. Real cause found and fixed,
      waiting to be tried again: the bounce's animation took the place of
      the card's opening fade (`toast-in`, from opacity 0), so when the
      bounce ended the fade played again: the card went fully see-through
      and faded back in over 180ms. Each bounce now keeps the fade in its
      animation list, so it isn't restarted; the layer change was undone.
      A browser test samples the card's opacity every frame across two
      toggles (it reached 0 before the fix)*
- [ ] The envelope flock screensaver looks jumpy and low-res *(owner
      report, 2026-10-21)*; experiment with larger envelopes. Why it
      looks that way: every screensaver draws on a grid of 3px cells
      (`SCENE_CELL_PX`) and an envelope is a 7×5-cell sprite
      (`screensaver/model/envelopes.ts`), so each one is 21×15px and
      moves in 3px steps. Things to try: a bigger sprite with more detail
      (say 11×8 or 14×10), fewer envelopes, and finer movement for this
      scene only (a smaller cell, or drawing the sprites at their exact
      position rather than snapped to the grid)
      *Built to try (2026-10-24): this scene alone now draws on 2px
      cells (the others keep 3px), so envelopes move in 2px steps; the
      envelope is 13×9 cells (26×18px, was 21×15) with a deeper fold,
      and the paper plane 12×6; 10 envelopes instead of 14, with speeds
      and distances scaled so the flock covers the screen as before.
      Also a cause of the jumpiness: the wingbeat went by each
      envelope's position, so it flickered unevenly as it moved; each now
      keeps its own steady beat (3 a second). To try: open an empty view
      (an empty label, say), press ⌘K and start "Envelope flock". Bigger
      still, slower, fewer, or back?*
- [ ] Many attachments squeeze the composer's writing area *(owner
      report, 2026-10-22)*: each attachment chip takes a row, so with
      enough of them the editable area shrinks to almost nothing. Give
      the editor a reasonable minimum height, and lay the attachments
      out more compactly: chips in columns (wrapping side by side), then
      a capped height that scrolls, or a "+N more" that expands
      *Built (2026-10-24), waiting for the owner to try it: chips
      already sat side by side; past two rows they now scroll, with the
      third row peeking out, and the writing area keeps at least about
      seven lines. A browser test attaches 30 files and checks both (the
      old chips took 1022px). To try: attach a dozen or more files to a
      new message*
- [ ] An open conversation stayed unread *(owner report with a
      screenshot, 2026-10-22)*: a thread showing in the reader, newest reply expanded, still unread after
      several seconds until marked read by hand. Likely cause, from the
      code: the reader decides whether to mark read once, when the
      conversation opens (`unreadWhenOpened` in `ThreadReader.tsx`, so
      pressing `u` afterwards sticks). If the conversation was already
      open, or opened while it was read, and a new reply then arrives
      and makes it unread again, nothing marks it read. Fix: also mark
      read when a new unread message arrives in the conversation being
      shown (after the same delay), while still respecting a manual `u`
      *Built (2026-10-24), waiting for the owner to try it: a reply
      that arrives unread while its conversation is open now opens in
      the reader and is marked read after the same delay (Settings →
      Viewing). Pressing `u` still sticks, since it brings no new email.
      To try: leave a conversation open, reply to it from another
      account or your phone, and wait for it to arrive*
- [ ] Reply with AI doesn't scroll the reply into view *(owner report
      with a screenshot, 2026-10-22)*: the reader stopped partway down the
      last email, with the reply form (and the AI chat) still below. May
      share a cause with the next item: it scrolls to where the end was
      when clicked, and an email that then grows (or is already too
      tall) moves the target. Fix: scroll once the reply area is laid
      out, and again if it moves while opening; a browser test with
      the real reader can check it ends fully in view
      *Built (2026-10-24), waiting for the owner to try it: a
      different cause from the blank space. Opening the AI panel holds
      the reply still on screen (so toggling it doesn't push the reply
      down), and with Reply with AI that hold pinned the reply below the
      fold while it was being scrolled to. The hold now applies only
      while the reply is on screen. The reply also follows anything above
      it that grows, and the chat box takes focus without scrolling. A
      browser test clicks Reply and Reply with AI and checks the whole
      reply ends in view (before: its bottom was 1850px below). To try:
      open a long email and click Reply with AI*
      *Owner tried it (2026-10-24), two problems, both fixed and
      waiting to be tried again: (1) after Reply with AI, discarding the
      draft and clicking plain Reply opened the AI chat again. The "open
      with AI" wish stayed on the conversation until the panel was
      toggled; the reply that opens with it now uses it up. (2) Only the
      AI chat scrolled into view, not the reply: together they were
      taller than the reader, and "nearest" scrolling shows the top. A
      reply taller than the reader now scrolls so its end (Send) shows.
      The browser test now also runs with a short reader*
      *Owner (2026-10-24): now in view, but the reply ideas arrive a few
      seconds later, usually in two rows, while their stand-ins took
      one, so the reply was pushed down. Built, waiting to be tried: the
      stand-ins are sized as shares of the width so they always take two
      rows, and the ideas' space stays two rows tall, so one or two rows
      of ideas don't move anything (three still would). A browser test
      checks it at two widths*
- [ ] Blank space below the end of an email *(owner report with a
      screenshot, 2026-10-22; frequent, no reliable steps)*: a corporate email
      ended with most of the reader's height empty below it. Likely
      cause, from the code: each email's frame is sized from
      `documentElement.scrollHeight` (`MessageFrame.tsx`), which is never
      less than the frame's current height. So a frame can grow but
      never shrink: once the email is measured tall (the reader
      narrower for a moment, while the sidebar docks, the AI panel
      opens or the window is resized, or images and fonts arriving),
      it keeps that height when the text re-wraps shorter. Fix: measure
      the content itself (the body's own height), not the frame's
      document, and add a browser test that narrows then widens the
      reader
      *Built (2026-10-24), waiting for the owner to try it: cause
      confirmed. Each email is now measured with its frame collapsed for
      that instant (before anything is drawn), so the reading is the
      email's own height and the frame shrinks as well as grows. A
      browser test narrows then widens the reader: the old code stayed at
      3374px against 2115px before. To try: open a long email, dock the
      sidebar or open the AI panel and close it again, or resize the
      window; no blank space should be left under the email*
- [ ] Opening a conversation should land on the first unread email
      *(owner request, 2026-10-22, filed as a bug)*: read emails
      collapsed, unread ones expanded, and the reader scrolled so the
      first unread one is at the top (focused for the keyboard). Today
      the expanding already works that way (`initiallyExpanded` in
      `ThreadReader.tsx`: the unread ones plus the newest), but nothing
      scrolls, so the reader opens at the top: the subject, summary and
      the collapsed rows, with the first unread email possibly below the
      fold. With nothing unread it stays as now (the newest expanded).
      Must wait for the emails above to be measured, or it lands short
      (see the blank-space item above); a browser test can check it
      *Built (2026-10-24), waiting for the owner to try it: when read
      emails come before the first unread one, the reader opens with that
      email's card at the top, and keeps it there for 1.5s while the
      emails above finish measuring (or until you scroll). With the first
      email unread, or none, it opens at the top as before. Not done: the
      email isn't given keyboard focus, since focusing its header button
      would make Space and Enter fold it; say what "focused" should do.
      A browser test opens five emails, the last two unread (without the
      fix the card sat 213px down). To try: open a conversation with an
      unread reply after a few read emails*
- [ ] Try the AI summary's sparkle icon in the list's left gutter
      *(owner request with a screenshot, 2026-10-23: "looks a bit off";
      worth a try)*: on a row's third line the sparkle sits just before
      the summary text, indented with it, while the unread dot,
      paperclip and star line up in the gutter column on the left. Move
      it into that column under them (the summary text stays where it
      is), and compare in the app before keeping it
      *Built to try (2026-10-24): the sparkle now sits in the icon
      column the account ring and star use (the star's column, centred
      under it), on the third line; the summary text hasn't moved. The
      other option is the outer gutter, under the unread dot and
      paperclip. Keep, move to the outer gutter, or go back?*
- [ ] Connect a signed-out Claude Code or Codex from Settings → AI *(from
      the AI Spike when it closed, 2026-10-21; never tried for real: both
      were already signed in on the owner's Mac)*. Connect runs `claude
      auth login` / `codex login`, which should open the browser, and
      waits up to 5 minutes for the tool to say it's signed in. To tick
      once it has worked once; if the browser doesn't open, the fallback
      is signing in from Terminal (Settings says so) and pressing Connect
      again
- [x] The screensaver sometimes didn't start *(owner report,
      2026-10-19; moved from Milestone 7, then from Bug Spike 1 when it
      closed, 2026-10-20)*. Likely cause, fixed: when the idle minute ran out
      while the window was hidden it waited another minute instead of
      starting, and macOS counts a window that another app covers
      completely as hidden. It now starts anyway (the canvas pauses while
      hidden). To tick once the owner hasn't seen it again; if they do,
      diagnose further. Owner's guess (2026-10-19): it was on another
      Space when it didn't start, which macOS also reports as hidden, so
      the same fix covers it. Owner (2026-10-21): not seen since
      the fix

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
- [ ] Demo mode *(owner, 2026-10-22, after asking about a trailer)*:
      the real app started with its own data folder (e.g. an env var or
      launch flag), filled with made-up accounts, conversations,
      labels, summaries and sign-in codes, and no Google connection, so
      none of the owner's mail can show. Sending is faked (it lands in
      Sent, and a scripted reply can arrive). For screenshots, the
      README or a website, and the trailer below. The fake data is
      shared with the trailer and the browser tests' harness
- [ ] Teaser trailer *(owner, 2026-10-22)*: a short video made in code
      with Remotion (videos written in React), drawing Mailboat's real
      components with the demo data, as the browser tests do. Scripted
      camera moves, a gliding cursor, typing, the AI panel opening, mail
      arriving; rendered to MP4 at 16:9, square and vertical. Not
      AI-generated video: it garbles text and invents UI that isn't
      Mailboat's. Limits: it renders in Chromium, so the window's glass is
      imitated over a chosen wallpaper rather than macOS's own; music or
      a voiceover come from the owner (cuts can be timed to a chosen
      track). Check Remotion's licence (free for individuals and small
      companies) when starting, and record it in ARCHITECTURE

## Bug backlog

*Bugs found in passing (started 2026-10-19 at the owner's request).
Open ones moved to Bug Spike 1 (2026-10-19) and Bug Spike 2
(2026-10-21); new bugs go to Bug Spike 2 while it is open. What stays
here is done.*

- [x] Emails mangled in dark mode *(owner report with screenshots,
      2026-10-20: a news site, a notice, a bank)*. Rendered outside the app
      (`examples/render_email`, headless Chrome in dark mode) to find
      three causes:
      - a news site says `color-scheme: light only` but also has a dark-mode
        block forcing its page white; any mention of "dark" counted as
        supporting dark mode, so its text was remapped light on its white
        page. An explicit "light only" now wins: it keeps the white card
        (a small share of cached HTML emails)
      - a notice sets a white box inline with `!important`, which beats
        every style sheet, so the dark remap couldn't reach it while the
        text inside was turned light. Such inline colors now move into a
        rule of their own, as strong as before against the email's own
        sheets (light mode unchanged) but below the dark remap (some emails)
      - a bank: by design rather than a bug (its pale grey page becomes
        see-through, its white boxes darker cards); its logo is dark text
        in a transparent image, which no color remap can fix. "Original
        colors" is the way out
      Owner confirmed the fixes (2026-10-20)

- [x] "Original colors" is remembered per sender *(owner, 2026-10-20:
      "yes", after a bank's logo, which no remap can fix)*. Switching an
      email to Original colors now applies to every email from that
      address, in any account (kept like the per-sender image choice);
      Adapted colors forgets it. It was per message, until the app quit

## Later / unscheduled

### From the AI Spike (moved unbuilt when it closed, 2026-10-21)

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
- [ ] AI ideas not built during the spike: AI actions in ⌘K (Summarize,
      Reply with AI); AI search ("find the invoice from…"; owner: only if
      small, and it isn't: it needs its own design in the search box);
      keeping Codex running between requests (its ~3s start on every
      request is most of what's left of ChatGPT's wait)


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
- [ ] Independent code review by an agent *(owner request, 2026-10-19)*:
      a fresh agent, with none of the context of the agents that wrote the
      code, reviews the whole codebase for bugs, security problems
      (sanitizing, tokens, capabilities), the multi-account rules and
      code that has grown messy. Findings come back as a list to go
      through with the owner one at a time, not as fixes made straight
      away. Scope and timing to agree first (whole app, or a milestone's
      work at a time)
- [ ] Search history *(owner request, 2026-10-19)*: recent searches
      offered when the search box opens, picked with ↑/↓ and Return.
      Kept locally (searches can be private, so never synced), with a way
      to remove one or clear them all. To agree: how many to keep, whether
      they show in ⌘K too, and whether a search can be pinned (saved
      searches)
- [x] Look through GotEmail and bytemail for features and enhancements
      worth borrowing *(owner request, 2026-10-19; researched
      2026-10-20 from their websites, marketing claims unverified)*.
      Picked first by the owner: sign-in codes (below). The rest, for the
      owner to pick from one at a time:
      - **Codes, more** (both): a menu-bar list of codes from the last 15
        minutes (GotEmail); archive the email once its code is copied
        (bytemail); magic sign-in links with an Open button (both)
      - **Menu bar item** (GotEmail): unread count, compose, check mail
      - **To Reply** (bytemail): a view of conversations where someone is
        waiting on you, leaving out newsletters and receipts
      - **Remind me if no reply** (bytemail): a sent message comes back to
        the top of the Inbox if nobody answers by a chosen time
      - **Unsubscribe and Subscriptions** (bytemail): one-click
        unsubscribe where senders support it, and a list of senders by
        how much they send
      - **Phishing warnings** (bytemail): look-alike domains, sender
        authenticity, links whose text and address differ
      - **Strip tracking codes from links** (bytemail): utm_ and the like,
        alongside the tracking pixels Mailboat already removes
      - **Translate** (GotEmail): Apple's on-device translation of an
        email, with Show original
      - **Rewrite selected text** (bytemail): shorten, soften or translate
        what's written, with Apple Intelligence
      - **Sender logos** in the list (GotEmail)
      - **Contacts view** (GotEmail): everyone you write to, with recent
        mail both ways
      - **Chat-style conversations** (bytemail), with a classic view per
        account
      - Already in Mailboat or its plans: unified inbox, AI drafting and
        summaries, invitations, rules, undo send, tracker removal,
        per-sender images, remote search, MCP server (AI Spike), snooze
        and send later (Later), category tabs (Later). Not for Mailboat:
        read tracking and read receipts (need a server), IMAP providers
- [x] Sign-in codes *(owner pick, 2026-10-20: "surfacing sign-in codes,
      maybe as modeless notifications in the upper right like the
      harness updates in MonoCode… we'd have to play with it")*. Built to
      try: `mail::codes` finds a code by its wording (e.g. "verification
      code", "one-time passcode", "is your … code"), never in replies,
      forwards, invitations (meeting passcodes) or Spam, nor promo codes,
      years, prices, order or phone numbers. Shown three ways:
      - a glass notice at the top right as the email arrives (MonoCode's
        style): sender, subject, the code, Copy (then it goes); Open
        shows the email; it leaves by itself after 10 minutes
      - the code leads the macOS notification ("346625 · Spotify")
      - a pill on the conversation's row for a day; clicking copies it
      Checked on invented sign-in emails of many styles; promotional wording; meeting
      passcodes and people writing about codes are left alone
      (`examples/code_stats`). Not seen in the app by the agent
- [x] Sidebar peek *(owner request, 2026-10-20: "a floating sidebar when
      you mouse over the toolbar button for it while it's collapsed, like
      in Notion Calendar")*. Built to try: with the sidebar hidden, resting
      the pointer on its toolbar button (0.12s) floats the sidebar over
      the list on the compose card's glass, sliding in from the left. It
      stays while the pointer is on it (views can be picked from it) and
      goes 0.28s after the pointer leaves both, or with Esc; clicking the
      button still pins it open as before. Timings are `PEEK_OPEN_MS` and
      `PEEK_CLOSE_MS` in `app/Shell.tsx`. *Owner (2026-10-20): a small delay
      before it shows, and a quick slide in from the side.* Now it opens
      after 0.3s, slides in from past the window's left edge in 0.16s and
      slides back out in 0.12s (moving back onto it keeps it). *Owner:
      clicking the button while peeking should snap the peek into place as
      the sidebar.* Now the peek glides into the sidebar's exact place
      (8px left, 4px up) and loses its glass, shadow and corners while the
      sidebar opens beneath it without its own slide, both in the panel
      slide's 0.22s; then the peek goes. *Owner: the glass changed at one
      moment instead of fading.* WebKit can't fade a backdrop blur, so it
      switched off in one step; the glass is now a layer behind the
      contents that fades by opacity. *Owner: still a pop at the end.*
      The cause: the docked sidebar's panel sets medium-weight text
      (`on-glass`) and the peek didn't, so the text thickened when the
      peek went, on top of being drawn twice during the dock. The peek now
      has the same styling, and the sidebar under it stays hidden until
      the frame the peek goes. Not seen in the app by the agent;
      a right-click menu opened in the peek may lose it when the pointer
      moves onto the menu
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
