// Makes a release's files from what the release workflow's build jobs made:
// copies the ones that go on the release, writes `latest.json` (the manifest
// the app's updater reads) and SHA256SUMS, and takes the release notes from
// CHANGELOG.md. Before it makes anything, it checks every update file's
// signature the way the app will: against the public key in tauri.conf.json,
// and for this version. It fails, leaving nothing a person could publish by
// mistake, when a platform's update file or signature is missing, a signature
// is by another key or for another version, or the changelog has no section
// for the version.
//
//   bun scripts/make-release-files.ts --version 0.1.0 --repo owner/name \
//     --from <folder of build outputs> --to <folder for the release> \
//     --notes <file to write the release notes to> \
//     [--changelog CHANGELOG.md] [--conf src-tauri/tauri.conf.json]
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildManifest,
  changelogSection,
  checksumLines,
  isVersion,
  platformOf,
  publishable,
} from "./releaseFiles";
import { verifyMinisign } from "./minisign";

function option(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
}

function need(name: string): string {
  const value = option(name);
  if (!value) {
    console.error(`Missing --${name}`);
    process.exit(2);
  }
  return value;
}

const version = need("version");
const repo = need("repo");
const from = need("from");
const to = need("to");
const notesPath = need("notes");
const changelogPath = option("changelog") ?? "CHANGELOG.md";
const confPath = option("conf") ?? "src-tauri/tauri.conf.json";

function fail(message: string): never {
  console.error(`make-release-files: ${message}`);
  process.exit(1);
}

if (!isVersion(version)) fail(`"${version}" isn't a version like 1.2.3`);

const notes = changelogSection(readFileSync(changelogPath, "utf8"), version);
if (notes === null) {
  fail(`${changelogPath} has no section "## ${version}": write it before tagging the release`);
}

const all = readdirSync(from);
const chosen = all.filter(publishable).toSorted();
const payloads = chosen.filter((f) => platformOf(f) !== null);
const signatures = payloads.map((file) => {
  const sig = chosen.includes(`${file}.sig`) ? readFileSync(join(from, `${file}.sig`), "utf8") : "";
  return { file, signature: sig };
});

// The app refuses an update that isn't signed by its key for its version, so
// find that out here, before anything is published.
const pubkey = JSON.parse(readFileSync(confPath, "utf8"))?.plugins?.updater?.pubkey;
if (typeof pubkey !== "string") fail(`${confPath} has no plugins.updater.pubkey`);
for (const { file, signature } of signatures) {
  try {
    const verified = verifyMinisign({
      file: readFileSync(join(from, file)),
      signature: signature.trim(),
      pubkey,
    });
    if (verified.version !== version) {
      throw new Error(`it was signed for version ${verified.version ?? "(none recorded)"}`);
    }
  } catch (error) {
    fail(`${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

let manifest;
try {
  manifest = buildManifest({ version, repo, pubDate: new Date(), files: signatures });
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

mkdirSync(to, { recursive: true });
for (const file of chosen) copyFileSync(join(from, file), join(to, file));
writeFileSync(join(to, "latest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

const entries = readdirSync(to).map((file) => ({
  file,
  sha256: createHash("sha256")
    .update(readFileSync(join(to, file)))
    .digest("hex"),
}));
writeFileSync(join(to, "SHA256SUMS"), checksumLines(entries));
writeFileSync(notesPath, `${notes}\n`);

console.log(`Release ${version}: ${readdirSync(to).length} files in ${to}`);
for (const file of readdirSync(to).toSorted()) console.log(`  ${file}`);
