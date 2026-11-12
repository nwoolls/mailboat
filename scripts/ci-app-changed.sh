#!/bin/sh
# Says how much of the CI a pull request needs, by what it changes. CI (the
# "What changed" job) reads the answer:
#
#   docs  only docs/, .changeset/ and top-level Markdown files changed
#   site  also website/, the website's image script, or the website's own
#         checks (scripts/website.ts, check-website.ts, policy.ts and their
#         tests), nothing else
#   app   anything else: the app, its scripts, the workflows, the tooling
#
# It fails safe: if the changed files can't be listed, the answer is app.
# Renames are listed as a delete plus an add (--no-renames), so moving an app
# file into website/ or docs/ still counts as a change to the app.
#
# Usage: scripts/ci-app-changed.sh <base commit> <head commit>
base=$1
head=$2
# core.quotepath=off: a non-ASCII name (docs/café.md) is listed as it is, not as "\303\251"-style
# escapes that no pattern below would match. (A name with a newline is still quoted: it counts as app.)
if ! files=$(git -c core.quotepath=off diff --name-only --no-renames "$base...$head" 2>/dev/null); then
  echo app
  exit 0
fi
not_docs='^(docs/|\.changeset/|[^/]+\.md$)'
# The website's own checks count as the site: a site run tests them (CI, the
# "Web checks" job runs their Vitest files).
not_site='^(website/|scripts/build-website-images\.sh$|scripts/(website|website\.test|check-website|policy|policy\.test)\.ts$)'
# Anything that is neither docs nor site makes it an app change.
other=$(printf '%s\n' "$files" | grep -vE "$not_docs" | grep -vE "$not_site" || true)
if [ -n "$other" ]; then
  echo app
elif printf '%s\n' "$files" | grep -qE "$not_site"; then
  echo site
else
  echo docs
fi
