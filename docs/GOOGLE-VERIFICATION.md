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
3. Verify the branding and publish it (Google Auth Platform → Branding →
   Verify branding, then Publish branding). The data-access step of the
   Verification Center stays locked until this is done, and a verified result
   that isn't published within 7 days expires.
4. Fill in the Verification Center: a reason for each permission (below), the
   demo video, and the contact details.
5. Submit, then answer Google's questions by email. Restricted permissions
   (Gmail) can take weeks.
6. Expect a question about a security assessment (CASA). Google requires one
   when an app can reach restricted data from or through a third-party server.
   This app has no server of the project's; mail leaves the computer only for a
   provider the user chose (an AI provider, an AI app). The answer is to say so
   and ask to be exempt (see `docs/RELEASE.md`). If Google insists, the
   assessment is yearly and paid. Google decides; nothing here promises it.

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
keep working when the app is closed. The app reads three things: the
account's "Send mail as" addresses and their signatures while it syncs (at
start-up and sign-in), so the composer can offer them; the vacation reply's
state, so the main window can show that it is on; and the filters, when the
user opens Settings → Rules. It writes only when the user saves a change in
Settings → Rules, Signatures or Vacation responder.

**`https://www.googleapis.com/auth/calendar.events`** (sensitive)
Answers meeting invitations in the email, as Gmail does. When a message holds
a calendar invitation, the app finds the event on the user's primary
calendar by its iCalendar ID, shows the user's current answer and any events
it clashes with, and sets the answer (Yes, Maybe or No) when the user
chooses. If the invitation isn't on the calendar yet, the app adds that one
event first, then records the answer. It works only on the primary calendar: it adds or answers the event in the
message, and reads nearby events to show clashes. For an invitation that was
canceled and is still on the calendar, it removes that event when the user
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
- The project does not sell it, use it for advertising or use it to train AI
  models, and does not read it except where the user agrees, or for security,
  legal or support reasons that Google's Limited Use rules allow.
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

The script answers the rows of Google's checklist email (2026-11-09): the
consent screen with every permission expanded, each permission's use shown,
and, for every write, the result in the Google account itself. Record it on
the stable 0.2.0, so it shows what the policy describes. About 9 to 11
minutes, with a caption naming the permission in each scene.

0. A title card (about 5 seconds) listing the permissions the app asks for.
1. The website: the home page, the privacy policy link and the Download
   buttons (not clicked). This is the entry point.
2. First launch: give the app the client file, Add account, Sign in. At the
   account chooser, expand the address bar so `client_id=` shows. Then the
   "hasn't verified this app" screen, then the consent screen with **every
   permission expanded**, Select all, Continue, and the account syncing.
3. Gmail, read and change (`gmail.modify`): archive, label, send, save a
   draft, move to Trash. After each, cut to Gmail on the web: All Mail, the
   label, Sent, Drafts, Trash.
4. Gmail settings (`gmail.settings.basic`): edit a rule, change the
   signature, turn the vacation reply on and off. Cut to Gmail's Settings:
   Filters, the signature, the vacation responder.
5. Calendar (`calendar.events.owned`): answer an invitation; answer one
   that isn't on the calendar yet, which the app adds first and then
   records the answer; remove a cancelled one. Cut to Google Calendar after
   each.
6. Contacts (`contacts.readonly`, `contacts.other.readonly`): write a
   message and type a name from saved contacts, then a name that is only in
   Other contacts. Cut to Google Contacts and its "Other contacts" page,
   showing both people.
7. Basic profile (`openid`, `email`, `profile`): the address and picture in
   the sidebar.
8. Settings → Privacy, and Settings → AI: Apple Intelligence on the Mac by
   default, a cloud provider only if chosen (with the warning that it may
   train), AI apps off.
9. Settings → Accounts → Remove, then "Delete all data". Cut to
   `myaccount.google.com/permissions`: the app no longer appears.

Set up before recording:

- Remove the app's access at `myaccount.google.com/permissions`, so the
  consent list is full.
- Seed the demo mailbox: an invitation that isn't on the calendar yet, a
  cancelled invitation, a saved contact, and a contact that appears only
  under Other contacts.
- Windows sized alike (the app, the browser), Do Not Disturb on, a recording
  with a fixed length.

Captions: make each as a PNG banner (Pillow) and overlay it with `ffmpeg`
(`overlay` with `enable='between(t,a,b)'`), since `ffmpeg` here has no text
filter. Note the time of each scene while recording.

### What recording it taught

The first two takes were redone, so this is what to do next time:

- Use a browser profile that is signed in to the demo account only, so the
  account chooser lists nothing else.
- The OAuth client ID is in the address of the account chooser page (it
  contains `client_id=`). Later Google pages use opaque tokens and the
  "hasn't verified this app" page shows none. Click the address bar on the
  chooser page and hold, then press Esc, so the browser's history
  suggestions don't stay on screen.
- Google collapses the permission list ("already has some access") when the
  account granted access before. Remove the app at the account's third-party
  access page (`myaccount.google.com/permissions`) first, so every permission shows with its box.
- Record the screen with a fixed length (`screencapture -v -V <seconds> <file.mov>`)
  and let it end on its own. Stopping it with a signal throws the file away.
  A take is about six minutes. Shrink it to 1080p before uploading, for example
  `ffmpeg -i take.mov -t <seconds> -vf "fps=30,scale=1920:-2" -c:v libx264
  -crf 24 -pix_fmt yuv420p -an out.mp4` (`brew install ffmpeg`); `-t` cuts
  the idle end.
- Settings edits (a rule, a signature, the vacation reply) stay in the demo
  mailbox, so use a new value in each take.
- In the first takes, removing the last account left the app at the "Make it
  yours" onboarding step. That is fixed: it now stays in Settings →
  Accounts with an empty list.

## How a reviewer tests Mailboat

Written for Google's "active test credentials" and "clear integration access"
rows. The app is In production, so a reviewer signs in with any Google
account and sees the "hasn't verified this app" screen; Continue goes on.
No test login is shared, and the demo account's password stays private.

1. Download 0.2.0 from the website (`getmailboat.app`), install it and open
   it.
2. The app has no Google client of its own, so it needs ours. The owner
   shares it privately, never on GitHub or the website: either the client
   file, or the Client ID and Client secret as text. In the app's first-run
   "Google Cloud" step, drop the file on the window, or choose "Paste ID and
   secret" and paste the two values.
3. "Add your Gmail accounts", then "Sign in with Google". In the browser
   choose an account, Continue past the unverified-app screen, tick Select
   all, Continue. The account syncs in the app.
4. To see each permission at work, with the result in the Google account:
   archive, label, send and draft a message (Gmail); Settings → Rules,
   Signatures, Vacation responder (Gmail settings); answer an invitation
   (Calendar); type a name in a new message (Contacts); Settings → Privacy.
5. Settings → Accounts → Remove ends the sign-in at Google: the app
   disappears from `myaccount.google.com/permissions`.

The steps are written from the real screens: check them against 0.2.0 once it
is out, before they go to Google. The private link, or the reply carrying the
two values, is the owner's to send. After the review, rotate the client
secret (the console's "Add secret", then disable the old one). Google's
guidance on whether a desktop app's client secret is confidential is not
consistent, so check its current documentation.

## Status

Updated as each piece is done.

- [x] Search Console: domain `getmailboat.app` verified (2026-11-07)
- [x] Cloud project, APIs enabled (Gmail, Calendar, People)
- [x] Branding: name, logo, home page, privacy policy, terms, domain, contacts
- [x] Data Access: the eight permissions (both Gmail permissions are restricted)
- [x] Desktop OAuth client created
- [x] The site live at `getmailboat.app`
- [x] Publish to production (2026-11-07)
- [x] Branding verified and published (2026-11-07)
- [x] Demo video recorded and uploaded, unlisted on YouTube (2026-11-07)
- [x] Verification Center filled in and submitted (2026-11-07). Google's
  Trust and Safety team said the first email would come within 3 to 5
  days and the whole review could take 4 to 6 weeks. Until it finishes,
  the consent screen people see is the last approved one and each
  sign-in shows "Google hasn't verified this app". Don't switch the app
  back to Testing or change the user type meanwhile: Google warns that it
  can delay the review, and a logo change after branding is verified needs
  a new review.
- [ ] Google's answer on a security assessment (exempt, or required and by when)
- [ ] Google's final decision on the permissions

Choices made on the submission form: the Gmail permissions were described
as an "Email client"; the questionnaire answers were No to personal use,
internal use, development or testing use and a WordPress plug-in; the extra
details box said there is no server of ours and asked to be treated as
exempt from the assessment. Two boxes were ticked at the end: that the
requirements were read and the app meets them, and that restricted permissions
need an assessment (every year, from an independent assessor) unless Google
agrees otherwise.
