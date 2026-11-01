# Google setup

Mailboat uses your own Google OAuth client, so no app review is needed (see the README's FAQ for why).
On first launch the app walks you through it: one card per step, each
with a button that opens the right Google Cloud page, then you drop the
downloaded file on the window. In short:

1. In [Google Cloud Console](https://console.cloud.google.com), create a
   project and enable the **Gmail API**, the **People API** (address
   suggestions from Google Contacts; Mailboat works without it, suggesting
   only from mail) and the **Google Calendar API** (answering meeting
   invitations; not "CalDAV API" or the MCP ones).
2. Set up the sign-in screen (Google Auth Platform → Get started): an app
   name, your own email, and **External**. Leave it in **Testing**, and under
   **Audience → Test users** add each Gmail address you'll use in Mailboat
   (work and school accounts work too). Google can sign accounts out about
   once a week while a project is in Testing; signing in again takes a click.
3. Create an OAuth client ID of type **Desktop app** and download its JSON.
4. Give the file to the app (drop it on the window), or save it yourself as
   `~/Library/Application Support/com.nwoolls.mailboat/google-oauth-client.json`.
   It is never committed. Alternatively set `MAILBOAT_GOOGLE_CLIENT_ID` and
   `MAILBOAT_GOOGLE_CLIENT_SECRET`.

When you sign in, Google warns that the app isn't verified. Press
**Continue**: it's your own private project. On the permissions screen the
boxes start empty, so tick **Select all**. This happens once per account.

Accounts added before Mailboat asked for a permission (Google Contacts,
Calendar events for invitations, Gmail settings for rules and
signatures) keep working without it. Settings → Accounts says which
features an account is missing; **Sign in again** there (or the + in the
sidebar, same Google account) and the consent screen asks for them once.
