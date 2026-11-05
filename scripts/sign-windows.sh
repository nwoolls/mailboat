#!/usr/bin/env bash
# Signs one Windows file. Tauri runs it for each file it makes
# (`bundle.windows.signCommand` in src-tauri/tauri.sign-windows.conf.json,
# which scripts/windows.sh adds to the build only when WINDOWS_SIGN=1), with
# the file's path as the only argument. It is for the Mac (bash): on a
# Windows machine `bash` can be the WSL launcher, so no default build names it.
#
# Without WINDOWS_SIGN=1 it does nothing, as a second guard. To sign, from this
# Mac, with Azure's Artifact Signing (docs/DEVELOPMENT.md, "A signed Windows
# installer"):
#
#   WINDOWS_SIGN=1 \
#   WINDOWS_SIGN_ENDPOINT="<region>.codesigning.azure.net" \
#   WINDOWS_SIGN_ALIAS="<signing account>/<certificate profile>" \
#   scripts/windows.sh build
#
# Needs `az login` (an account with the "Artifact Signing Certificate Profile
# Signer" role) and `jsign` (brew install jsign). Nothing secret is written
# anywhere: the short-lived access token goes to jsign through the environment.
set -euo pipefail

# The updater's signing key belongs to Tauri's own last step, not to this one
# or to the tools it runs.
unset TAURI_SIGNING_PRIVATE_KEY TAURI_SIGNING_PRIVATE_KEY_PASSWORD

file="${1:?usage: $0 <file to sign>}"

if [ "${WINDOWS_SIGN:-}" != "1" ]; then
  echo "sign-windows: WINDOWS_SIGN is not 1, leaving $(basename "$file") unsigned" >&2
  exit 0
fi

: "${WINDOWS_SIGN_ENDPOINT:?set WINDOWS_SIGN_ENDPOINT, e.g. eus.codesigning.azure.net}"
: "${WINDOWS_SIGN_ALIAS:?set WINDOWS_SIGN_ALIAS to <signing account>/<certificate profile>}"

for tool in az jsign; do
  if ! command -v "$tool" >/dev/null; then
    echo "sign-windows: $tool is not installed; not signing $(basename "$file")" >&2
    exit 1
  fi
done

echo "sign-windows: signing $(basename "$file")" >&2
# Never let a trace (bash -x) print the token.
case $- in *x*) traced=1 ;; *) traced= ;; esac
set +x
if ! SIGN_TOKEN="$(az account get-access-token --resource https://codesigning.azure.net \
  --query accessToken -o tsv)"; then
  # az has said why on stderr (not logged in, no network, wrong account).
  echo "sign-windows: az could not get an access token; not signing $(basename "$file")" >&2
  exit 1
fi
if [ -z "$SIGN_TOKEN" ]; then
  echo "sign-windows: az gave no access token (is it logged in to the right account?); not signing $(basename "$file")" >&2
  exit 1
fi
export SIGN_TOKEN
[ -z "$traced" ] || set -x
# RFC 3161 is what Microsoft's timestamp service speaks; jsign's default
# (Authenticode) mode fails against it.
jsign --storetype TRUSTEDSIGNING \
  --keystore "$WINDOWS_SIGN_ENDPOINT" \
  --storepass env:SIGN_TOKEN \
  --alias "$WINDOWS_SIGN_ALIAS" \
  --tsaurl http://timestamp.acs.microsoft.com --tsmode RFC3161 \
  "$file"
