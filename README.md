# Mailboat

A fast, keyboard-first desktop Gmail client for macOS (Windows later). It
talks to the Gmail API directly, keeps a local cache for instant browsing and
search, and supports several Google accounts with a unified inbox.

Status: early development. See [docs/ROADMAP.md](docs/ROADMAP.md) for what
works today and what is next, and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
for how it is built.

## Requirements

- macOS with Xcode command line tools
- [Rust](https://rustup.rs) (stable)
- [Bun](https://bun.sh): `brew install oven-sh/bun/bun`
- Optional but recommended: an Apple Development certificate (free Apple ID,
  Xcode → Settings → Accounts → Manage Certificates → + Apple Development),
  so macOS doesn't ask for keychain access after every rebuild.

## Google setup (once)

Mailboat uses your own Google OAuth client, so no app review is needed.

1. In [Google Cloud Console](https://console.cloud.google.com), create a
   project and enable the **Gmail API**.
2. Configure the OAuth consent screen as **External** and set it to
   **In production** (Testing mode expires sign-ins every 7 days).
3. Create an OAuth client ID of type **Desktop app** and download its JSON.
4. Save the file as
   `~/Library/Application Support/com.nwoolls.mailboat/google-oauth-client.json`.
   It is never committed. Alternatively set `MAILBOAT_GOOGLE_CLIENT_ID` and
   `MAILBOAT_GOOGLE_CLIENT_SECRET`.

When you sign in, Google warns that the app isn't verified. Click
**Advanced → Go to Mailboat**. This happens once per account.

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
