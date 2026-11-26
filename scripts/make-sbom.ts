// Writes the release's software bills of materials (`sbom.ts`), one per
// download, since each platform's build ships different Rust crates:
//
//   bun scripts/make-sbom.ts --version 0.3.0 --out release-sbom
//
// Run after `bun install --frozen-lockfile` (it reads installed packages'
// licenses) with Rust installed (it asks `cargo tree`, twice per platform
// the release builds). A build script's own crates follow the computer that
// builds, so each download's bill is made on the kind of computer that
// builds it (`host` in `SBOM_DOWNLOADS`, `releaseFiles.ts`): today all of
// them on a Mac, Windows' cross-built there. Writes
// `<App>_<version>_<download>.cdx.json` in `--out` for each of those.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import brand from "../brand.json";
import { isVersion, SBOM_DOWNLOADS, sbomName } from "./releaseFiles";
import { type BunLock, cargoChecksums, downloadBom, installPath, npmComponents } from "./sbom";

function option(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
}

function fail(message: string): never {
  console.error(`make-sbom: ${message}`);
  process.exit(1);
}

const version = option("version") ?? fail("missing --version");
const out = option("out") ?? fail("missing --out");
if (!isVersion(version)) fail(`"${version}" isn't a version like 1.2.3`);

/** `cargo tree` for `target` through `edges`, a line per crate with its license. */
function tree(target: string, edges: string): string {
  const run = spawnSync(
    "cargo",
    [
      "tree",
      "--locked",
      "--manifest-path",
      "src-tauri/Cargo.toml",
      "--target",
      target,
      "-e",
      edges,
      "--prefix",
      "none",
      "--format",
      "{p}\t{l}",
    ],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
  if (run.status !== 0) fail(`cargo tree for ${target} failed:\n${run.stderr}`);
  return run.stdout;
}
// Only the downloads built on this kind of computer: the build tools'
// crates depend on it.
const downloads = SBOM_DOWNLOADS.filter(
  (d) => d.host === process.platform && (!("arch" in d) || d.arch === process.arch),
);
if (downloads.length === 0) {
  fail(`no download is built on ${process.platform}: run on a Mac, as the release does`);
}
const checksums = cargoChecksums(readFileSync("Cargo.lock", "utf8"));

const lock = Bun.JSONC.parse(readFileSync("bun.lock", "utf8")) as BunLock;
const license = (key: string): string | undefined => {
  const path = join(installPath(key), "package.json");
  if (!existsSync(path)) return undefined;
  const pkg = JSON.parse(readFileSync(path, "utf8"));
  if (typeof pkg.license === "string") return pkg.license;
  if (typeof pkg.license?.type === "string") return pkg.license.type;
  if (Array.isArray(pkg.licenses))
    return pkg.licenses.map((l: { type: string }) => l.type).join(" OR ");
  return undefined;
};
const js = npmComponents(lock, license);

mkdirSync(out, { recursive: true });
const count = (list: { scope?: string }[], scope: string) =>
  list.filter((c) => c.scope === scope).length;
for (const download of downloads) {
  const { rust, document } = downloadBom({
    name: brand.name,
    version,
    target: download.target,
    tree,
    checksums,
    js,
    timestamp: new Date().toISOString(),
    serial: crypto.randomUUID(),
  });
  const file = join(out, sbomName(brand.name, version, download));
  writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`);
  console.log(`${file}: ${document.components.length} components`);
  console.log(`  Rust: ${count(rust, "required")} shipped, ${count(rust, "excluded")} build-only`);
  console.log(
    `  JavaScript: ${count(js, "required")} shipped, ${count(js, "optional")} optional, ${count(js, "excluded")} build-only`,
  );
  // Every shipped component must say its license: the lab reads them, and
  // the project's license (GPL-3.0-only) has to allow each. Build-only
  // packages may lack one: a platform's binary package that isn't installed
  // on this computer can't be read.
  const unlicensed = document.components.filter((c) => c.scope !== "excluded" && !c.licenses);
  if (unlicensed.length) {
    fail(`no license found for ${unlicensed.map((c) => c.purl).join(", ")}`);
  }
}
