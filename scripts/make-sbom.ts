// Writes the release's software bill of materials (`sbom.ts`):
//
//   bun scripts/make-sbom.ts --version 0.3.0 --out release-sbom
//
// Run after `bun install --frozen-lockfile` (it reads installed packages'
// licenses) with Rust installed (it asks `cargo tree`, twice per platform
// the release builds). Writes `<App>_<version>.cdx.json` in `--out`.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import brand from "../brand.json";
import { isVersion } from "./releaseFiles";
import {
  bom,
  type BunLock,
  cargoChecksums,
  cargoComponents,
  installPath,
  npmComponents,
} from "./sbom";

/** The platforms the release builds (`release.yml`). */
const TARGETS = ["aarch64-apple-darwin", "x86_64-pc-windows-msvc", "aarch64-pc-windows-msvc"];

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
const rust = cargoComponents(
  TARGETS.map((t) => tree(t, "normal,no-proc-macro")),
  TARGETS.map((t) => tree(t, "normal,build")),
  cargoChecksums(readFileSync("Cargo.lock", "utf8")),
);

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

const document = bom({
  name: brand.name,
  version,
  components: [...rust, ...js],
  timestamp: new Date().toISOString(),
  serial: crypto.randomUUID(),
});
mkdirSync(out, { recursive: true });
const file = join(out, `${brand.name}_${version}.cdx.json`);
writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`);

const count = (list: typeof rust, scope: string) => list.filter((c) => c.scope === scope).length;
// Build-only packages may lack one: a platform's binary package that isn't
// installed on this computer can't be read.
const unlicensed = document.components.filter((c) => c.scope !== "excluded" && !c.licenses);
console.log(`${file}: ${document.components.length} components`);
console.log(`  Rust: ${count(rust, "required")} shipped, ${count(rust, "excluded")} build-only`);
console.log(
  `  JavaScript: ${count(js, "required")} shipped, ${count(js, "optional")} optional, ${count(js, "excluded")} build-only`,
);
// Every shipped component must say its license: the lab reads them, and
// the project's license (GPL-3.0-only) has to allow each.
if (unlicensed.length) {
  fail(`no license found for ${unlicensed.map((c) => c.purl).join(", ")}`);
}
