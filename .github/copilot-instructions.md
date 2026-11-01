# Review instructions

This is a desktop Gmail client (Tauri: Rust core, React UI). When reviewing a
pull request, check these first, in this order, and say so plainly when one
is broken.

## Must never happen

- **Mail content, prompts, AI answers or tokens in logs.**
  Diagnostics go to the sync log and must never include email content.
- **Tokens outside the OS keychain.** Refresh tokens are never stored in
  SQLite, files or the frontend. Access tokens live in memory only.
- **Email HTML shown without the Rust sanitizer** (`mail::sanitize`), or in an
  iframe that allows scripts.
- **Anything that sends mail or acts on it without the owner seeing it first**
  (AI output goes to the editor, never straight to send).
- **New Tauri permissions or plugins** without a reason in the commit message.
- **Real mail details** anywhere: in code, comments, tests, fixtures, docs, bug notes, commit messages or screenshots. That means real senders, people, companies, subjects, message text, labels, counts or timings measured on a real mailbox, and anything that names the real source of an email. This is an email app and examples will come from real mail; they must be made generic or made up.
- **Secrets, OAuth client files, or real email addresses and names** committed.
  Test data uses reserved domains (`example.com`, `.example`) and made-up names.

## Multi-account rules

Every Gmail-derived record carries an `account_id`; Gmail IDs are only unique
per account. Flag any table, map, cache or frontend store keyed by a Gmail ID
alone, any threads merged across accounts, and any action that doesn't use the
owning account's token. List views must go through the one query layer
(`mail_core::db::query`).

## Rust

- Errors are `mail_core::CoreError`; no `unwrap()` outside tests except on
  mutex locks.
- The database lock (`db.conn()`) is never held across an `.await`, and never
  taken inside a `for`, `match` or `if let` header (that deadlocked startup).
- Logic and its tests live in `crates/core`; the Tauri layer stays thin.

## TypeScript

- Feature code in `src/features/<name>/model` (pure logic, with Vitest tests
  next to it) and `ui` (thin components). Data comes through the TanStack Query
  hooks as `unwrap(commands.x(...))`.
- State is derived during render, not set in effects.
- `src/platform/tauri/bindings.ts` is generated; flag hand edits.

## Not worth a comment

Formatting and lint issues (the checks enforce them), and personal style.
Prefer a few comments that matter over many that don't.
