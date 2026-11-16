// Puts the release's build provenance on the release as files (OpenSSF
// Scorecard's Signed-Releases check reads only a release's files; GitHub
// keeps the attestation in its own store):
//
//   bun scripts/provenance-files.ts --bundle <bundle-path> --version 0.3.0 --to release
//
// `--bundle` is `actions/attest-build-provenance`'s `bundle-path` output.
// Writes `<App>_<version>.sigstore.json` (the bundle as it is, with what is
// needed to verify it) and `<App>_<version>.intoto.jsonl` (`intotoLines`).

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import brand from "../brand.json";
import { intotoLines, isVersion } from "./releaseFiles";

function option(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
}

function fail(message: string): never {
  console.error(`provenance-files: ${message}`);
  process.exit(1);
}

const bundlePath = option("bundle") ?? fail("missing --bundle");
const version = option("version") ?? fail("missing --version");
const to = option("to") ?? fail("missing --to");
if (!isVersion(version)) fail(`"${version}" isn't a version like 1.2.3`);

const bundle = readFileSync(bundlePath, "utf8");
let intoto: string;
try {
  intoto = intotoLines(bundle);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
const base = join(to, `${brand.name}_${version}`);
writeFileSync(`${base}.sigstore.json`, bundle);
writeFileSync(`${base}.intoto.jsonl`, intoto);
const statements = intoto.split("\n").length - 1;
console.log(
  `Wrote ${base}.sigstore.json and ${base}.intoto.jsonl (${statements} ${statements === 1 ? "statement" : "statements"})`,
);
