// Writes the AppImage's own bill of materials (`appimageSbom.ts`): what the
// AppImage carries beyond the app's crates and packages, which the app's
// bill (make-sbom.ts) lists. Run on the Linux runner that built it, right
// after the build, since the bundled files are traced to the packages
// installed there:
//
//   bun scripts/make-appimage-sbom.ts --appimage <file> --runtime <pinned runtime> \
//     --version 0.3.0 --out <folder>
//
// Writes `<App>_<version>_linux_<amd64|arm64>.AppImage.cdx.json`. Fails if a
// bundled library or program comes from neither an installed package nor
// the AppImage's own tools (AppRun), so nothing ships unlisted. The runtime
// at the AppImage's front is listed by the pinned file's digest (the release
// checks first that it is that one). The AppImage is unpacked with
// unsquashfs (squashfs-tools) from where its runtime ends, without running it.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import brand from "../brand.json";
import { elfEnd, RUNTIME_RELEASE, RUNTIME_SHA256, runtimeProblem } from "./appimageRuntime";
import {
  appimageBom,
  type Bundled,
  copyrightLicenses,
  INSTALLED_FORMAT,
  installed,
  type Owned,
  owned,
  pickOwner,
} from "./appimageSbom";
import { isVersion } from "./releaseFiles";

function option(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
}

function fail(message: string): never {
  console.error(`make-appimage-sbom: ${message}`);
  process.exit(1);
}

function run(command: string, args: string[], cwd?: string): { ok: boolean; out: string } {
  // The C locale, so dpkg's wording is the one `owned` reads.
  const env = { ...process.env, LC_ALL: "C" };
  const r = spawnSync(command, args, { encoding: "utf8", cwd, env, maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, out: r.stdout ?? "" };
}

const appimage = resolve(option("appimage") ?? fail("missing --appimage"));
const runtime = resolve(option("runtime") ?? fail("missing --runtime"));
const version = option("version") ?? fail("missing --version");
const out = option("out") ?? fail("missing --out");
if (!isVersion(version)) fail(`"${version}" isn't a version like 1.2.3`);
if (!existsSync(appimage)) fail(`no AppImage at ${appimage}`);

/** The AppImage's own tools, not from a package: the runtime that starts it. */
const TOOLS = new Set(["AppRun", "AppRun.wrapped"]);

// The runtime recorded below is the one in this AppImage: the same check as
// check-appimage-runtime.ts, before anything is unpacked.
{
  const problem = runtimeProblem(readFileSync(appimage), readFileSync(runtime));
  if (problem) fail(`${appimage}: ${problem}`);
}

const work = mkdtempSync(join(tmpdir(), "appimage-sbom-"));
const root = join(work, "squashfs-root");
const offset = elfEnd(readFileSync(appimage));
if (!run("unsquashfs", ["-q", "-n", "-o", String(offset), "-d", root, appimage]).ok) {
  fail("couldn't unpack the AppImage (is squashfs-tools installed?)");
}
const program = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")).mainBinaryName;

/** Every library (`*.so*`) and program in the AppImage, but the app's own. */
function bundledFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...bundledFiles(path));
    else if (entry.isFile()) {
      const executable = (statSync(path).mode & 0o111) !== 0;
      if (entry.name.includes(".so") || executable) found.push(relative(root, path));
    }
  }
  return found;
}

const hostArch = run("dpkg", ["--print-architecture"]).out.trim();
const byPackage = new Map<string, { owner: Owned; files: string[] }>();
const tools: Bundled[] = [];
const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
for (const file of bundledFiles(root).toSorted()) {
  if (file === `usr/bin/${program}`) continue;
  const name = file.split("/").pop()!;
  const candidates = [
    ...owned(run("dpkg", ["-S", `/${file}`]).out),
    ...owned(run("dpkg", ["-S", name]).out),
  ];
  let found: Owned | null;
  try {
    found = pickOwner(candidates, `/${file}`, hostArch);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  if (found) {
    const key = `${found.package}:${found.arch ?? ""}`;
    const entry = byPackage.get(key) ?? { owner: found, files: [] };
    entry.files.push(file);
    byPackage.set(key, entry);
  } else if (TOOLS.has(file)) {
    tools.push({
      package: null,
      version: null,
      licenses: [],
      files: [file],
      sha256: sha256(join(root, file)),
    });
  } else {
    fail(`${file} comes from no installed package and isn't one of the AppImage's tools`);
  }
}

const bundled: Bundled[] = [...byPackage.values()].map(({ owner, files }) => {
  const pkg = owner.package;
  const query = owner.arch ? `${pkg}:${owner.arch}` : pkg;
  const line = run("dpkg-query", ["-W", `-f=${INSTALLED_FORMAT}\\n`, query]).out.split("\n")[0];
  const found = installed(line ?? "");
  if (!found) fail(`${query} isn't installed (${line || "nothing"})`);
  const copyright = `/usr/share/doc/${pkg}/copyright`;
  const licenses = existsSync(copyright) ? copyrightLicenses(readFileSync(copyright, "utf8")) : [];
  return { package: pkg, arch: found.arch, version: found.version, licenses, files };
});
// The runtime at the front, by its pinned release and digest; the file given
// must be that one (the release checks it before this runs, and so does
// this).
const runtimeNames: Record<string, string> = { amd64: "x86_64", arm64: "aarch64" };
const runtimeArch = runtimeNames[hostArch] ?? hostArch;
const pinnedSha = RUNTIME_SHA256[runtimeArch];
if (!pinnedSha || sha256(runtime) !== pinnedSha) fail(`${runtime} isn't the pinned runtime`);
tools.push({
  package: null,
  version: RUNTIME_RELEASE,
  licenses: ["MIT"],
  files: ["runtime"],
  sha256: pinnedSha,
});

const arch = hostArch;
mkdirSync(out, { recursive: true });
const file = join(out, `${brand.name}_${version}_linux_${arch}.AppImage.cdx.json`);
const document = appimageBom({
  name: brand.name,
  version,
  arch,
  bundled: [...bundled, ...tools],
  timestamp: new Date().toISOString(),
  serial: crypto.randomUUID(),
});
writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`);
const unlicensed = bundled.filter((b) => b.licenses.length === 0).map((b) => b.package);
console.log(`${file}: ${bundled.length} packages, ${tools.length} tools files`);
if (unlicensed.length) {
  console.log(
    `  no machine-readable license (see each package's copyright file): ${unlicensed.join(", ")}`,
  );
}
