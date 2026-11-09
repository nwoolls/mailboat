# Changelog

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
