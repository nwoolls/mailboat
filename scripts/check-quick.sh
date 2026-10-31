#!/bin/sh
# Quick checks while working (`bun run check:quick`): only the parts the
# uncommitted changes touch, and only the fast tests. `bun run check` runs
# everything and stays the rule before every commit.
#
# Always: the app's name only in brand.json (scripts/check-brand.ts).
# Web changes: format, lint, types, Vitest (seconds).
# Rust changes: format, clippy, the core unit tests, the multi-account
# guard test and the app layer's tests (which include the bindings check).
# Skipped until the full run: the Gmail tests in crates/core/tests and the
# browser tests.
set -e
cd "$(dirname "$0")/.."

changed="$( (git diff --name-only HEAD; git ls-files --others --exclude-standard) | sort -u)"
if [ -z "$changed" ]; then
  echo "check:quick: no uncommitted changes"
  exit 0
fi

# Fast, and any change can bring the app's name back.
bun run check:brand
# Fast: is Codex's monthly review due (AGENTS.md → Codex review)?
bun run check:codex

web=false
rust=false
for f in $changed; do
  case "$f" in
    *.rs | Cargo.toml | Cargo.lock | */Cargo.toml | crates/core/tests/fixtures/*) rust=true ;;
    src/* | tests/browser/* | package.json | bun.lock | tsconfig*.json | vite.config.* | .oxlintrc* | .oxfmtrc*) web=true ;;
  esac
done

if $web; then
  echo "check:quick: web"
  bun run check:web
fi
if $rust; then
  echo "check:quick: rust"
  cargo fmt --all --check
  cargo clippy --workspace --all-targets -- -D warnings
  cargo test -p mail-core --lib --test two_accounts
  cargo test -p desktop --lib
fi
if ! $web && ! $rust; then
  echo "check:quick: nothing to check in the changed files (docs only?)"
fi
echo "check:quick: passed. Run \`bun run check\` before committing."
