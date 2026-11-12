# Changelog

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
