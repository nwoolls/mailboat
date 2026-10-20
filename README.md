# Mailboat

A fast, keyboard-first desktop Gmail client for macOS (Windows later). It
talks to the Gmail API directly, keeps a local cache for instant browsing and
search, and supports several Google accounts with a unified inbox.

Status: early development. See [docs/ROADMAP.md](docs/ROADMAP.md) for what
works today and what is next, and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
for how it is built.

## Requirements

- macOS with Xcode command line tools (its Swift compiler builds the
  Apple Intelligence helper; Apple Intelligence itself needs macOS 26+)
- [Rust](https://rustup.rs) (stable)
- [Bun](https://bun.sh): `brew install oven-sh/bun/bun`
- Optional but recommended: an Apple Development certificate (free Apple ID,
  Xcode → Settings → Accounts → Manage Certificates → + Apple Development),
  so macOS doesn't ask for keychain access after every rebuild.

## Google setup (once)

Mailboat uses your own Google OAuth client, so no app review is needed.

1. In [Google Cloud Console](https://console.cloud.google.com), create a
   project and enable the **Gmail API**, the **People API** (address
   suggestions from Google Contacts; Mailboat works without it, suggesting
   only from mail) and the **Google Calendar API** (answering meeting
   invitations; not "CalDAV API" or the MCP ones).
2. Configure the OAuth consent screen as **External** and set it to
   **In production** (Testing mode expires sign-ins every 7 days).
3. Create an OAuth client ID of type **Desktop app** and download its JSON.
4. Save the file as
   `~/Library/Application Support/com.nwoolls.mailboat/google-oauth-client.json`.
   It is never committed. Alternatively set `MAILBOAT_GOOGLE_CLIENT_ID` and
   `MAILBOAT_GOOGLE_CLIENT_SECRET`.

When you sign in, Google warns that the app isn't verified. Click
**Advanced → Go to Mailboat**. This happens once per account.

Accounts added before Mailboat asked for a permission (Google Contacts,
Calendar events for invitations, Gmail settings for rules and
signatures) keep working without it. Settings → Accounts says which
features an account is missing; **Sign in again** there (or the + in the
sidebar, same Google account) and the consent screen asks for them once.

## AI (optional)

Settings → AI. Summaries and writing help use **Apple Intelligence** by
default: nothing to set up beyond turning it on in System Settings →
Apple Intelligence & Siri, and mail stays on the Mac.

To use **Claude** or **ChatGPT** instead, install its command-line tool,
then press Connect in Settings → AI; the tool's own sign-in opens in the
browser and uses your subscription (no API key):

| Provider | Install | Signs in with |
|---|---|---|
| Claude | [Claude Code](https://claude.com/product/claude-code) (`claude`) | `claude auth login` |
| ChatGPT | [Codex CLI](https://developers.openai.com/codex/cli) (`codex`) | `codex login` |

If Connect's browser sign-in doesn't finish, run the sign-in command in
Terminal once, then press Connect again. Disconnecting only stops Mailboat
using it; the tool stays signed in.

To check all three from Terminal after building once:
`cargo test -p mailboat-core --test ai_live -- --ignored --nocapture`.

## Run

```sh
bun install
bun tauri dev
```

The first sync of an account takes a while (Gmail's per-user quota limits
the pace); the inbox fills in first. Later syncs only fetch changes.

## Check

```sh
bun run check   # format, lint, type check, Vitest, clippy, cargo test
```

## Files on your Mac

| What | Where |
|---|---|
| Mail cache (SQLite) | `~/Library/Application Support/com.nwoolls.mailboat/mailboat.sqlite3` |
| OAuth client file | `~/Library/Application Support/com.nwoolls.mailboat/google-oauth-client.json` |
| Sign-in tokens | macOS Keychain, service `com.nwoolls.mailboat` |
| Sync log | `~/Library/Logs/com.nwoolls.mailboat/sync.log` |
| AI summaries and usage | In the mail cache (`ai_summaries`, `ai_usage`: sizes only, never content) |
