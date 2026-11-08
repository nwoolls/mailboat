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
- The writing agent commits the branch before handing the prompt over, and
  reviewers work in their own `git worktree` under `/tmp`, never in the main
  folder. Reviewers who switched branches or ran the tests in the main folder
  have moved the writing agent's branch under it and made the browser tests
  collide on their fixed port (this happened in the Milestone 16 reviews).
  Reviewers run no browser tests: say so in the prompt.

## The prompt

````text
You are reviewing the git branch `<branch>` in the repository at <path to the
repository> (<one line on the project>). The branch is committed; review ALL
of its changes relative to `origin/main` (see below).

## FIRST: work in your own copy of the repository (mandatory)

The main folder <path to the repository> is in use by another agent right
now. Anything that changes its checked-out branch, its files, its index or its
stash corrupts that agent's work. So:

- NEVER run any command that changes the main folder's state: no
  `git switch`, `git checkout`, `git stash`, `git reset`, `git restore`,
  `git clean`, `git merge`, `git rebase`, `git commit`, `git pull`, `git push`,
  `git update-ref`, `git tag`, `git branch -f` / `-d`, `git worktree prune`,
  no formatter, no installer, no `bun run changeset`. Reading is fine from
  anywhere: `git log`, `git show`, `git diff`, `git branch`, `cat`, `grep`.
- Make your own working copy FIRST, outside the main folder, at the branch:

    git -C <path to the repository> worktree add --detach /tmp/review-<name> <branch>

  Then `cd /tmp/review-<name>` and run EVERYTHING there. If you need
  dependencies, `bun install --frozen-lockfile` inside your worktree is fine
  (it only writes there).
  If that folder already exists (another reviewer's copy), pick another name
  (`/tmp/review-<name>-2`) and leave the existing one alone. Wherever this
  prompt says `/tmp/review-<name>`, use the exact folder you ended up with and
  nothing else: that is the only folder you may remove at the end.
- Do NOT run the browser tests (`bun run test:browser`, `bun run check`, or any
  Playwright command). They bind a fixed port (1436) that the other agent may
  be using. If a browser test matters for this branch, say so in your report
  instead of running it.
- Do NOT edit, format or delete files, even in your worktree: report, do not
  fix. If you want to try a change, copy the file to `/tmp/scratch-<name>`
  first.
- When you finish, remove your copy:
  `git -C <path to the repository> worktree remove --force <the folder you created>`,
  and confirm with `git -C <path to the repository> worktree list` that only
  the main folder (and any worktree that was already there) remains. Say in
  your report that you did.

Review ALL changes on the branch relative to `origin/main`. The local `main`
branch is often behind, and comparing against it shows other people's merged
work as part of this branch. Fetch first, scoped so it changes only the
`origin/main` reference (no tags, no pruning):

    git -C <path to the repository> fetch --no-tags --no-prune origin main


Then, from inside YOUR worktree (its `HEAD` is the commit you were asked to
review, even if the branch moves later; write that commit down in your report):

  git rev-parse HEAD
  git diff origin/main...HEAD        (what the branch changes)
  git log origin/main..HEAD          (commit messages)

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
  brand rule in AGENTS.md: the app's name is written by hand only where it
  allows (`brand.json`, Tauri's config files, the docs, the website's pages,
  the artwork), and comments say "the app".
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
- The changeset: empty only if nothing the app outputs or does changed. Name
  any change in the diff that does change it, visible or not, and say if the
  changeset's sentence is false or missing it.
- Code quality: dead code, duplicated logic, wrong or excessive comments.
  Skip matters of taste.

## Run these and report real output
- `bun run check:privacy` and `bun run check:brand`
- <the test commands that cover the change: `cargo test -p …`, `bun run test`,
  …. Never a browser test: if browser coverage matters, say so in the report>
- `bun run fmt:check`, `bun run lint`, `bun run typecheck`
- `cargo clippy --workspace --all-targets -- -D warnings`, in your worktree (it
  only writes the worktree's own ignored `target/` folder)

## What the writing agent already ran                          [fill in]
<State truthfully what was run on this tree: "the full `bun run check`
passed", or "not run: the change is documentation", and so on.>

Do not run the full `bun run check` yourself (it includes the browser tests:
see the worktree rules above). Never claim something passes without having run
it.

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
5. **Commands run**: each command and its result in one line, including your
   worktree creation and removal.

Keep it factual and specific. No praise, no restating the diff.
````
