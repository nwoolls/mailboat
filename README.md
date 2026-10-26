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
`cargo test -p mail-core --test ai_live -- --ignored --nocapture`.

### AI apps (Claude Desktop, Claude Code)

Mailboat can let AI apps search and read your mail (and save drafts) over
MCP, while Mailboat is open. In Settings → AI → AI apps, turn on the
accounts to share (all are off to begin with), then press Connect for
Claude Code or Claude Desktop (quit and reopen Claude Desktop after).
Any other MCP app can run `<Mailboat's program> --mcp`; Settings shows the
exact command. Spam and Trash are never shared, nothing is ever sent,
and Settings lists what was asked for.

## Run

```sh
bun install
bun tauri dev
```

The first sync of an account takes a while (Gmail's per-user quota limits
the pace); the inbox fills in first. Later syncs only fetch changes.

## Windows (built on the Mac)

Mailboat for Windows is built on the Mac and tried in a Windows VM. One-time
setup:

```sh
rustup target add aarch64-pc-windows-msvc x86_64-pc-windows-msvc
brew install llvm lld nsis
cargo install cargo-xwin --locked
```

Then:

```sh
scripts/windows.sh check   # does it compile for Windows, with no lint warnings
scripts/windows.sh build   # makes the installer (.exe)
```

The installer lands in `target/aarch64-pc-windows-msvc/release/bundle/nsis/`.
Copy it into the VM and run it. It's for Windows on ARM (a VM on an Apple
silicon Mac); for an Intel/AMD PC, set
`WINDOWS_TARGET=x86_64-pc-windows-msvc` first. The Google client file
goes in `%APPDATA%\com.nwoolls.mailboat\google-oauth-client.json`.

The installer registers Mailboat as an email app. To have email links open
it, choose Mailboat for `MAILTO` in Settings → Apps → Default apps (Mailboat's
Settings → General → Email links opens that page).

## Check

```sh
bun run check:quick   # while working: only what changed, fast tests only
bun run check         # everything (format, lint, types, Vitest, clippy, cargo test, Playwright); before committing
```

The browser tests (`tests/browser`, Playwright in WebKit) need WebKit once:

```sh
bunx playwright install webkit
```

## Files on your Mac

| What | Where |
|---|---|
| Mail cache (SQLite) | `~/Library/Application Support/com.nwoolls.mailboat/mailboat.sqlite3` |
| OAuth client file | `~/Library/Application Support/com.nwoolls.mailboat/google-oauth-client.json` |
| Sign-in tokens | macOS Keychain, service `com.nwoolls.mailboat` |
| Sync log | `~/Library/Logs/com.nwoolls.mailboat/sync.log` |
| AI summaries and usage | In the mail cache (`ai_summaries`, `ai_usage`: sizes only, never content) |
| AI apps' socket | `~/Library/Application Support/com.nwoolls.mailboat/mcp.sock` (while Mailboat runs) |
| AI apps' requests | In the mail cache (`mcp_log`: what was asked, never content; 30 days) |
