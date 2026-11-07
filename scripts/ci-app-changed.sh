#!/bin/sh
# Prints "true" when a pull request may change the app and "false" when it
# only touches the website, docs, changesets, the website's image script or
# top-level Markdown files. CI (the "What changed" job) uses it to skip the
# Rust and browser builds for the second kind.
#
# It fails safe: if the changed files can't be listed, the answer is true.
# Renames are listed as a delete plus an add (--no-renames), so moving an app
# file into website/ or docs/ still counts as a change to the app.
#
# Usage: scripts/ci-app-changed.sh <base commit> <head commit>
base=$1
head=$2
if ! files=$(git diff --name-only --no-renames "$base...$head" 2>/dev/null); then
  echo true
  exit 0
fi
others=$(printf '%s\n' "$files" | grep -vE '^(website/|docs/|\.changeset/|scripts/build-website-images\.sh$|[^/]+\.md$)' || true)
if [ -n "$others" ]; then
  echo true
else
  echo false
fi
