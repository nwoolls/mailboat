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
# List your signing identities and copy the name of the Developer ID one.
# Nothing listed means the certificate (or its private key) isn't in this
# keychain, so stop there. Pick the name yourself: with two, guessing could
# sign a release with the wrong certificate.
security find-identity -v -p codesigning | grep "Developer ID Application"

# Build and sign (the hardened runtime is on by default); no notarization yet.
ID="Developer ID Application: <name from the list> (<team id>)"
APPLE_SIGNING_IDENTITY="$ID" bun tauri build --bundles app

# Notarize with the saved profile, then attach the ticket.
APP=target/release/bundle/macos/Mailboat.app
ditto -c -k --keepParent "$APP" /tmp/Mailboat-notarize.zip
xcrun notarytool submit /tmp/Mailboat-notarize.zip --keychain-profile mailboat-notary --wait
xcrun stapler staple "$APP"

# Check: the first says "The validate action worked!", the second prints
# "source=Notarized Developer ID" (and the signer's name, locally).
xcrun stapler validate "$APP"
spctl --assess --type execute -vv "$APP"
```

Tauri can also notarize during the build, but it reads the key's file path
and IDs from `APPLE_API_*` variables and can't use the saved profile; that is
how GitHub Actions will do it.

Try the signed app before trusting it, starting with demo mode (made-up mail,
and no keychain), then without it:

```sh
"$APP/Contents/MacOS/mailboat" --demo
open -n "$APP"
```

Use these two commands, not `bun run demo` or `open -a Mailboat`: those start
a dev build or an installed copy, not the one you just signed. The second
run asks once for the keychain item your dev builds made: they are signed
with the Apple Development certificate, so a Developer ID build looks like a
different app to macOS. "Always Allow" ends the question for this signature.

## The release workflow

`.github/workflows/release.yml` builds, signs and notarizes the Mac app, and
builds and signs the Windows installers (x64 and ARM64), on GitHub's own
macOS runners, so a release doesn't depend on one laptop. For now it only
keeps the results as artifacts for a week; publishing and the update file are
separate, later changes.

It is started by a version tag (see "Releasing" below), or by hand: Actions →
Release → Run workflow, on `main`, which only makes the builds. It then waits
in the `release` environment for your approval (the run page shows a
Review deployments button). That environment is where the signing secrets
live. It lets only `main` use them, requires a reviewer, and has admin bypass
off, so a pull request, or a run you didn't expect, can't reach them.

The secrets (environment secrets, not repository ones): `APPLE_CERTIFICATE`
(the `.p12`, base64), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_API_KEY_CONTENT`
(the `.p8` text), `APPLE_API_KEY_ID` and `APPLE_API_ISSUER_ID`. Set each with
`gh secret set <name> --env release --repo <owner>/<repo>`, so a value never
sits in your shell history, and delete any file you saved afterwards:

```sh
base64 -i Certificate.p12 | gh secret set APPLE_CERTIFICATE --env release ...
gh secret set APPLE_API_KEY_CONTENT --env release ... < AuthKey_XXXXXXXXXX.p8
gh secret set APPLE_CERTIFICATE_PASSWORD --env release ...   # prompts
gh secret set APPLE_API_KEY_ID --env release ...             # prompts
gh secret set APPLE_API_ISSUER_ID --env release ...          # prompts
```

The certificate has to go in as base64 text (the first command), not the raw
file. To replace the certificate or the key, set the same names again.

What the job does: `scripts/import-apple-certificate.sh` puts the certificate
in a throwaway keychain (and stops unless there is exactly one Developer ID
identity); Tauri signs, notarizes and staples the app through `APPLE_API_*`
and signs the disk image; a separate step notarizes and staples the disk image
with `notarytool` (Tauri doesn't, and Gatekeeper calls an unnotarized image
"Unnotarized Developer ID"); the job then checks the signature, the ticket and
Gatekeeper's verdict on the app and on the disk image, and that every binary
in the app is Apple silicon only. It always deletes the keychain and the key
file at the end, and uses no build cache.

The Windows jobs cross-build the installers on a Mac runner, as
`scripts/windows.sh` does on your machine, and sign them with
`scripts/sign-windows.sh` through Azure Artifact Signing. They need no stored
password: the job asks GitHub for a short-lived token, and Azure accepts it
because of a trust set up on an Azure app registration, for runs in the
`release` environment only. The trust's subject must be exactly what GitHub puts
in the token: this repository uses immutable subjects, which include numeric
owner and repository IDs, so take the prefix from `gh api
repos/<owner>/<repo>/actions/oidc/customization/sub` and add
`:environment:release`. A login that fails with "no matching federated
identity record" is this subject being wrong. GitHub's login token lasts only
about five minutes, so the job fetches the signing service's token straight
after logging in; a build that ran for more than about an hour after that would
need to log in again. That app has one role, "Artifact Signing
Certificate Profile Signer", on the one certificate profile. The environment
holds two more secrets (`AZURE_CLIENT_ID` and `AZURE_TENANT_ID`; the login is
at tenant level, since signing needs no subscription) and two variables, which are names and not secrets
(`WINDOWS_SIGN_ENDPOINT`, `WINDOWS_SIGN_ALIAS`: the signing account and the
certificate profile, as in the signed Windows installer section). Afterwards
`scripts/check-windows-signature.ts` fails the job unless the installer and
the app and uninstaller inside it are all signed. Each build makes about eight
signatures per installer.

## Updates

The app updates itself through Tauri's updater plugin, in Rust only
(`src-tauri/src/updates.rs`): the web side has no permission for the plugin,
and only calls two commands, "check" and "install". The address and the public
key are in `src-tauri/tauri.conf.json` (`plugins.updater`). The address is
`https://getmailboat.app/updates/latest.json`, a Cloudflare redirect rule (302)
to the newest release's `latest.json` on GitHub, so hosting can change without
stranding installed copies. The app installs only an update signed by the
private key that matches the public one in the config.

- **The key.** Made with `bun tauri signer generate -w ~/.tauri/updater.key`.
  The private half and its password are in the owner's password manager and in
  the `release` environment (`TAURI_SIGNING_PRIVATE_KEY` and
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`). If the private key is lost, installed
  copies can never be updated again, only reinstalled by hand, so keep it backed
  up. The public key is only a public key; it is in the config.
- **When it looks.** About 30 seconds after launch and then about daily, unless
  Settings → About → "Check for updates automatically" is off. It tells the
  window, which shows a notice; it never installs without a click. A look
  fetches one static file, so the update server and GitHub see the IP address
  and the updater's own user agent; the app's version and the kind of computer
  are not sent, and GitHub learns the kind of computer when an update is
  downloaded. A development
  build, the demo and a clean start don't look at all.
- **Restarting.** "Install and restart" restarts the app at once, so it first
  saves every open draft (they otherwise save 2.5 seconds after typing stops,
  and a message typed without a pause would never have been saved); if one
  can't be saved, nothing is installed and the notice says so.
- **What a person sees from the manifest.** Only the version. The manifest
  (`latest.json`) is not signed, only the downloaded update is, so no release
  notes are shown, and `requireSignedVersion` has the plugin refuse an update
  whose signature wasn't made for the version announced (otherwise a crafted
  manifest could pair a newer number with an older, genuinely signed release).
  The Tauri CLI records the version in each signature when it builds, so the
  first release needs nothing extra, but check that its signature carries
  `version:` before publishing it.
- **The files.** A release build (the release workflow) turns on
  `createUpdaterArtifacts` through `src-tauri/tauri.updater-artifacts.conf.json`,
  and Tauri signs each update payload with the private key as its last step:
  the Mac app as a `.app.tar.gz`, and each Windows installer itself (after its
  Authenticode signing, so the signature covers the final file). A normal build
  doesn't, since that needs the key. The `latest.json` the app reads is made by
  the release workflow (`scripts/make-release-files.ts`). Until a release is
  *published* the address answers 404 and a check says it couldn't reach the
  update server: a draft isn't visible to it.

## Releasing

A release is a version tag. The workflow (`.github/workflows/release.yml`)
builds everything, checks it, and makes a **draft** GitHub Release; nothing is
public until the owner publishes the draft.

**Cutting one**
1. On a branch named `changeset-release/<something>`, run `bun run
   version-packages`: it applies the pending changesets, bumps `package.json`
   and writes the `## <version>` section of `CHANGELOG.md`, which becomes the
   release notes. Open a pull request and merge it. (The first release,
   `0.1.0`, has no bump: write its `## 0.1.0` section in `CHANGELOG.md` by hand.)
2. Tag the merged commit on `main` and push the tag as yourself:
   `git tag v0.1.0 <commit> && git push origin v0.1.0`. The tag must be `v`
   and the version in `package.json`, and be on `main`; the workflow's first
   job fails in seconds otherwise, before any build.
3. Open the run on the Actions tab, **Review deployments**, and approve the
   three build jobs. They take about 10 to 15 minutes. Then approve **publish**,
   which waits for its own approval and has none of the signing secrets.
4. The publish job checks every update signature against the public key in the
   app and for this version (and makes nothing if one is wrong), writes
   `latest.json` and `SHA256SUMS`, attests where the files came from, and makes
   the draft release.
5. Read the draft on GitHub (files, notes), then **Publish release**. Only a
   published release is what the update address redirects to.

A run started by hand ("Run workflow") makes the same builds as artifacts and
publishes nothing, to try the builds without a tag. A pre-release tag
(`v0.2.0-beta.1`) is marked as a pre-release, so it is never "latest" and never
offered as an update.

**One-time setup** (repository settings, not in the code)
- Environment `release` must allow tags `v*` as well as `main`: `gh api -X POST
  repos/<owner>/<repo>/environments/release/deployment-branch-policies -f
  name='v*' -f type=tag`.
- An environment `publish`: a required reviewer (the owner, self-review
  allowed), admin bypass off, deployments limited to tags `v*`, and no
  secrets.

**Checking a download**
- `shasum -a 256 -c SHA256SUMS` in the folder with the files.
- `gh attestation verify <file> --repo <owner>/<repo>` says the file was built
  by this repository's release workflow from a given commit.

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
