# Mailboat — agent instructions

Mailboat is a cross-platform desktop Gmail client (macOS and Windows, Linux to
follow). It uses the Gmail REST API directly, with a calm, minimal look
(MonoCode × Notion Mail).

Agents write all the code, so:

- Make work checkable: tests, type checks and the linter must pass, and you
  report their real output. Never claim something works without running it.
- While iterating, run `bun run check:quick` (seconds to about a minute).
  Run the full `bun run check` once, before committing. Never commit
  code without it passing. A commit with no code in it (only docs such
  as `docs/`, `README.md` or this file) needs only `bun run check:privacy`
  (seconds), because docs are where real mail details leak most easily.
- Explain decisions in plain language. Never leave the owner to debug by hand.

## Real mail never goes in the repository

Mailboat is an email app, and whoever reports a bug or asks for a change
(the owner, a tester, a user) will naturally give examples from their own
mail. **None of it may be written down in the repository.** Not in code,
comments, tests, fixtures, docs, the roadmap's bug notes, commit messages,
pull request or issue text, screenshots, or logs. Once pushed, it is public
for good, and history rewrites are costly and never complete.

What counts as real mail:

- Who: senders, recipients, people's names, email addresses, usernames,
  phone numbers, companies, banks, employers, schools, or services named as
  the source of an email ("an email from <real company>").
- What: subjects, message text, snippets, labels or folders from a real
  account, attachment names, order, ticket or account numbers, links.
- Numbers measured on a real mailbox or cache: how many messages, how many
  matched, how many codes were found, a share ("2% of emails"), timings <!-- privacy-ok: an example of what not to write -->
  taken on real data, sizes, dates or times of real messages, sign-in times.
- Screenshots or descriptions of the app showing real mail or a real
  desktop. Only demo mode (`bun run demo`, made-up mail) may be pictured.

What to do instead:

- Describe the behaviour in general terms: "a newsletter that declares
  light-only but forces a white page", "a bank notice with a white box set
  inline", "a mailing list with a long recipient line". Keep what is needed
  to reproduce it, never who sent it.
- Reproduce with made-up data: people from demo mode (Maya Chen, Priya Raman,
  Jordan Park), addresses on reserved domains (`@x.example`, `example.com`),
  invented subjects, companies and numbers (phone numbers `555-01xx`).
- Made-up amounts in test data (a fake invoice total, a fake price in a
  sample email) are fine; amounts for the project's own price, fees or
  income are not written down at all.
- Qualitative wording for real-world measurements ("most", "a small share",
  "thousands of"). Numbers that are design parameters or documented limits
  (quotas, batch sizes, sync scope) are fine.
- Investigating with the owner's real mail is allowed **locally**; record the
  conclusion, never the data. A throwaway script that reads the real cache
  prints aggregates to the terminal only and is never committed with its
  output, a path to the real database, or real examples in its comments.
- If the owner pastes or attaches real mail (a screenshot, an example),
  treat it as input to read, not content to keep: do not copy it, quote it,
  or paraphrase identifying details into any file or message. Reply in
  general terms too.

How this is enforced:

- `bun run check` (and `check:quick`) run `check:privacy`
  (`scripts/check-privacy.ts`): it fails on an address at a real domain, a
  real-looking phone number, wording that reports a measurement on a real
  mailbox, and any term in the owner's local denylist
  (`~/.config/mailboat/privacy-denylist`, one term per line, never committed:
  real names, companies and domains seen in their own mail). It cannot know
  every name, so reread your diff and commit message for real details before
  committing. A rare false positive may carry the marker `privacy-ok` on
  its line, with a reason.
- Reviews (Copilot, pull requests, the owner) check for it too.
- If real mail slips in anyway: stop, tell the owner, and do not paper over
  it with a follow-up commit; removing it from history needs a rewrite.

## Docs to keep current

- `docs/ROADMAP.md`: every milestone item, ticked when done. Update it in the
  same commit as the work. If something moves between milestones, move it
  there with a note; nothing may silently drop off.
- `docs/ARCHITECTURE.md`: how the app works, plus a dated decisions table.
  Add a row when you make a choice a future agent might second-guess
  (a library, a limit, a security trade-off).
- `docs/RELEASE.md`: the release plans (closed and paid, open source,
  hybrid) and the research behind them. The owner chose the hybrid
  (2026-10-25); its work is tracked in the roadmap, Milestones 10–18.
- `README.md`: what it is and why, for people. Setup and running live in
  `docs/DEVELOPMENT.md`, Google credentials in `docs/GOOGLE-SETUP.md`, AI in
  `docs/AI.md`.

### Writing for people

Anything a person will read goes through the `unslop` skill before it is
committed: `README.md`, everything in `docs/`, `CONTRIBUTING.md`,
`SECURITY.md`, the other READMEs, and the issue and pull request templates.
Run it on the whole file when you write a new one or change one a lot, and
on the changed passages when you touch a long log (`docs/ROADMAP.md`,
`docs/ARCHITECTURE.md`, `docs/RELEASE.md`). It repairs only what is clearly
wrong, so read the diff afterwards: no fact, number, link, quoted string,
"never" or "must", or recorded decision may change. Files written for
agents (`AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md`) are
exempt. A docs-only commit still needs `bun run check:privacy`.

## Conventions

Rust:
- Errors are `mail_core::CoreError`; commands convert them to `AppError`
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

Brand: the app's name lives in `brand.json` (plus Tauri's config files,
the docs and the artwork), so a rename is one file. Rust takes it from
`mail_core::brand` (`NAME`, `SHORT_NAME`, `ID`, `ENV_PREFIX`;
`env!("BRAND_NAME")` inside `concat!` for constants), the UI from
`APP_NAME` (`src/shared/lib/brand.ts`), and comments say "the app".
Every other name is neutral. `bun run check:brand` (part of every check)
fails otherwise.

Commits: one topic each, imperative subject, a body that explains why.
- Make small, focused commits with clear messages.

### Pull requests (once the repository's ruleset is on)

Nothing goes to `main` directly. For each piece of work:

1. Branch from an up-to-date `main` (`git switch -c <topic>`), commit there
   (the checks and commit rules above still apply), and push the branch.
2. Open a pull request with `gh pr create`: what changed and why, and the
   roadmap item it ticks. One topic per pull request.
3. Wait for the checks (`gh pr checks`) and for Copilot's review. Deal with
   every review comment: fix it, or reply with why not. A failing check is
   never "flaky" until the logs show it.
4. The owner merges (squash, branch deleted), or says to. Then update the
   local `main`.

Pushing, opening or commenting on a pull request, and merging are all writes
to the shared repository: confirm with the owner first, as always. Dependabot's
pull requests follow the same path, one at a time, with the full `bun run
check` run on the branch first when it touches Rust or the build.

## Commands

| What | Command |
|---|---|
| Install JS deps | `bun install` |
| Run the app | `bun tauri dev` |
| Quick checks while working (what changed, fast tests only) | `bun run check:quick` |
| Everything (run before every commit) | `bun run check` |
| Web checks only (format, lint, types, brand, Vitest) | `bun run check:web` |
| The app's name only in `brand.json` | `bun run check:brand` |
| Rust checks only (fmt, clippy, cargo test) | `bun run check:rust` |
| Rust tests only | `cargo test --workspace` |
| Frontend tests only | `bun run test` |
| Browser tests (Playwright, WebKit) | `bun run test:browser` |
| Format TS | `bun run fmt` |
| Regenerate TS bindings | `cargo test -p desktop bindings` |
| Regenerate app icons (needs Xcode) | `scripts/build-app-icon.sh` |

### macOS keychain prompts in dev

macOS grants keychain access per exact build, so unsigned dev builds trigger
"mailboat wants to use your confidential information" after every Rust rebuild.
`.cargo/config.toml` runs `scripts/dev-run.sh`, which wraps the dev binary
in `target/debug/Mailboat.app` (so the Dock shows the real macOS icon) and signs
it with the owner's Apple Development certificate (free Apple ID: Xcode →
Settings → Accounts → Manage Certificates → + Apple Development). With it,
"Always Allow" persists across rebuilds. Without it, the script prints a
note and runs unsigned. Override the identity with `DEV_SIGNING_IDENTITY`.

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

When unsure how to do something, do what these do, and say which you followed.
They are the owner's other projects, kept in their own source folder (ask
the owner where):

- MonoCode — a Tauri app. Project layout, command registration, SQLite
  setup, settings, packaging, visual language.
- Synara — Bun tooling and config (it is an Electron app, so only copy
  tooling from it).

## Multi-account rules (non-negotiable)

1. Every Gmail-derived record has an `account_id`. Gmail IDs (message, thread,
   label, historyId) are only unique per account. Tables use a surrogate
   integer `id` plus `UNIQUE(account_id, gmail_*_id)`. No table, map, cache or
   frontend store is keyed by a Gmail ID alone; the frontend uses surrogate IDs.
2. The unified inbox is a query, not a copy. Every list view goes through one
   query layer (`mail_core::db::query`) that takes an account filter
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
- OAuth: desktop loopback redirect + PKCE. Scopes: `SCOPES` in
  `crates/core/src/auth/oauth.rs` (`gmail.modify` already covers drafts and
  sending, so `gmail.compose` is not asked for).
- The OAuth client is an External app left in **Testing**, with each
  account's address added as a test user (decided with the owner,
  2026-10-29; see the Architecture decisions: publishing needs a homepage
  and privacy URL and shows scarier screens). Each account clicks Continue
  past Google's "hasn't verified this app" warning once, and Google ends
  each account's sign-in after seven days while in Testing. Each account records which OAuth client it used
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

- Email HTML is sanitized in Rust (`mail_core::mail::sanitize`), then shown
  in an `<iframe sandbox>` without `allow-scripts`, with a per-message CSP.
- Remote images load by default (owner's decision, 2026-10-15; Settings →
  Viewing can make it "people you've written to" or "blocked"), except in
  Spam (always blocked, even for allowed senders) and Trash (blocked unless
  the sender is allowed). A per-sender "load" or "block" choice is
  remembered by address (global, not per account) and wins outside Spam.
  Known tracking pixels are always removed. The rule lives in
  `mail_core::mail::images`. Images of new mail that the rule would load
  are downloaded as mail arrives (`mail::prefetch`, on by default, like
  Apple Mail), so opening an email normally makes no request (an image that
  couldn't be fetched, or was evicted, still loads as the setting allows).
- Tauri capabilities stay as narrow as possible. Do not add plugins or
  permissions to the web side without a reason recorded in the commit.

## Codex review (monthly)

ChatGPT runs through OpenAI's `codex` command-line tool, which can't
promise no tools, so it's fenced in (docs/ROADMAP.md → Milestone 13,
Codex): every switch turned off per request, a macOS sandbox, and a
runtime check that pauses ChatGPT when a switch it hasn't reviewed stays
on. What was reviewed is `crates/core/src/ai/codex_review.json`.

`bun run check` (and `check:quick`) stops when that review is over 31 days
old, on the owner's machine (an empty, uncommitted `.codex-review-enforce`
file in the repository folder turns the failure on; elsewhere it only warns).
When it does:

1. Stop and ask the owner before going on. The recheck makes a few small
   live requests on their ChatGPT subscription, with harmless input.
2. With their OK, run the recheck (ignored tests, in
   `crates/core/tests/ai_live.rs`):

   ```
   cargo test -p mail-core --test ai_live codex_ -- --ignored --nocapture --test-threads=1
   ```

   Ask the owner which ChatGPT model Settings → AI uses for writing; if
   it isn't "Default", run the live tests again with
   `AI_LIVE_CODEX_WRITING_MODEL=<that model>` set, so both runs cover what
   the app asks.

   - `codex_switches_are_as_reviewed` (offline): no switch stays on that
     the review doesn't list.
   - `codex_request_tools_are_as_reviewed` (offline): the tools in
     Codex's real request, captured by a local stand-in server with an
     empty Codex folder, are the reviewed ones, for every model on
     Codex's list (hidden ones too, as the app reads the list and as a
     fresh install would), the chosen writing model (set
     `AI_LIVE_CODEX_WRITING_MODEL` as above) and Codex's default. To list
     models as the app does, Codex opens its own folder, sign-in file
     included; the test never reads or copies it.
   - `codex_refused_models_are_still_refused` (one small live request
     per model, straight to Codex with the app's settings, since the app
     never asks a refused model): OpenAI still refuses each model the
     review lists as refused; if one is accepted, its tools need review.
   - `codex_cannot_*` (five tests, two small live requests each: the
     fast and the writing model): Codex can't write a file, run a
     command, reach the network, read a file planted in the home folder,
     or act through a helper agent.

   Never send real mail, and never read or copy Codex's sign-in.
3. Anything new or any test that fails: tell the owner what changed and
   what it can do before accepting it. If nothing changed, or the owner
   accepts the change, update `codex_review.json` (date, Codex version,
   lists) and commit it with the results in the message.

## Testing

- Rust: `cargo test` against Gmail API JSON fixtures in
  `crates/core/tests/fixtures/gmail/`, with `wiremock` standing in for Google.
  Fixtures and test data are always made up (see "Real mail never goes in the
  repository").
- Frontend logic: Vitest, files named `*.test.ts(x)` next to the code.
- UI behaviour unit tests can't see (animation, layout, scrolling):
  Playwright in WebKit (the macOS web view's engine), `tests/browser/`.
  `harness.tsx` mounts real components with the Rust side faked by
  Tauri's `mockIPC`, answering with demo mode's mail (`demo/mail.json`,
  via `tests/browser/demoMail.ts`); pick the setup by URL (`?mode=…`). Measure what's
  painted: sample in a `ResizeObserver` created after the component's,
  not at the start of a frame. Before trusting a new test, put the old
  behaviour back and see it fail. One-time setup: `bunx playwright install webkit`.
- Windows-only behaviour: `tests/browser/windows-*.spec.ts` run in Chromium
  (WebView2's engine) with `data-platform="windows"` set; the rest stay in
  WebKit. One-time setup: `bunx playwright install chromium`.

## Future direction (don't build yet)

AI (built in the AI Spike, see `docs/ARCHITECTURE.md` → AI): summaries and
a writing assistant through Apple Intelligence (on-device, the default) or the
owner's Claude / ChatGPT subscriptions via the `claude` and `codex` CLIs. Mailboat
holds no AI keys or tokens. Rules: every request runs with all tools off
(Claude: none at all; Codex can't promise that, so it's fenced in
instead, see "Codex review" above);
mail goes to a cloud model only when the owner chose that provider for the
feature; never send AI output without the owner seeing it in the editor;
never log prompts or answers. API keys (keychain, like Google tokens) could
be added later as another provider.

The MCP server exposing Mailboat's mail to AI apps is built (Settings → AI →
AI apps, `docs/AI.md`): off for every account until the owner turns it on,
search and read plus saving drafts, never sends, Spam and Trash never shared.
