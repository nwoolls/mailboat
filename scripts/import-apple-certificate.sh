#!/usr/bin/env bash
# For the release workflow (.github/workflows/release.yml), on a macOS runner:
# puts the Developer ID certificate into a throwaway keychain so codesign can
# use it, and passes its name on to the next steps.
#
# Reads APPLE_CERTIFICATE (the .p12, base64) and APPLE_CERTIFICATE_PASSWORD
# from the environment, and writes RELEASE_KEYCHAIN (as soon as the keychain
# exists) and APPLE_SIGNING_IDENTITY to $GITHUB_ENV. Prints nothing secret. The keychain's own password is random
# and masked, and the .p12 is deleted as soon as it is imported.
set -euo pipefail

: "${APPLE_CERTIFICATE:?missing}" "${APPLE_CERTIFICATE_PASSWORD:?missing}"
: "${RUNNER_TEMP:?missing}" "${GITHUB_ENV:?missing}"

keychain="$RUNNER_TEMP/release.keychain-db"
keychain_password="$(uuidgen)"
echo "::add-mask::$keychain_password"

security create-keychain -p "$keychain_password" "$keychain"
# At once, so the cleanup step can delete it even if a later step here fails.
echo "RELEASE_KEYCHAIN=$keychain" >> "$GITHUB_ENV"
# Stays unlocked for the build (6 hours at most), then it is deleted.
security set-keychain-settings -lut 21600 "$keychain"
security unlock-keychain -p "$keychain_password" "$keychain"

p12="$RUNNER_TEMP/certificate.p12"
(umask 077 && printf '%s' "$APPLE_CERTIFICATE" | base64 --decode > "$p12")
# -f pkcs12: without it `security` can mistake a newer .p12 for another format.
security import "$p12" -f pkcs12 -k "$keychain" -P "$APPLE_CERTIFICATE_PASSWORD" -T /usr/bin/codesign
rm -f "$p12"
# Lets codesign use the key without a prompt, which nobody could answer here.
security set-key-partition-list -S apple-tool:,apple: -s -k "$keychain_password" "$keychain" > /dev/null

# Search the new keychain first, and keep the ones that were already listed.
# `security list-keychains` prints each path indented and in quotes.
existing=()
while IFS= read -r line; do
  line="${line//\"/}"
  line="${line#"${line%%[![:space:]]*}"}"
  if [ -n "$line" ]; then
    existing+=("$line")
  fi
done < <(security list-keychains -d user)
security list-keychains -d user -s "$keychain" ${existing[@]+"${existing[@]}"}

# Exactly one identity: with two, guessing could sign a release with the wrong one.
identities="$(security find-identity -v -p codesigning "$keychain" | grep "Developer ID Application" || true)"
count="$(printf '%s' "$identities" | grep -c . || true)"
if [ "$count" -ne 1 ]; then
  echo "Expected one Developer ID Application identity in the certificate, found $count." >&2
  exit 1
fi
identity="$(printf '%s\n' "$identities" | sed -E 's/.*"(.*)"/\1/')"

echo "APPLE_SIGNING_IDENTITY=$identity" >> "$GITHUB_ENV"
echo "Imported the signing certificate into a temporary keychain."
