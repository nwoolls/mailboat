# Repository ruleset

`main.json` is the ruleset for the default branch, kept here so it can be
imported instead of clicked together: **Settings → Rules → Rulesets → New
ruleset → Import a ruleset**, choose the file, check the summary, create.

What it does:

- No deleting `main`, no force pushes.
- Changes arrive through a pull request (squash merge only), with every review
  conversation resolved.
- The checks must pass: web, Rust on macOS and Windows, browser tests,
  `cargo-deny` and `bun audit`.
- Copilot reviews each pull request, and again on each push.
- The repository admin (the owner) can bypass the rules **on a pull request
  only**, for an emergency. Direct pushes to `main` stay blocked for everyone.

Check names must match the jobs in `.github/workflows` exactly; update this
file if a job is renamed. The Copilot rule needs a Copilot plan on the owner's
account. Rulesets are enforced only on public repositories (or a paid plan),
which is why this waits for the repository to go public.
