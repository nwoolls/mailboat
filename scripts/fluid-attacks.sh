#!/bin/sh
# Fluid Attacks' SAST scanner, the one the ADA's static-scan guide names
# (docs/ROADMAP.md → 0.3.0 → "Scan the code ourselves"). Run by hand before
# a paid scan; its report is evidence for the lab, kept outside the
# repository.
#
#   scripts/fluid-attacks.sh <report folder>
#
# Scans the files Git tracks at HEAD (an export, so node_modules, target and
# uncommitted changes stay out), read-only, in a container with no network:
# no code or telemetry can leave the computer (its config also opts out of
# telemetry). The image is pinned by digest because Fluid Attacks publishes
# only a `latest` tag. Needs Docker, and a report folder outside Documents,
# Desktop and Downloads (macOS holds Docker there behind a permission prompt).
#
# What it covers, checked 2026-11-16 by planting known weaknesses: in
# TypeScript it found a weak hash and cipher, and missed eval, innerHTML and
# Math.random; in Rust it found an MD5 digest through the md-5 crate's
# `Md5::digest`, and missed `md5::compute`, certificate checks turned off and
# a shell command; it missed an unsafe GitHub Actions workflow. Semgrep and
# CodeQL cover more of those.
#
# The scanned tree has no .git, so the report's own commit fields are
# placeholders; the commit scanned is written to fluid-attacks-commit.txt and
# at the top of the log.
set -eu
IMAGE=fluidattacks/sast@sha256:0928142e116e241db077a8e1c6aca25fc6e84b31ca67c98c739e94d3400387a5

out=${1:?usage: scripts/fluid-attacks.sh <report folder>}
mkdir -p "$out"
out=$(cd "$out" && pwd)
cd "$(dirname "$0")/.."

commit=$(git rev-parse HEAD)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir "$work/src"
# The export and the extraction run as separate commands, so `set -e` stops
# the script when either fails (in a pipe it would see only tar's status, and
# the scanner would report an empty tree as clean).
git archive --output="$work/src.tar" "$commit"
tar -x -f "$work/src.tar" -C "$work/src"
if [ ! -f "$work/src/Cargo.toml" ]; then
  echo "fluid-attacks: the export of $commit is empty or incomplete" >&2
  exit 1
fi
cat >"$work/config.yaml" <<'EOF'
namespace: app
working_dir: /src
language: EN
tracing_opt_out: true
output:
  file_path: /out/fluid-attacks
  format: ALL
sast:
  include:
    - .
  exclude:
    # Deliberately hostile HTML inputs for the sanitizer's fuzzer.
    - fuzz/seeds/
EOF

# The scan writes into a staging folder; the report, its log and the commit
# replace the ones in the report folder together, and only when the scan
# succeeded, so a failed rerun never leaves an old report beside a new
# commit.
mkdir "$work/out"
echo "$commit" >"$work/out/fluid-attacks-commit.txt"
echo "Commit scanned: $commit" >"$work/out/fluid-attacks.log"
echo "Scanning $commit into $out"
docker run --rm --network none \
  -v "$work/src:/src:ro" \
  -v "$work/out:/out" \
  -v "$work/config.yaml:/config.yaml:ro" \
  "$IMAGE" sast scan /config.yaml >>"$work/out/fluid-attacks.log" 2>&1 || status=$?
cat "$work/out/fluid-attacks.log"
if [ "${status:-0}" -eq 0 ]; then
  rm -f "$out/fluid-attacks.csv" "$out/fluid-attacks.sarif" \
    "$out/fluid-attacks.log" "$out/fluid-attacks-commit.txt"
  mv "$work/out/"* "$out/"
else
  echo "fluid-attacks: the scan failed (exit $status); $out is unchanged" >&2
fi
# Clean up here rather than in the trap, and never let a failed removal
# replace the scanner's exit status.
rm -rf "$work" || echo "fluid-attacks: couldn't remove $work" >&2
trap - EXIT
exit "${status:-0}"
