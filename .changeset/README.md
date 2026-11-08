# Changesets

Every pull request that changes the app adds a small file here, saying what
kind of change it is and what to tell people. At release, the files become
the new version number and `CHANGELOG.md`.

Make one with `bun run changeset`, or write it by hand:

```md
---
"desktop": minor
---

A sentence for people, in plain words: what they can do now, or what was fixed.
```

- `patch`: a fix. `minor`: something new or changed. `major`: a break (while the
  version starts with 0, a `minor` is how a release says "new things").
- A fix nobody would see (a security cleanup, a stricter check on input) is
  still a `patch`: it changes what the app outputs or does.
- A pull request that changes nothing the app outputs or does (docs, tests,
  tooling, the website's text): make an empty one with
  `bun run changeset --empty`.
- Never write real mail details, names or companies in one (see `AGENTS.md`).
