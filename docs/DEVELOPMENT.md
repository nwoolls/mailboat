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
drawn by the app's own code, with sliders for every number that sets how the
glow, the pond, the sky and bubble wrap look, for how the glow moves, and for how the
pointer stirs the pond. A switch shows pixel art or ASCII art.
It has light and dark, the accent colors, and switches to hide the icon
and words or to drop stones by themselves. It lists the values changed
from the defaults so they can be copied into the code
(`ASCII_GLOW_DEFAULTS` in `src/features/mailbox/model/asciiGlow.ts`,
`PIXEL_GLOW_DEFAULTS` in `src/features/mailbox/model/pixelGlow.ts`,
`GLOW_MOTION_DEFAULTS` in `src/features/mailbox/model/glow.ts`,
`SKY_SCENE_DEFAULTS` in `src/features/emptyToys/model/skyScene.ts`,
`ASCII_SKY_DEFAULTS` in `src/features/emptyToys/model/asciiSky.ts`,
`ASCII_POND_DEFAULTS` in `src/features/emptyToys/model/asciiPond.ts`,
`PIXEL_POND_DEFAULTS` in `src/features/emptyToys/model/pixelPond.ts`,
`BUBBLE_DEFAULTS` in `src/features/emptyToys/model/bubblePop.ts`,
`SCREENSAVER_LOOK_DEFAULTS` in `src/features/screensaver/model/looks.ts`,
`DEEP_JELLY_DEFAULTS` in `src/features/screensaver/model/deepJellies.ts`,
`DEEP_STAR_DEFAULTS` in `src/features/screensaver/model/deepStars.ts`,
`DEEP_FIREWORK_DEFAULTS` in `src/features/screensaver/model/deepFireworks.ts`,
`DEEP_RAIN_DEFAULTS` in `src/features/screensaver/model/deepRain.ts`,
`CODE_RAIN_DEFAULTS` in `src/features/screensaver/model/codeRain.ts`,
`DEEP_FIREFLY_DEFAULTS` in `src/features/screensaver/model/deepFireflies.ts`,
`DEEP_LIFE_DEFAULTS` in `src/features/screensaver/model/deepLife.ts`,
`MURMURATION_DEFAULTS` in `src/features/screensaver/model/murmuration.ts`,
`POND_STIR_DEFAULTS` in `src/features/emptyToys/model/pond.ts`). The app
itself always uses the defaults.

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

Newer features to try in the demo:

- **Outside recipients.** In the work account, open "Fernhill rebrand:
  round 2 feedback" and Reply all: the client's colleague on Cc, who isn't
  in the contacts, is marked, with a note above the message. The personal
  account counts as a personal Gmail account (`"personal": true` in the demo
  data; the app otherwise treats any address not on `gmail.com` or
  `googlemail.com` as Google Workspace), so it never warns.
- **Details.** "Benefits enrollment closes Friday" went to eight people;
  Details shows them all.
- **Links without tracking codes.** The link in "Autumn notebooks are here"
  carries `utm_` codes; it opens in the browser without them.
- **The update notice.** About 20 seconds after the demo opens, if Settings
  → About → "Check for updates automatically" is on (it is at first), the
  notice offers an update; "Check for updates" offers it at any time. The
  version offered is the app's own, so What's new opens that version's
  release page, which exists once the version is published (a branch
  already at the next, unpublished version opens a missing page). Install
  shows a made-up download, then says the demo installs nothing. Nothing is
  fetched. `MAILBOAT_DEMO_UPDATE_AFTER=<seconds>` changes when the notice
  comes, and `=off` leaves it out (the screenshots do).

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

## Linux (built in Docker on the Mac)

Tauri's Linux build needs GTK and WebKitGTK, so it can't be cross-compiled
from macOS as the Windows build is. `scripts/linux.sh` runs it in a Docker
container instead: Ubuntu 22.04, the oldest Ubuntu Tauri supports, which CI
and the test builds use too. Start Docker Desktop, then:

```sh
scripts/linux.sh check   # clippy and the Rust tests, on Linux
scripts/linux.sh build   # the .deb, .rpm and AppImage, into target/linux/bundle/
scripts/linux.sh shell   # a shell in the container
```

The first run builds the image, which takes a few minutes. The container
works on a copy of the repository, so the Mac's `node_modules` and `target`
are never touched; Rust's build and Bun's packages stay in Docker volumes
(`mailboat-linux-*`) between runs. Those take about 20 GB once both `check`
and `build` have run, so Docker Desktop's disk needs room for them (Settings
→ Resources); `docker volume rm` them to get it back. The container has the Mac's processor, so
on Apple silicon the packages are for Arm Linux; the test builds on a pull
request make both Arm and Intel/AMD ones.

To try a package, install it in a Linux VM (UTM or Parallels on the Mac) or
on a Linux computer: `sudo apt install ./Mailboat_<version>_arm64.deb` on
Debian or Ubuntu, `sudo dnf install ./Mailboat-<version>-1.aarch64.rpm` on
Fedora, or make the AppImage executable and run it. Sign-in needs the
desktop's keyring (GNOME Keyring or KWallet) running and unlocked, as it is
on an ordinary GNOME or KDE desktop. The Google client file goes in
`~/.config/com.nwoolls.mailboat/google-oauth-client.json`.

On Linux the window keeps the desktop's own title bar, and is painted with
the theme's base color, since WebKitGTK has no blur behind a window.
Apple Intelligence is a Mac feature, so AI uses Claude or ChatGPT there.
Not yet on Linux: email links (`mailto:`), the click on a notification, and
updates (the release has no Linux builds yet); see the roadmap.

## Check

```sh
bun run check:quick   # while working: only what changed, fast tests only
bun run check         # everything (format, lint, types, Vitest, clippy, cargo test, Playwright); before committing
```

The browser tests (`tests/browser`, Playwright) need WebKit and Chromium once:

```sh
bunx playwright install webkit chromium
```

A browser test that measures motion or timing should pass on a slow machine
too. `bun run test:browser:slow` runs the tests with the page kept busy most
of the time (`tests/browser/slowMachine.ts`), as on a loaded CI runner, so
check such a test with it before trusting it; the whole suite takes about 25
minutes this way. A test that measures motion drives the page's clock
(`tests/browser/time.ts`) rather than waiting real time. A test that checks
what shows while the harness's fake Rust side is still answering (stand-ins
while the AI's reply ideas load, for example) has the harness hold that
answer until the test releases it (`&ideas=held` and
`window.__releaseIdeas()`), so the check can't come too late. The slowed page
doesn't catch that race, since the harness's timer slows with the page;
adding a pause between the action and the check does. To run a second set
of browser tests beside a long one, give it another port:
`BROWSER_TESTS_PORT=1437 bun run test:browser …`.

### A browser test that fails now and then

These steps come from the fixes written up in `docs/ROADMAP.md` → Flaky
tests:

1. Read what CI kept. A failed run uploads `playwright-report` with a trace
   of the failing test: `gh run download <run> -n playwright-report -D <dir>`.
   Each `*.trace` file in `trace.zip` is one JSON event per line, and the
   `after` events carry what each step returned (every value a poll read,
   for example). Read with the step times, they usually show what was late.
2. Work in a separate worktree (`git worktree add`), branched from `main`
   when the test and the code it covers are on `main`.
3. Try to make it fail: `--repeat-each=20`, then the slowed page
   (`bun run test:browser:slow`), then `--workers=8`, then with every core
   busy. For the last, run `gitleaks git` on the repository in a loop, one
   per core, beside the tests; ask the owner before starting it, since it
   takes the whole machine.
4. If it still passes, force the timing instead of waiting for luck. A
   throwaway spec that sweeps the suspect delay (when a stall starts and
   how long it lasts, a pause before a check) and prints the result of
   each run finds the timing that fails. Then confirm the cause by taking
   it away (a timer moved far out, say) and seeing the failure go.
5. Fix the cause, whether it is in the app or in the test. Wait on frames
   or events, not on the clock. A test can drive the page's clock
   (`tests/browser/time.ts`) or have the harness hold an answer until it
   releases it (`&ideas=held`, in the paragraph before this section). A
   test that waits for animations to end counts only running ones (one that
   holds its end state stays in `getAnimations()` after it ends), and also
   takes the start events as motion (on a slow machine an animation can
   start and end between two frames). Give such a wait a cap in frames, so
   it fails with its own message instead of the test's timeout.
6. Make the test fail without the fix (a longer stall, a held answer), so
   it no longer needs a slow runner to catch the problem. Then run it with
   the fix: repeated, slowed, on 8 workers and under load, and record the
   counts in the roadmap entry.
7. Pick the changeset by what the fix changed. A fix only to tests, the
   test harness or docs takes an empty one (`bun run changeset --empty`).
   A fix that changes the app's code takes a real one, usually a `patch`,
   even when the problem only shows on a slow machine (`AGENTS.md` →
   Versions). Its sentence says what a person using the app would notice,
   and if they'd notice nothing, it says that plainly.

### Test coverage

```sh
bun run coverage
```

Prints how much of the code the tests run, by area: the TypeScript logic
(`src/**/model`), the components (`src/**/ui`), the build and release
scripts, the rest of `src` (the app shell, shared code, the platform
layer), and the Rust core (`crates/core`). The components are thin and are
exercised by the browser tests, which this doesn't measure, so read their
number with that in mind. The Rust part needs `cargo-llvm-cov` once:

```sh
rustup component add llvm-tools-preview
cargo install cargo-llvm-cov --locked
```

Coverage is measured on demand, not checked: nothing fails below a set
number.

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
and IDs from `APPLE_API_*` variables and can't use the saved profile; the
release workflow does it that way (see below).

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
  build, the demo and a clean start don't look at all (the demo shows a
  made-up update instead, see Demo mode).
- **Restarting.** "Install and restart" restarts the app at once, so it first
  saves every open draft (they otherwise save 2.5 seconds after typing stops,
  and a message typed without a pause would never have been saved); if one
  can't be saved, nothing is installed and the notice says so. On the Mac the
  app quits and a helper opens it again once it has ended
  (`mail_core::relaunch`), so it comes back as the app in the Dock; Tauri's
  restart is the fallback.
- **What a person sees from the manifest.** Only the version. The manifest
  (`latest.json`) is not signed, only the downloaded update is, so no release
  notes are shown, and `requireSignedVersion` has the plugin refuse an update
  whose signature wasn't made for the version announced (otherwise a crafted
  manifest could pair a newer number with an older, genuinely signed release).
  The Tauri CLI records the version in each signature when it builds, and the
  release workflow's publish job checks every signature for it (see Releasing).
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
   release notes. Never edit the version by hand; curate the new section
   (see "Curating the release notes" below). A later beta needs at least one
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
   betas included, and writes the `## 0.2.0` section of `CHANGELOG.md`. It
   is the release notes: curate it (below), starting from the betas'
   curated sections, since it lists every changeset again. Change the version in `README.md` (the notice near the top,
   `Version 0.2.1 is out, …`), and for a new major or minor version also the
   one on the home page (the chip at the top of `website/index.html`,
   `v0.2 · …`): `bun run check` fails until both match `package.json`.
4. Run `bun run check`, commit, open a pull request, merge it.
5. Tag, build and publish (steps below), with the tag `v` plus the version
   from step 3 (`v0.2.0`).

**Curating the release notes** (on the release branch, after
`version-packages`, for a beta and a stable release alike)

`version-packages` writes one line per changeset, in no useful order, so the
new section reads as a list of pull requests. Rewrite that one section into
notes for people:

- Group the lines by topic under `###` headings, most interesting first:
  `New` (what people can do now), then the areas that changed (such as
  `Window and toolbar` or `Toybox and screensavers`), then fixes, then
  `Security and privacy`, then `Releases` (what comes with each download).
  Drop Changesets' `Minor Changes` and `Patch Changes` headings. A short
  bold lead (`**Print a conversation.**`) can start a new feature's line.
- Merge lines about the same thing into one, and say what they share once
  (one line for "every screensaver can be drawn in pixel art or ASCII art",
  not one per screensaver).
- Leave out a fix to something new in the same release (people never saw the
  problem) and details only the change's author would notice.
- Keep every change people can see or rely on, with its facts: names of
  settings and menus, shortcuts, defaults, platforms. Add nothing the
  changesets don't say.
- Change only the new section: never the version heading, the version in
  `package.json`, an older section, or the changeset files.
- Run `declauding`, then `unslop`, on the section (AGENTS.md → Writing for
  people), and `bun scripts/check-release-tag.ts v<version>`, which reads the
  section the release uses.

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
   the draft release. The release also carries a software bill of materials
   for each download, named after it: `<App>_<version>_aarch64.cdx.json` for
   the Mac app, `…_x64.cdx.json` and `…_arm64.cdx.json` for the Windows
   installers (CycloneDX: every Rust crate that platform's build ships or
   uses, and every JavaScript package, each with its hash; every shipped or
   optional one with its license, while a build-only package not installed
   on the Mac that makes the files can lack one). Each
   platform ships different Rust crates, so one file for all three would
   list crates a download doesn't contain. A read-only `sbom` job makes them
   with `scripts/make-sbom.ts`, on a Mac like every build; without all three
   the publish job makes nothing. CI makes them on every pull request that
   changes the app, so a shipped dependency without a license fails there
   first. To make them locally, on a Mac:
   `bun scripts/make-sbom.ts --version <version> --out <folder>`.
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
  by this repository's release workflow from a given commit. The same
  attestation is on the release as files: `<App>_<version>.sigstore.json`
  (`gh attestation verify <file> --repo <owner>/<repo> --bundle <that file>`
  checks against it without asking GitHub) and `<App>_<version>.intoto.jsonl`,
  its signed statements, which OpenSSF Scorecard looks for. Both are made
  after the checksums, so `SHA256SUMS` doesn't list them.

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
kinds CI doesn't ask a changeset of. Never edit the version by hand. The new
`CHANGELOG.md` section is curated on the release branch (Releasing →
Curating the release notes); older sections stay as they were. Details:
`.changeset/README.md`.

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

## Files on Linux

| What | Where |
|---|---|
| Mail cache (SQLite) | `~/.local/share/com.nwoolls.mailboat/mail.sqlite3` |
| OAuth client file | `~/.config/com.nwoolls.mailboat/google-oauth-client.json` |
| Sign-in tokens | The desktop's keyring (Secret Service), service `com.nwoolls.mailboat` |
| Sync log | `~/.local/share/com.nwoolls.mailboat/logs/sync.log` |
| AI apps' socket | `~/.local/share/com.nwoolls.mailboat/mcp.sock` (while Mailboat runs) |

`~/.local/share` and `~/.config` are `$XDG_DATA_HOME` and `$XDG_CONFIG_HOME`
when those are set. Everything else is in the mail cache, as on the Mac.
