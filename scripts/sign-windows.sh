#!/usr/bin/env bash
# Signs one Windows file. Tauri runs it for each file it makes
# (`bundle.windows.signCommand` in src-tauri/tauri.windows.conf.json), with the
# file's path as the only argument.
#
# Off by default: without WINDOWS_SIGN=1 it does nothing, so checks, tests and
# unsigned local builds are unchanged. To sign, from this Mac, with Azure's
# Artifact Signing (docs/DEVELOPMENT.md, "A signed Windows installer"):
#
#   WINDOWS_SIGN=1 \
#   WINDOWS_SIGN_ENDPOINT=<region>.codesigning.azure.net \
#   WINDOWS_SIGN_ALIAS=<signing account>/<certificate profile> \
#   scripts/windows.sh build
#
# Needs `az login` (an account with the "Artifact Signing Certificate Profile
# Signer" role) and `jsign` (brew install jsign). Nothing secret is written
# anywhere: the short-lived access token goes to jsign through the environment.
set -euo pipefail

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
SIGN_TOKEN="$(az account get-access-token --resource https://codesigning.azure.net \
  --query accessToken -o tsv 2>/dev/null)"
if [ -z "$SIGN_TOKEN" ]; then
  echo "sign-windows: no access token from az (run az login); not signing $(basename "$file")" >&2
  exit 1
fi
export SIGN_TOKEN
# RFC 3161 is what Microsoft's timestamp service speaks; jsign's default
# (Authenticode) mode fails against it.
jsign --storetype TRUSTEDSIGNING \
  --keystore "$WINDOWS_SIGN_ENDPOINT" \
  --storepass env:SIGN_TOKEN \
  --alias "$WINDOWS_SIGN_ALIAS" \
  --tsaurl http://timestamp.acs.microsoft.com --tsmode RFC3161 \
  "$file"
