#!/bin/sh
# Semgrep's community rules over the repository (docs/ROADMAP.md → 0.3.0 →
# "Scan the code ourselves"). The rules are fetched from Semgrep's registry
# each run, never stored here: their license allows using them for our own
# purposes, not passing them on. No usage data is sent (--metrics=off).
# Only warnings and errors: the informational level is the reviewed
# `unsafe` blocks and tests' temp folders, already covered by
# `check:security`. A reviewed false positive carries
# `nosemgrep: <rule> -- <why>` on or above its line. --timeout: a rule
# gets 30 seconds per file, not 5 (a React rule ran out on a large one).
#
#   scripts/semgrep.sh                     findings in the terminal
#   scripts/semgrep.sh --sarif --output f  for GitHub code scanning (CI)
set -eu
cd "$(dirname "$0")/.."
exec semgrep scan --metrics=off \
  --config p/default \
  --config p/security-audit \
  --config p/rust \
  --config p/typescript \
  --config p/react \
  --config p/secrets \
  --config p/github-actions \
  --severity WARNING --severity ERROR \
  --timeout 30 \
  "$@" .
