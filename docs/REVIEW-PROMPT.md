# Review prompt

Before a branch is pushed, a pull request opened, or an update pushed to one,
the owner has it reviewed by an independent agent. The agent that wrote the
change gives the owner this prompt, filled in for the branch, and waits for
the reviews. See "Pull requests" in `AGENTS.md`.

How the owner and the writing agent use it:

- The writing agent fills in the three marked parts (what the branch does,
  what is already decided, what to look for) and hands the prompt over as one
  code block. Everything else stays as it is, so reviews stay comparable
  from one branch to the next.
- The owner may run it with more than one reviewer. Each returns one Markdown
  block.
- The writing agent checks every finding against the code before acting on
  it: it fixes it, rejects it with evidence, or asks the owner. A finding is
  not true because a reviewer said so. Rejected findings and the reasons go
  in the pull request, as with Copilot's comments.
- For a second round on the same branch, add "What changed since the last
  round" to the prompt, with the fixes to verify first.

## The prompt

````text
You are reviewing the git branch `<branch>` in the repository at <path to the
repository> (<one line on the project>). Review ALL changes on the branch
relative to `main`, committed and uncommitted:

  git diff main                      (committed + uncommitted, tracked files)
  git status --short                 (also read the untracked files it lists; `git diff` does not show them)
  git log main..HEAD                 (commit messages)

Do NOT change the project: no editing, creating, formatting or deleting of
tracked or untracked files in the working tree, and no commit, stash, branch
switch or push. Look with read-only commands (git diff/log/status, grep, cat).
Running the existing check and test commands is fine: they may write build
output and caches in folders git ignores (`target/`, `node_modules/`,
`test-results/`), and that is not a change to the project. Do not run
anything that rewrites the project's own files (formatters, installs,
bindings or changeset commands). If you want to try something that does, do
it in a throwaway copy or `git worktree` under /tmp and remove it when done.

## Read first
- AGENTS.md (project rules: privacy of real mail, multi-account rules, Rust
  and TypeScript conventions, brand rules, docs rules).
- <the roadmap section or items the branch is about, in docs/ROADMAP.md>

## What the branch does                                      [fill in]
<A numbered list of what the change is meant to do, in plain words. This is
the spec the reviewer checks the code against.>

## Decisions already made; do not re-raise them as findings   [fill in]
<The owner's choices and the settled trade-offs, each with a short reason.
Anything deliberately left for a later item. Findings the writing agent
already rejected in an earlier round, with the reason.>

## What to look for (most important first)                    [fill in the specifics]
- Correctness bugs and race conditions. <Name the riskiest functions and the
  states or orders of events that worry you.>
- The multi-account rules in AGENTS.md: everything keyed by the surrogate
  `account_id`, one account's failure never affecting another's.
- Security and privacy. Nothing logged that shouldn't be (no tokens, no email
  content). No real mail details anywhere in the diff, commit messages, tests
  or docs (real names, senders, companies, subjects, counts, screenshots:
  only made-up data on reserved domains and demo people are allowed). Nothing
  about the owner's Apple developer or code-signing accounts (names, team or
  key IDs, certificate details, file paths) and no credentials or keys. The
  brand rule: the app's name only in `brand.json`, and comments say "the app".
- Tests: do they prove what the roadmap and docs claim? Name any test that
  would still pass with the change taken out. Name anything promised but
  untested.
- Regressions around the touched code, and accessibility of any new UI.
- Dependencies and workflows: anything added, its licence (GPL-3.0-only
  project), install scripts, and whether workflows keep the repository's
  hardening (pinned actions, least-privilege permissions, no untrusted input
  in shell commands).
- Docs: ROADMAP.md, ARCHITECTURE.md (decisions table), DEVELOPMENT.md and any
  other doc the change touches must match what the code now does. Flag any
  statement that is false or no longer true, any ticked item that isn't done,
  and clear AI-writing tics in prose a person will read (do not rewrite them).
- Code quality: dead code, duplicated logic, wrong or excessive comments.
  Skip matters of taste.

## Run these and report real output
- `bun run check:privacy` and `bun run check:brand`
- <the test commands that cover the change: `cargo test -p …`, `bun run test`,
  a single Playwright spec, …>
- `bun run fmt:check`, `bun run lint`, `bun run typecheck`
- `cargo clippy --workspace --all-targets -- -D warnings` if it runs without
  writing into the repository (otherwise say you skipped it and why)
The full `bun run check` has already passed for the current tree; you don't
need to run it. Never claim something passes without having run it.

## How to report
Return the whole review as ONE Markdown code fence (a single block starting
with three backticks and `md`, ending with three backticks, and nothing
outside it). Inside it use these sections:

1. **Verdict**: one line: ready to push / ready after the listed fixes / needs
   rework.
2. **Findings**: a numbered list, most severe first. For each: severity
   (blocker / should-fix / nit), `file:line`, what is wrong, a concrete
   triggering scenario, and a suggested fix described in words or a short
   snippet (do not apply it). Include only findings you verified by reading
   the code or running something; mark anything unverified as "unverified"
   and say what would settle it. Do not repeat the decisions listed above.
3. **Questions for the owner**: only decisions that are genuinely theirs.
4. **Checked and fine**: a short list of the risky areas you examined and
   found correct.
5. **Commands run**: each command and its result in one line.

Keep it factual and specific. No praise, no restating the diff.
````
