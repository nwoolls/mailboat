# Google verification

What Google asks for when the app moves from Testing to production, and the
answers, written from what the code does (`crates/core/src/auth/oauth.rs`
for the permissions, the modules named below for how each is used). Keep it
true: when a permission or its use changes, change this page, the privacy
policy (`website/privacy.html`) and the demo video together.

The submission is made from a Google Cloud project that belongs to the
project, not to a person, in its own organization. The app's name, logo,
home page, privacy policy and terms are on the Branding page, and the
domain is verified in Google Search Console.

## Order

1. The site is live (home page, privacy policy, terms).
2. Publish the app to production (Google Auth Platform → Audience). From then
   on people see "Google hasn't verified this app" until verification
   finishes, and the app is capped at 100 users.
3. Fill in the Verification Center: a reason for each permission (below), the
   demo video, and the contact details.
4. Submit, then answer Google's questions by email. Restricted permissions
   (Gmail) can take weeks.

## The eight permissions

Mailboat is an email app that runs on the user's computer. It has no server:
mail goes from Google to the computer and is kept there. These are the
reasons, ready to paste.

**`https://www.googleapis.com/auth/gmail.modify`** (restricted)
Mailboat is an email client. It reads the user's mail to show it (messages,
conversations, labels and the history that keeps the local copy current),
changes it when the user asks (archive, move to Trash, star, mark read or
unread, label), saves drafts, and sends the messages the user writes. No
narrower permission does this: read-only access can't archive or label,
and the send and compose permissions can't read. Mail is downloaded to the
user's own computer and kept in a local database; it is not sent to any
server of ours.

**`https://www.googleapis.com/auth/gmail.settings.basic`** (restricted)
Lets the user edit three things that live in Gmail's settings from inside the
app: filters (rules), the signature for each address they send from, and the
vacation reply. Because Google stores them, filters and the vacation reply
keep working when the app is closed. The app reads and writes them when the
user opens Settings → Rules, Signatures or Vacation responder to edit them. It
also reads the account's "Send mail as" addresses and their signatures while
it syncs (at start-up and sign-in), so the composer can offer them when the
user writes.

**`https://www.googleapis.com/auth/calendar.events`** (sensitive)
Answers meeting invitations in the email, as Gmail does. When a message holds
a calendar invitation, the app finds the event on the user's primary
calendar by its iCalendar ID, shows the user's current answer and any events
it clashes with, and sets the answer (Yes, Maybe or No) when the user
chooses. If the invitation isn't on the calendar yet, the app adds that one
event first, then records the answer. It works only on the primary calendar: it adds or answers the event in the
message, and reads nearby events to show clashes. For an invitation that was
cancelled and is still on the calendar, it removes that event when the user
presses "Remove from calendar".

**`https://www.googleapis.com/auth/contacts.readonly`** (sensitive)
Suggests addresses while the user writes a message, by matching what they
type against their saved contacts. Read-only. The list stays on the
computer and is never uploaded.

**`https://www.googleapis.com/auth/contacts.other.readonly`** (sensitive)
The same suggestions from "Other contacts", the addresses Google saved
automatically from the user's mail. Read-only, kept on the computer.

**`openid`, `https://www.googleapis.com/auth/userinfo.email`,
`https://www.googleapis.com/auth/userinfo.profile`** (basic)
Identify the account being added: its address and picture, shown for the
account in the app's sidebar and used to keep accounts apart, and its name,
which the app uses as the sender's name when Gmail leaves it blank.

## What happens to the data

- Mail and Google data are stored on the user's computer, not on any server
  of the project's, apart from the transfers listed below that the user turns
  on. Refresh tokens are in the system keychain, never in a file. Removing an
  account deletes its token and its mail cache. Remote images the app
  downloaded stay in a cache the accounts share, until newer ones push them
  out or the user clears it in Settings.
- No Mailboat server, account or analytics. The developer never receives mail
  or Google data.
- The project does not sell it, use it for advertising or use it to train AI models, and no person on the project reads it.
- Mail reaches an AI provider only when the user has chosen that provider for
  a feature, in Settings → AI (the conversation's text is sent to write its
  summary when a long conversation is opened while the summary setting is
  Automatic; each conversation that scrolls into view is sent for the list's
  summaries when the user turns those on). Apple
  Intelligence runs on the Mac. The MCP server for AI apps is off for every
  account until the user turns it on, shares neither Spam nor Trash, and
  cannot send mail.
- The use of information from Google APIs adheres to the Google API Services
  User Data Policy, including the Limited Use requirements.

## Demo video

Unlisted on YouTube, in English, recorded on a screen with the browser's
address bar visible. Use a dedicated test Google account with made-up mail
(never anyone's real mailbox), and keep the real account out of the frame.

1. Add an account. Show the whole Google sign-in address with the **client ID
   in it**, the app name and logo, the list of permissions, and the grant.
2. The inbox loads. Archive one conversation, label another, write a message
   and send it, then save another as a draft. (Gmail permission.)
3. Settings → Rules: edit a rule. Signatures: change one. Vacation responder:
   turn it on and off. (Gmail settings permission.)
4. Open a meeting invitation, answer Yes, then show the event on Google
   Calendar. (Calendar permission.)
5. Write a message and type a name: the suggestions appear. (Contacts
   permissions.)
6. Show the account's address and picture in the sidebar. (Basic permissions.)
7. Show Settings → AI with the providers, the privacy policy page, and
   removing the account.

## Status

Updated as each piece is done.

- [x] Search Console: domain `getmailboat.app` verified (2026-11-07)
- [x] Cloud project, APIs enabled (Gmail, Calendar, People)
- [x] Branding: name, logo, home page, privacy policy, terms, domain, contacts
- [x] Data Access: the eight permissions (both Gmail permissions are restricted)
- [x] Desktop OAuth client created
- [ ] The site live at `getmailboat.app`
- [ ] Publish to production
- [ ] Demo video recorded and uploaded
- [ ] Verification Center filled in and submitted
