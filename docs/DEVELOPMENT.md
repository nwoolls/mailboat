# Developing Mailboat

Building, running and checking the app. For how it fits together, see
[ARCHITECTURE.md](ARCHITECTURE.md); for what is planned, [ROADMAP.md](ROADMAP.md).

## Requirements

- macOS with Xcode command line tools (its Swift compiler builds the
  Apple Intelligence helper; Apple Intelligence itself needs macOS 26+)
- [Rust](https://rustup.rs) (stable)
- [Bun](https://bun.sh): `brew install oven-sh/bun/bun`
- Optional but recommended: an Apple Development certificate (free Apple ID,
  Xcode → Settings → Accounts → Manage Certificates → + Apple Development),
  so macOS doesn't ask for keychain access after every rebuild.

## Run

```sh
bun install
bun tauri dev
```

The first sync of an account takes a while (Gmail's per-user quota limits
the pace); the inbox fills in first. Later syncs only fetch changes.

### Demo mode

```sh
bun run demo
```

Starts the app full of made-up mail, with no Google connection: two
accounts (personal and work), 24 conversations with attachments,
labels (one of them empty), a meeting invitation, a draft, spam, trash, list
summaries, Gmail rules, and a vacation reply set to start in a few days.
None of your own mail can show. Archiving, labels, rules and the rest all
work. Sending is faked: the message lands in Sent and the person answers
about 8 seconds later. A sign-in code arrives 45 seconds after the window opens.

The made-up mail lives in `demo/mail.json` (reserved `.example` addresses
only). Like the clean start below, the demo keeps to its own folder
(`com.nwoolls.mailboat.demo`) and starts over at every launch, dated
relative to now. It takes the flag `--demo` in the same ways.

To see what happens when Google signs an account out, start the demo with
`MAILBOAT_DEMO_SIGN_OUT_AFTER=30 bun run demo`: 30 seconds after the demo
opens, the second account's sign-in ends, as one of Google's can. The
account finds out at its next sync pass (within a minute, or at once with
"Sync now"). Then the notice, the red dot and the avatar menu appear, and
"Sign in again" lets the account back in.

The pictures in the README and in [FEATURES.md](FEATURES.md) are taken from
the demo, with scripts you can run again:
[scripts/screenshots/README.md](../scripts/screenshots/README.md).

### A first launch, again and again (clean start)

```sh
bun run clean-start
```

Starts the app as if it had never run: no accounts, no settings, no OAuth
client file. It keeps to a folder of its own
(`~/Library/Application Support/com.nwoolls.mailboat.clean-start`), its own
keychain name (`com.nwoolls.mailboat.clean-start`) and web storage that's
gone when it quits, and all of it is emptied at the next clean start.
Your own accounts, mail and settings aren't touched, and the AI apps
connection (MCP) stays with the normal copy.

`bun run clean-start` starts its own dev server, so stop `bun tauri dev`
first, or start the built dev copy next to it:
`target/debug/Mailboat.app/Contents/MacOS/mailboat --clean-start`. An installed
copy takes the same flag: `open -n -a Mailboat --args --clean-start` on the
Mac, `mailboat.exe --clean-start` on Windows.

## Windows (built on the Mac)

Mailboat for Windows is built on the Mac and tried in a Windows VM. One-time
setup:

```sh
rustup target add aarch64-pc-windows-msvc x86_64-pc-windows-msvc
brew install llvm lld nsis
cargo install cargo-xwin --locked
```

Then:

```sh
scripts/windows.sh check   # does it compile for Windows, with no lint warnings
scripts/windows.sh build   # makes the installer (.exe)
```

The installer lands in `target/aarch64-pc-windows-msvc/release/bundle/nsis/`.
Copy it into the VM and run it. It's for Windows on ARM (a VM on an Apple
silicon Mac); for an Intel/AMD PC, set
`WINDOWS_TARGET=x86_64-pc-windows-msvc` first. The Google client file
goes in `%APPDATA%\com.nwoolls.mailboat\google-oauth-client.json`.

The installer registers Mailboat as an email app. To have email links open
it, choose Mailboat for `MAILTO` in Settings → Apps → Default apps (Mailboat's
Settings → General → Email links opens that page).

## Check

```sh
bun run check:quick   # while working: only what changed, fast tests only
bun run check         # everything (format, lint, types, Vitest, clippy, cargo test, Playwright); before committing
```

The browser tests (`tests/browser`, Playwright) need WebKit and Chromium once:

```sh
bunx playwright install webkit chromium
```

## A signed Windows installer

The Windows build above is unsigned unless you ask. Signing uses Azure
Artifact Signing (a Public Trust certificate profile, individual identity
validation) from this Mac, with `jsign`. Needs `brew install jsign`, `az
login` as an account that has the "Artifact Signing Certificate Profile
Signer" role on the signing account, and these three settings (the values
belong to your Azure account, so they stay out of the repository):

```sh
WINDOWS_SIGN=1 \
WINDOWS_SIGN_ENDPOINT="<region>.codesigning.azure.net" \
WINDOWS_SIGN_ALIAS="<signing account>/<certificate profile>" \
scripts/windows.sh build
```

`scripts/sign-windows.sh` is the signing step: Tauri's
`bundle.windows.signCommand` runs it for each file. That command lives in its
own file, `src-tauri/tauri.sign-windows.conf.json`, which `scripts/windows.sh`
adds only when `WINDOWS_SIGN=1`, so checks, CI and ordinary builds never
mention it. (It once sat in `tauri.windows.conf.json`; on GitHub's Windows
runner `bash` is the WSL launcher, which has no Linux installed, and the
build failed.) The access token for Azure is short-lived and
goes to `jsign` through the environment, never to disk or the command line.

Good to know:

- One build makes about eight signatures: the app, the installer, the
  uninstaller, and the installer's helper libraries. The plan allows a
  monthly number of them, so don't loop it.
- The signed app is inside the installer. Tauri puts the unsigned
  `mailboat.exe` back in `target/.../release/` afterwards, so check the
  installer, not that file.
- Microsoft's timestamp service only works with `jsign`'s `--tsmode RFC3161`,
  which the script sets.
- To check a signature, copy the installer to the Windows VM and use the
  file's Properties → Digital Signatures, or `Get-AuthenticodeSignature` in
  PowerShell. The publisher should be your name. Whether SmartScreen warns
  also depends on reputation, which builds up over time.

## A signed build on the Mac

Needs the Developer ID Application certificate (with its private key) in the
login keychain and a notarization profile saved with `xcrun notarytool
store-credentials` (here `mailboat-notary`, from an App Store Connect API
key). The certificate, the key file and the password for them live in the
owner's password manager, never in the repository.

```sh
# Build and sign (the hardened runtime is on by default); no notarization yet.
ID=$(security find-identity -v -p codesigning | grep "Developer ID Application" | sed -E 's/.*"(.*)"/\1/')
APPLE_SIGNING_IDENTITY="$ID" bun tauri build --bundles app

# Notarize with the saved profile, then attach the ticket.
APP=target/release/bundle/macos/Mailboat.app
ditto -c -k --keepParent "$APP" /tmp/Mailboat-notarize.zip
xcrun notarytool submit /tmp/Mailboat-notarize.zip --keychain-profile mailboat-notary --wait
xcrun stapler staple "$APP"

# Check: both should say it's fine ("Notarized Developer ID").
xcrun stapler validate "$APP"
spctl --assess --type execute -vv "$APP"
```

Tauri can also notarize during the build, but it reads the key's file path
and IDs from `APPLE_API_*` variables and can't use the saved profile; that is
how GitHub Actions will do it. Run the signed app once with `--demo` first (made-up mail),
then without it: macOS asks once for the keychain item that an unsigned dev
build made.

## Versions and the changelog

The version is written once, in `package.json` (`0.x` until the owner calls
it 1.0). Rust reads it at build time (`mail_core::brand::VERSION`) and
`tauri.conf.json` points at it, so nothing else needs editing. A
pre-release version (`0.2.0-beta.1`) has not been tried: the macOS bundle
strips the tag, and the Windows installer may not accept it, so check
that the first time one is used.

Each pull request adds a changeset, a small file in `.changeset/` made with
`bun run changeset` (`--empty` when people won't notice the change); CI
fails without one. At release, `bun run version-packages` turns the
changesets into the next version and a `CHANGELOG.md` entry; that release
pull request (branch `changeset-release/…`) and Dependabot's are the two
kinds CI doesn't ask a changeset of. Never edit either by hand. Details: `.changeset/README.md`.

## Files on your Mac

| What | Where |
|---|---|
| Mail cache (SQLite) | `~/Library/Application Support/com.nwoolls.mailboat/mail.sqlite3` |
| OAuth client file | `~/Library/Application Support/com.nwoolls.mailboat/google-oauth-client.json` |
| Sign-in tokens | macOS Keychain, service `com.nwoolls.mailboat` |
| Sync log | `~/Library/Logs/com.nwoolls.mailboat/sync.log` |
| AI summaries | In the mail cache (`ai_summaries`: the summary text, so it isn't generated twice) |
| AI usage | In the mail cache (`ai_usage`: sizes only, never prompts or answers) |
| AI apps' socket | `~/Library/Application Support/com.nwoolls.mailboat/mcp.sock` (while Mailboat runs) |
| AI apps' requests | In the mail cache (`mcp_log`: what was asked, never content; 30 days) |
