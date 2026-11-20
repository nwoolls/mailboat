# Changelog

## 0.3.0-beta.7

### Fixes

- A file dropped on a reply's signature or quoted text attaches to the reply, and a dropped file no longer opens in place of the app.
- A long unbroken line in a reply, such as a row of "=" or a long link, now wraps instead of pushing the conversation sideways.

## 0.3.0-beta.6

### Toybox and screensavers

- When a list empties, the glow or toy behind it fades in instead of appearing all at once.
- The text over the Sky toy no longer flickers between light and dark when you switch between empty views or when a screensaver starts or ends, and the words stay readable when they change while a screensaver plays.

### Fixes

- Opening a view that had no mail but has some now shows the mail, without a flash of the empty view first.

## 0.3.0-beta.5

### Fixes

- On the Mac, the app opens again after an update as the app in the Dock, without a second Dock icon. Updating to this version still shows the extra icon once, because the version being replaced does the restart; the fix shows from the next update.

## 0.3.0-beta.4

### Fixes

- A sign-in code is found in emails whose subject reads `Use <code> to …` followed by an account action, such as Google's recovery-email check (`Use 123456 to set up recovery email`).
- An email whose subject has certain letters, such as the Turkish capital İ, no longer crashes sign-in code detection.

## 0.3.0-beta.3

### Fixes

- Send again copies the first email you sent in a conversation, not a later reply or forward of yours.
- In first-launch setup, Use a different file goes straight to giving the new credentials file, instead of back to the start of the Google Cloud steps, and you can keep the current file instead.

## 0.3.0-beta.2

### New

- **Send again.** Send again… (⇧⌘D) opens an email you sent as a new message, with the same recipients, subject, text and files, and its Bcc when Gmail can be asked for it, ready to change and send.
- **Outside recipients.** On a Google Workspace account, people outside your organization are marked while you write, with a note above the message, as Gmail does. Settings → Accounts can turn it off for each such account.
- **What's new.** The notice that offers an update has a What's new button, which opens that version's release notes in your browser.

## 0.3.0-beta.1

### Fixes

- Clicking into the message, signature or vacation box puts the cursor where you clicked, even when the app is busy at that moment.

### Dates and times

- Dates and time zones, such as an invitation's time, now come from a maintained library; they read the same as before.

### Releases

- Each download now comes with its own software bill of materials, listing only what that platform's build contains.

## 0.3.0-beta.0

### New

- **Print a conversation.** Print… (⌘P, or Ctrl+P on Windows) in the File menu, the command palette and the toolbar's More menu prints every email in it on white, with who sent it, to whom and when.
- **Label colors and visibility.** Each label in the sidebar has a ⋮ button for choosing its color, whether it shows in the sidebar and whether it shows on conversations, saved to Gmail. Conversations in the list show their labels after the subject, in colors that stay readable.
- **What notifications show.** Settings → Notifications can make new-mail notifications show everything (the default), only the sender, or just "New email".
- **Remove a suggested address.** Take an address out of the To, Cc and Bcc suggestions with the × beside it or Shift+Delete, and bring it back from Settings → Composing.
- **Links without tracking codes.** Known tracking codes (such as `utm_source` and ad click IDs) come off links in emails before they open in your browser.

### Window and toolbar

- The window can be made much narrower and shorter: the sidebar folds away first, then the conversation list and the open conversation take turns, and toolbar buttons that don't fit move into the More menu. The search box no longer runs into the toolbar's buttons.
- Icons closer to Gmail's: Spam is a warning sign instead of a shield, Archive and Move to Inbox show where mail goes, Mark as read and Mark as unread show an open or closed envelope, All Mail is a stack of envelopes, and Important is Gmail's marker.
- A little motion: starring spins the star, Archive and Move to Inbox and the open and closed envelopes cross-fade when they change, and toolbar buttons fade in and out as the window's width moves them into the More menu.

### Toybox and screensavers

- Every screensaver and toy can be drawn in chunky pixel art or in ASCII art (Settings → Toybox → Style).
- Settings → Toybox is reworked: each card's switch sits beside its choices, and the style and every screensaver show a small picture of themselves.
- A new screensaver, Code rain: columns of falling characters, with the pointer as a flashlight. The envelope flock is now Flock, a murmuration of birds with depth.
- Screensavers that changed:
  - Fireworks has a new shell, a weeping willow whose sparks sink slowly toward the ground.
  - The starfield has streaking stars and an occasional warp.
  - Jellyfish are big and glowing, with tentacles that trail and ripple.
  - Koi are larger, with fins and tails that ripple, and swim more calmly.
  - Fireflies are fewer and calmer, over swaying grass.
- Toys that changed:
  - The glow is now one of the toys in Settings → Toybox → Something to play with, instead of a switch of its own. It's still the default, and an earlier choice carries over. It follows the pointer on a spring: it glides to the pointer, keeps pace as you move and settles where you stop. In ASCII art it thins out around the icon and words so they still read.
  - The pond is drawn in your accent color, and the pointer stirs its water faintly as it moves; a click still drops a stone.
  - The sky is redrawn: mountains and fields under a sky that follows the time of day, without the rounded fade at the edges, and the text over it turns light at dusk.
  - Popping bubble wrap sets off confetti and makes nearby bubbles wobble, and after the last pop a fresh sheet inflates.
- Screensavers, and the pond's water, now reach the top of the list, under its title, without a hard edge below it, and the title stays readable under the glow. Resizing the window no longer restarts the sky, the pond, the jellyfish or the starfield, the sandscape keeps its sand, and screensavers no longer flash while the window is resized.

### Fixes

- A reply you open no longer stays partly below the reader when its scroll into view is cut short.

### Security and privacy

- An email's images no longer load from an address on your own computer or local network (a router, a printer, a local server), and images downloaded as mail arrives aren't fetched from such an address either.
- Images downloaded as mail arrives are always fetched over HTTPS, even when an image server redirects to a plain HTTP address.
- On macOS, the app's folders, mail database and saved Google client file can be opened only by your user account, including ones made by earlier versions. On Windows, the saved Google client file is protected the same way.
- On Windows, the connection AI apps use to reach the app admits only your user account.
- The working folder the AI helpers run in is always removed afterwards, even when a request fails or times out, and on macOS it is readable only by you. Codex's check of its own settings runs in a private folder of its own instead of the shared temporary folder.
- The Windows app is built with Control Flow Guard, a Windows protection that checks where the program's indirect calls go.
- On macOS, a component the app uses to talk to the system is updated to fix a known memory-safety problem.
- Release builds leave out the program's internal symbol names, which makes the app a little smaller.

### Releases

- Each release includes a software bill of materials listing every library the app is built from, with its license.
- Each release also carries its build provenance as files, which say where and how it was built.

## 0.2.1

### Patch Changes

- The library that cleans emails is updated with a security fix for math and drawing (SVG) markup. The app already removed that markup from emails, so nothing looks different.

- With the preview collapsed, archiving or deleting a conversation selects the next one without opening the preview again.

- Meeting invitations from Outlook now show their time in your own time zone, with the end time, like other invitations.

- In a narrow window, the line you're typing in a reply no longer ends up hidden under the formatting and Send bar.

- Clicking the folder you're already in no longer closes the preview and clears the selection; during a search it clears the search, as the search box's clear button does.

- While you write a reply, the AI summary above the conversation no longer blinks each time the reply is saved, which moved the reply and put a click's cursor on the wrong line.

- Moving a conversation to Trash now takes it out of the Inbox at once, and restoring it puts it in All Mail, as Gmail does, instead of briefly showing it in the Inbox again. Move to Inbox on a conversation in Trash now takes it out of the Trash too, and Undo puts it back. Swiping left in Trash now does the same.

- A draft in Trash now opens in the composer, as in Gmail, instead of saying it's no longer in Gmail.

- In a search that includes Spam and Trash, moving a conversation to Trash or Spam, restoring it, or undoing either now keeps it in the results and leaves the preview as it was.

- In the Unread view, a conversation you open stays in the list, shown as read, until you leave the view, instead of disappearing as soon as you open it.

## 0.2.1-beta.0

### Patch Changes

- With the preview collapsed, archiving or deleting a conversation selects the next one without opening the preview again.

- Meeting invitations from Outlook now show their time in your own time zone, with the end time, like other invitations.

- In a narrow window, the line you're typing in a reply no longer ends up hidden under the formatting and Send bar.

- Clicking the folder you're already in no longer closes the preview and clears the selection; during a search it clears the search, as the search box's clear button does.

- While you write a reply, the AI summary above the conversation no longer blinks each time the reply is saved, which moved the reply and put a click's cursor on the wrong line.

- Moving a conversation to Trash now takes it out of the Inbox at once, and restoring it puts it in All Mail, as Gmail does, instead of briefly showing it in the Inbox again. Move to Inbox on a conversation in Trash now takes it out of the Trash too, and Undo puts it back. Swiping left in Trash now does the same.

- A draft in Trash now opens in the composer, as in Gmail, instead of saying it's no longer in Gmail.

- In a search that includes Spam and Trash, moving a conversation to Trash or Spam, restoring it, or undoing either now keeps it in the results and leaves the preview as it was.

- In the Unread view, a conversation you open stays in the list, shown as read, until you leave the view, instead of disappearing as soon as you open it.

## 0.2.0

### Minor Changes

- Settings → Accounts can now delete all the app's data: every account, its mail and downloaded files, summaries and settings, so it starts over as on a first launch.

- Settings → AI has a switch, "Keep saved summaries". Turn it off and summaries are forgotten when the app quits instead of staying saved until they are written again or cleared.

- Removing an account now also ends its sign-in at Google and deletes the images downloaded for its mail.

- Settings has a new Privacy page that lists everything that leaves your computer (Google, image hosts, update checks, Claude or ChatGPT, AI apps) with its current setting and a button to the place where you change it.

- An open email has a Details button that shows everyone it was sent to, in full, so a long list of recipients can be read without widening the window.

- Settings → About has an update channel: Stable, as before, or Beta, which also offers test versions before they are released to everyone.

- Settings → AI now reminds you, under Summaries and under Writing, that Claude or ChatGPT may use what it receives to train its models, and recommends turning that off in its privacy settings.

### Patch Changes

- New sign-ins now ask Google for calendar access only to calendars you own, which is all that answering invitations needs, and accounts already signed in don't have to sign in again.

- A conversation's summary should be less likely to start with words copied from the app's own instructions, such as a made-up reply or a "Newest message" label.

- An email that is a sign-in code now gets the list line "Sign-in code" instead of a summary that could say it was already verified, summaries no longer say a code was already used, and long tracking links are left out of what summaries read.

- Email backgrounds and styles are cleaned more strictly: image addresses with unsafe schemes, and ones pointing at the app's own link handler, are now removed. None of them could load before either, so nothing looks different.

- Quotes in emails no longer keep their hidden source address, which nothing used; nothing looks different.

- A click anywhere under a new message's text now puts the cursor in the message.

- A new reply no longer stops being kept in view because of its own scrolling.

- A sign-in code is now found in more emails: one that stands alone with only "this code expires" wording nearby, even behind a very long link.

- A changed Google profile picture or name now updates in the app by itself, without signing in again.

- Updated the library behind the connection for AI apps to its latest version, which fixes a memory-use flaw in a part this app does not use.

- A readability pass on the app's own text, so labels and messages read consistently.

- A sign-in code that Gmail's short preview cuts off now also shows on the conversation's row and in the new-mail banner, once the email's text has been downloaded.

- Removing your last account now leaves you in Settings → Accounts, ready to add another, instead of starting the welcome screens again.

- The "Remove account" setting now says that it also asks Google to end the account's sign-in.

- A new reply no longer ends a few pixels below the bottom of the reader on a slower computer.

- A reply opened with Reply with AI on a slow computer no longer stops part way below the bottom of the reader.

- A click anywhere in the signature editor's box now puts the cursor in the signature.

- Choosing Claude or ChatGPT to summarize a conversation now starts the summary as a Summarize button, so nothing is sent until you press it. You can still choose Automatically.

- A conversation moved to Spam or Trash while its automatic summary is being prepared is now checked again before anything is sent to an AI provider.

- Settings → Privacy now says how much of the downloaded images is kept and what happens beyond that.

- A sideways swipe on the trackpad no longer drags the whole window sideways, for example after archiving the last email by swipe.

- Saving an attachment, an image or an email's original now copes with unusual names: very long ones, ones Windows reserves, and ones with hidden text-direction characters that could disguise a file's type.

- Images in emails now show at the size the sender chose, such as a logo set by its height, instead of at their full size, so they look as they do in Gmail.

- A click anywhere in the vacation reply's message box now puts the cursor in the message.

- Turning the vacation reply off or on again no longer erases the text of its message.

## 0.2.0-beta.2

### Patch Changes

- A click anywhere under a new message's text now puts the cursor in the message.

- A new reply no longer stops being kept in view because of its own scrolling.

- The "Remove account" setting now says that it also asks Google to end the account's sign-in.

- A new reply no longer ends a few pixels below the bottom of the reader on a slower computer.

- A reply opened with Reply with AI on a slow computer no longer stops part way below the bottom of the reader.

- A click anywhere in the signature editor's box now puts the cursor in the signature.

- A conversation moved to Spam or Trash while its automatic summary is being prepared is now checked again before anything is sent to an AI provider.

- A click anywhere in the vacation reply's message box now puts the cursor in the message.

- Turning the vacation reply off or on again no longer erases the text of its message.

## 0.2.0-beta.1

### Minor Changes

- Settings → AI has a switch, "Keep saved summaries". Turn it off and summaries are forgotten when the app quits instead of staying saved until they are written again or cleared.

- Settings has a new Privacy page that lists everything that leaves your computer (Google, image hosts, update checks, Claude or ChatGPT, AI apps) with its current setting and a button to the place where you change it.

### Patch Changes

- An email that is a sign-in code now gets the list line "Sign-in code" instead of a summary that could say it was already verified, summaries no longer say a code was already used, and long tracking links are left out of what summaries read.

- A sign-in code that Gmail's short preview cuts off now also shows on the conversation's row and in the new-mail banner, once the email's text has been downloaded.

- Choosing Claude or ChatGPT to summarize a conversation now starts the summary as a Summarize button, so nothing is sent until you press it. You can still choose Automatically.

- Settings → Privacy now says how much of the downloaded images is kept and what happens beyond that.

## 0.2.0-beta.0

### Minor Changes

- Settings → Accounts can now delete all the app's data: every account, its mail and downloaded files, summaries and settings, so it starts over as on a first launch.

- Removing an account now also ends its sign-in at Google and deletes the images downloaded for its mail.

- An open email has a Details button that shows everyone it was sent to, in full, so a long list of recipients can be read without widening the window.

- Settings → About has an update channel: Stable, as before, or Beta, which also offers test versions before they are released to everyone.

- Settings → AI now reminds you, under Summaries and under Writing, that Claude or ChatGPT may use what it receives to train its models, and recommends turning that off in its privacy settings.

### Patch Changes

- A conversation's summary should be less likely to start with words copied from the app's own instructions, such as a made-up reply or a "Newest message" label.

- Email backgrounds and styles are cleaned more strictly: image addresses with unsafe schemes, and ones pointing at the app's own link handler, are now removed. None of them could load before either, so nothing looks different.

- Quotes in emails no longer keep their hidden source address, which nothing used; nothing looks different.

- A sign-in code is now found in more emails: one that stands alone with only "this code expires" wording nearby, even behind a very long link.

- A changed Google profile picture or name now updates in the app by itself, without signing in again.

- Updated the library behind the connection for AI apps to its latest version, which fixes a memory-use flaw in a part this app does not use.

- A readability pass on the app's own text, so labels and messages read consistently.

- Removing your last account now leaves you in Settings → Accounts, ready to add another, instead of starting the welcome screens again.

- A sideways swipe on the trackpad no longer drags the whole window sideways, for example after archiving the last email by swipe.

- Saving an attachment, an image or an email's original now copes with unusual names: very long ones, ones Windows reserves, and ones with hidden text-direction characters that could disguise a file's type.

- Images in emails now show at the size the sender chose, such as a logo set by its height, instead of at their full size, so they look as they do in Gmail.

## 0.1.0

### Minor Changes

- One inbox for all your Gmail accounts, each with its own colour, and threads never merge across accounts.

- Keyboard shortcuts that follow Gmail's, and a command palette.

- Instant search across every account, with Gmail's own search merged in.

- Mail is cleaned and shown in a sandbox with no scripts, and known tracking pixels are removed.

- Filters, signatures, a vacation reply, undo send, sign-in code pills, and Yes, Maybe and No replies to meeting invitations.

- Optional AI for summaries, writing help, reply ideas and translation, through Apple Intelligence or your own Claude or ChatGPT subscription.

- Optional access for AI apps to search and read mail and save drafts. It never sends, and it is off until you turn it on.

- The app checks for updates and installs one when you choose to.

## 0.0.2

A second test release, to try an update from 0.0.1. Nothing in it is meant for use yet.

## 0.0.1

A test release, to try the build, signing and publishing steps. Nothing in it is meant for use yet.
