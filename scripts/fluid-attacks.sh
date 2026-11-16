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
# What it covers (checked 2026-11-16 by planting known weaknesses): TypeScript
# yes (it found a weak hash and cipher; it missed eval, innerHTML and
# Math.random), Rust and GitHub Actions workflows no. Semgrep and CodeQL
# cover those.
set -eu
IMAGE=fluidattacks/sast@sha256:0928142e116e241db077a8e1c6aca25fc6e84b31ca67c98c739e94d3400387a5

out=${1:?usage: scripts/fluid-attacks.sh <report folder>}
mkdir -p "$out"
out=$(cd "$out" && pwd)
cd "$(dirname "$0")/.."

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir "$work/src"
git archive HEAD | tar -x -C "$work/src"
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

echo "Scanning $(git rev-parse --short HEAD) into $out"
docker run --rm --network none \
  -v "$work/src:/src:ro" \
  -v "$out:/out" \
  -v "$work/config.yaml:/config.yaml:ro" \
  "$IMAGE" sast scan /config.yaml >"$out/fluid-attacks.log" 2>&1 || status=$?
cat "$out/fluid-attacks.log"
exit "${status:-0}"
