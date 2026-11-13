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

### Toybox playground

```sh
bun run playground
```

Opens the empty view in your browser (http://localhost:1437/playground/),
drawn by the app's own code, with sliders for each number the ASCII
glow's look depends on, light and dark, and the accent colors. It lists
the values changed from the defaults so they can be copied into the code
(`ASCII_GLOW_DEFAULTS` in `src/features/mailbox/model/asciiGlow.ts`). The
app itself always uses the defaults.

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

### Fuzzing

The code that reads untrusted email is also fuzzed with cargo-fuzz, which
needs the nightly toolchain: see `fuzz/README.md`. You don't need it for the
checks above. The same safety checks run as property tests in `cargo test`,
and a weekly job (`.github/workflows/fuzz.yml`) fuzzes for longer.

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
macOS runners, so a release doesn't depend on one laptop. A tag run then
turns the results into a draft GitHub release (see "Releasing" below); a run
started by hand only keeps the builds as artifacts for a week.

It is started by a version tag (see "Releasing" below), or by hand: Actions →
Release → Run workflow, on `main`, which only makes the builds. It then waits
in the `release` environment for your approval (the run page shows a
Review deployments button). That environment is where the signing secrets
live. It lets only `main` and `v*` tags use them, requires a reviewer, and has
admin bypass off, so a pull request, or a run you didn't expect, can't reach them.

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

- **Update channels.** Settings → About → "Update channel" is Stable (the
  default) or Beta. Stable reads the address above, which follows GitHub's
  "latest" release and so never sees a pre-release. Beta reads
  `https://getmailboat.app/updates/beta/latest.json` (the same address with
  `beta/` before the file name, made in `src-tauri/src/updates.rs`), a second
  Cloudflare redirect rule (302) to
  `https://github.com/<owner>/<repo>/releases/download/updates-beta/latest.json`.
  That file is kept by `.github/workflows/update-channel.yml`: each time a
  release is published, pre-release or not, it copies the release's
  `latest.json` to the one release tagged `updates-beta` (created the first
  time), unless the channel already points at a newer version (runs can finish out of order, and an older release can be published later: `scripts/keep-newer-manifest.ts` decides), so a Beta install is offered the newest published release, and a
  finished release once it is newer than the test version in use. Versions
  compare as semver: `0.2.0-beta.1` < `0.2.0-beta.2` < `0.2.0`, and
  `0.2.0-beta.1` is *older* than an installed `0.2.0`, so a test version
  has to be numbered above what is installed. Choosing Stable again never
  installs an older version. The manifest isn't signed, so the channel gets no
  more trust than Stable: only an update signed by the app's key, for the
  version announced, installs.
- **Trying an update before shipping it.** See Releasing. It needs the second
  redirect rule above, in place once. Tried 2026-11-10: a hand-installed
  `0.2.0-beta.0` on macOS and Windows updated in the app to `0.2.0-beta.1`.

## Releasing

A release is a version tag. The workflow (`.github/workflows/release.yml`)
builds everything, checks it, and makes a **draft** GitHub Release; nothing is
public until the owner publishes the draft. There are two kinds:

- A **beta** (`v0.2.0-beta.0`) is a test version. It is marked as a
  pre-release on GitHub, so Stable installs never see it, and Beta installs
  are offered it (Settings → About → Update channel; see Updates). Use one to
  try a change, or the update path itself, on a real install before everyone
  gets it.
- A **stable** release (`v0.2.0`) goes to everyone.

Versions come only from Changesets, never by hand (`0.0.1` and `0.0.2` were
the two exceptions). The owner decides when to cut a release, and tags and
publishes it; an agent prepares the branch and says what is left.

**Where the repository is.** If `.changeset/pre.json` exists with
`"mode": "pre"` (or `"exit"`, between `pre exit` and `version-packages`),
the repository is in beta mode: `bun run version-packages`
makes the next beta, not a stable version. Leave beta mode only to ship a
stable release (below), and only when the owner says to.

**A beta** (the first beta of a version, or the next one)
1. Branch `changeset-release/<version>-beta` from an up-to-date `main`.
2. For the first beta of a version, run `bunx changeset pre enter beta`. For
   a later one, skip this: the mode is already on.
3. Run `bun run version-packages`. The pending changesets move into
   `.changeset/pre/`, `package.json` becomes `0.2.0-beta.0` (then `.1`, and so
   on), and `CHANGELOG.md` gets a section for that version, which becomes the
   release notes. Never edit either by hand. A later beta needs at least one
   changeset added since the last one that asks for a release (a `patch` or
   more; an empty one doesn't): the archived ones in `.changeset/pre/` don't
   count again. If none was added, `version-packages` changes nothing, so
   there is no new beta. Read the version it wrote in `package.json`; that is
   the version, and the tag, of this beta.
4. Run `bun run check`, commit, and open a pull request (CI asks no changeset
   of a `changeset-release/…` branch). Merge it.
5. Tag, build and publish (steps below), with the tag `v` plus the version
   from step 3 (`v0.2.0-beta.0`, then `v0.2.0-beta.1`, and so on). A tag
   that already exists is never moved or forced: make a new version instead.

While beta mode is on, every pull request still adds a changeset, as always.

**A stable release**
1. Branch `changeset-release/<version>` from an up-to-date `main`.
2. If the repository is in beta mode, run `bunx changeset pre exit`. Changesets
   then asks you to review the files in `.changeset/pre/`, which become the
   notes of the stable version, so keep only what that release should list.
   Don't commit this step alone: until step 3 has run, `.changeset/pre.json`
   says `"mode": "exit"` and the repository looks as if beta mode were off.
3. Run `bun run version-packages`. It makes `0.2.0` from every changeset,
   betas included, and writes the `## 0.2.0` section of `CHANGELOG.md`. Read
   the section: it is the release notes, and it should list what the release
   changed. For a new major or minor version, also change the version on the
   home page (the chip at the top of `website/index.html`, `v0.2 · …`):
   `bun run check` fails until it matches `package.json`.
4. Run `bun run check`, commit, open a pull request, merge it.
5. Tag, build and publish (steps below), with the tag `v` plus the version
   from step 3 (`v0.2.0`).

**Tag, build and publish** (the same for both)
1. Tag the merged commit on `main` and push the tag as yourself:
   `git tag v<version> <commit> && git push origin v<version>`. The tag must be
   `v` and the version in `package.json`, and be on `main`; the workflow's first
   job fails in seconds otherwise, before any build.
2. Open the run on the Actions tab, **Review deployments**, and approve the
   three build jobs. They take about 10 to 15 minutes. Then approve **publish**,
   which waits for its own approval and has none of the signing secrets.
3. The publish job checks every update signature against the public key in the
   app and for this version (and makes nothing if one is wrong), writes
   `latest.json` and `SHA256SUMS`, attests where the files came from, and makes
   the draft release.
4. Read the draft on GitHub (files, notes), then **Publish release**. Only a
   published release is what the update addresses redirect to. Publishing
   also runs `update-channel.yml`, which points the Beta channel at it.
5. Check the result: `curl -sI https://getmailboat.app/updates/latest.json`
   and `.../updates/beta/latest.json` each answer 302, and the file behind the
   one for this release's channel has its version. Then "Check for updates" on
   an install of that channel.

**Trying an update before shipping it.** Install the newest release by hand
once and set Update channel to Beta. Cut a beta numbered above it, as above.
Within a minute of publishing, "Check for updates" finds it; install it to
try the real path (download, signature check, restart) without a development
build. Betas after that arrive through the updater.

A run started by hand ("Run workflow") makes the same builds as artifacts and
publishes nothing, to try the builds without a tag.

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
pre-release version (`0.2.0-beta.0`) can't be built into a Windows MSI
(Tauri rejects a pre-release tag that isn't a number up to 65535), so Windows
builds only the NSIS installer (`bundle.targets` in
`src-tauri/tauri.windows.conf.json`), which is also the only one released.
That installer and the macOS bundle both take the tag: checked 2026-11-10,
when `0.2.0-beta.0` updated in the app to `0.2.0-beta.1` on both.

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
