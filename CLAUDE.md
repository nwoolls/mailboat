# Mailboat — agent instructions

Mailboat is a cross-platform desktop Gmail client (macOS first, then Windows).
It uses the Gmail REST API directly and is keyboard-first, with a calm,
minimal look (MonoCode × Notion Mail).

Agents write all the code, so:

- Make work checkable: tests, type checks and the linter must pass, and you
  report their real output. Never claim something works without running it.
- Explain decisions in plain language. Never leave the owner to debug by hand.

## Docs to keep current

- `docs/ROADMAP.md`: every milestone item, ticked when done. Update it in the
  same commit as the work. If something moves between milestones, move it
  there with a note; nothing may silently drop off.
- `docs/ARCHITECTURE.md`: how the app works, plus a dated decisions table.
  Add a row when you make a choice a future agent might second-guess
  (a library, a limit, a security trade-off).
- `README.md`: setup and run instructions for people.

## Conventions

Rust:
- Errors are `mailboat_core::CoreError`; commands convert them to `AppError`
  (`kind` + `message`). No `unwrap()` outside tests except on mutex locks.
- Never hold the database lock (`db.conn()`) across an `.await`, and never
  take it inside a `for`, `match` or `if let` header: bind the result to a
  variable first. A temporary in a `for` header deadlocked app startup.
- Logic and its tests live in `crates/core`. Unit tests in `#[cfg(test)]`
  modules; Gmail behavior tests in `crates/core/tests/` against fixtures.
- Diagnostics go to the sync log. Never log email content or tokens.
- Prefer a maintained crate for security-sensitive or standard protocols;
  record the choice (or why not) in the ARCHITECTURE decisions table.

TypeScript:
- Feature code in `src/features/<name>/model` (pure logic, Vitest tests next
  to it) and `src/features/<name>/ui` (thin components).
- Data comes through TanStack Query hooks in `src/shared/lib/queries.ts`;
  call commands as `unwrap(commands.x(...))`.
- Derive state during render instead of setting state in effects (the
  linter enforces this).

Commits: one topic each, imperative subject, a body that explains why.
- Make small, focused commits with clear messages.

## Commands

| What | Command |
|---|---|
| Install JS deps | `bun install` |
| Run the app | `bun tauri dev` |
| Everything (run before calling work done) | `bun run check` |
| Web checks only (format, lint, types, Vitest) | `bun run check:web` |
| Rust checks only (fmt, clippy, cargo test) | `bun run check:rust` |
| Rust tests only | `cargo test --workspace` |
| Frontend tests only | `bun run test` |
| Format TS | `bun run fmt` |
| Regenerate TS bindings | `cargo test -p mailboat bindings` |
| Regenerate app icons (needs Xcode) | `scripts/build-app-icon.sh` |

### macOS keychain prompts in dev

macOS grants keychain access per exact build, so unsigned dev builds trigger
"mailboat wants to use your confidential information" after every Rust rebuild.
`.cargo/config.toml` runs `scripts/dev-run.sh`, which wraps the dev binary
in `target/debug/Mailboat.app` (so the Dock shows the real macOS icon) and signs
it with the owner's Apple Development certificate (free Apple ID: Xcode →
Settings → Accounts → Manage Certificates → + Apple Development). With it,
"Always Allow" persists across rebuilds. Without it, the script prints a
note and runs unsigned. Override the identity with `MAILBOAT_DEV_SIGNING_IDENTITY`.

Bun is the only package manager. Never run npm, yarn or pnpm, and never create
a second lockfile. Bun is installed with Homebrew (`brew install oven-sh/bun/bun`);
the version is recorded in `package.json` (`packageManager`, `engines`).

## Stack (decided — ask before changing)

- Tauri v2 (Rust) + React + TypeScript + Vite, Tailwind for styling.
- SQLite via `rusqlite` (bundled) with FTS5 for cache and search.
- `tauri-specta` generates `src/platform/tauri/bindings.ts` from Rust. Never
  edit that file by hand. A test fails if it is out of date.
- TanStack Query (IPC result caching), TanStack Virtual (lists), cmdk (palette,
  later), TipTap (composer, later).
- OS keychain (`keyring` crate) for OAuth refresh tokens. Never store tokens
  in SQLite or plain files. Access tokens live in memory only.

## Layout

```
crates/core/   Pure Rust, no Tauri: db, gmail client, sync, auth, mail sanitizing.
               All sync/storage/query logic lives here and is tested here.
src-tauri/     Thin Tauri layer: commands, events, capabilities, app setup.
src/           React UI, MonoCode layout: app/, features/<name>/{model,ui}, platform/, shared/.
```

Rust owns sync, storage, auth, sending and search. UI logic lives in TS.

## Reference repos

When unsure how to do something, do what these do, and say which you followed:

- `the MonoCode project` — Tauri app. Project layout, command registration,
  SQLite setup, settings, packaging, visual language.
- `the Synara project` — Bun tooling and config (it is an Electron app, so
  only copy tooling from it).

## Multi-account rules (non-negotiable)

1. Every Gmail-derived record has an `account_id`. Gmail IDs (message, thread,
   label, historyId) are only unique per account. Tables use a surrogate
   integer `id` plus `UNIQUE(account_id, gmail_*_id)`. No table, map, cache or
   frontend store is keyed by a Gmail ID alone; the frontend uses surrogate IDs.
2. The unified inbox is a query, not a copy. Every list view goes through one
   query layer (`mailboat_core::db::query`) that takes an account filter
   (all / some / one).
3. System labels (INBOX, UNREAD, STARRED, IMPORTANT, SENT, DRAFT, SPAM, TRASH)
   unify across accounts. User labels stay per account, even with equal names.
4. Each account syncs independently: own worker, historyId cursor, backoff and
   error state. One failing account never blocks others or the UI.
5. Actions resolve the owning account and use that account's token. Bulk
   actions spanning accounts are split per account.
6. Show which account each item belongs to (account color on rows). Compose
   defaults From to the conversation's account.
7. Local FTS covers all accounts. Remote `q=` search fans out per account and
   merges by date.
8. Threads never merge across accounts.

The test `two_accounts_with_overlapping_gmail_ids` in `crates/core` guards
these rules. Keep it passing.

## Gmail / Google

- Gmail REST API only (no IMAP). Initial full sync, then `history.list`.
  An expired historyId (404) triggers a full resync.
- OAuth: desktop loopback redirect + PKCE. Scopes: `gmail.modify`,
  `gmail.compose`, `openid email profile`.
- The OAuth client is an External app "In production", unverified (personal
  use, <100 users). Each account clicks through Google's unverified-app
  warning once. Each account records which OAuth client it used
  (`accounts.oauth_client`) so a second, Internal client can be added later.
- Credentials are never committed. The app reads Google's downloaded client
  JSON from `~/Library/Application Support/com.nwoolls.mailboat/google-oauth-client.json`
  (Windows: `%APPDATA%\com.nwoolls.mailboat\`), or from env vars
  `MAILBOAT_GOOGLE_CLIENT_ID` / `MAILBOAT_GOOGLE_CLIENT_SECRET`.
- Respect quotas: batch requests, exponential backoff on 429/5xx. The
  owner's Cloud project allows 6,000 Gmail units per minute per user (not
  the documented 15,000); Google enforces it as ~100 units/second with
  almost no burst, so `QuotaPacer` defaults to 60 units/s with 60-unit
  bursts, batches hold 5 requests, and the rate halves on rate-limit errors. Diagnostics: `~/Library/Logs/com.nwoolls.mailboat/sync.log`.

## Security

- Email HTML is sanitized in Rust (`mailboat_core::mail::sanitize`), then shown
  in an `<iframe sandbox>` without `allow-scripts`, with a per-message CSP.
- Remote images load by default (owner's decision, 2026-10-15), except in
  Spam (always blocked, even for allowed senders) and Trash (blocked unless
  the sender is allowed). A per-sender "load" or "block" choice is
  remembered by address (global, not per account) and wins outside Spam.
  Known tracking pixels are always removed. The rule lives in
  `mailboat_core::mail::images`.
- Tauri capabilities stay as narrow as possible. Do not add plugins or
  permissions to the web side without a reason recorded in the commit.

## Testing

- Rust: `cargo test` against Gmail API JSON fixtures in
  `crates/core/tests/fixtures/gmail/`, with `wiremock` standing in for Google.
- Frontend logic: Vitest, files named `*.test.ts(x)` next to the code.

## Future direction (don't build yet)

AI-drafted replies via user-supplied OpenAI/Anthropic API keys. Keys would go
in the OS keychain like Google tokens; sending an email to a model is always
an explicit user action. Plain-text bodies are already stored for this.

An MCP server exposing Mailboat's mail to AI apps (see `docs/ROADMAP.md`,
Later): off by default, read-only first, never sends.
