#!/bin/sh
# Cargo runner (see .cargo/config.toml) for macOS dev builds.
#
# Why: macOS remembers keychain access per exact build. Unsigned dev builds
# change on every rebuild, so the "allow keychain access" prompt came back
# after every Rust change. Signing the app binary with your Apple Development
# certificate gives every build the same identity, so "Always Allow" sticks.
#
# Only the app binary (`mailboat`) is signed; test binaries run untouched.
# Override the certificate with MAILBOAT_DEV_SIGNING_IDENTITY if you have several.
set -e
bin="$1"

if [ "$(basename "$bin")" = "mailboat" ]; then
  identity="${MAILBOAT_DEV_SIGNING_IDENTITY:-$(security find-identity -v -p codesigning 2>/dev/null \
    | sed -n 's/.*"\(Apple Development: [^"]*\)".*/\1/p' | head -n 1)}"
  if [ -n "$identity" ]; then
    codesign --force --sign "$identity" --identifier com.nwoolls.mailboat "$bin" 2>/dev/null \
      || echo "dev-run: signing with \"$identity\" failed; continuing unsigned" >&2
  else
    echo "dev-run: no Apple Development certificate found; macOS will ask for keychain access after each rebuild (see CLAUDE.md)" >&2
  fi
fi

exec "$@"
