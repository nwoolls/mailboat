// Writes the AppImage's own bill of materials (`appimageSbom.ts`): what the
// AppImage carries beyond the app's crates and packages, which the app's
// bill (make-sbom.ts) lists. Run on the Linux runner that built it, right
// after the build, since the bundled files are traced to the packages
// installed there:
//
//   bun scripts/make-appimage-sbom.ts --appimage <file> --version 0.3.0 --out <folder>
//
// Writes `<App>_<version>_linux_<amd64|arm64>.AppImage.cdx.json`. Fails if a
// bundled library or program comes from neither an installed package nor
// the AppImage's own tools (AppRun), so nothing ships unlisted.

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
import { appimageBom, type Bundled, copyrightLicenses, owner } from "./appimageSbom";
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
  const r = spawnSync(command, args, { encoding: "utf8", cwd, maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, out: r.stdout ?? "" };
}

const appimage = resolve(option("appimage") ?? fail("missing --appimage"));
const version = option("version") ?? fail("missing --version");
const out = option("out") ?? fail("missing --out");
if (!isVersion(version)) fail(`"${version}" isn't a version like 1.2.3`);
if (!existsSync(appimage)) fail(`no AppImage at ${appimage}`);

/** The AppImage's own tools, not from a package: the runtime that starts it. */
const TOOLS = new Set(["AppRun", "AppRun.wrapped"]);

const work = mkdtempSync(join(tmpdir(), "appimage-sbom-"));
if (!run(appimage, ["--appimage-extract"], work).ok) fail("couldn't unpack the AppImage");
const root = join(work, "squashfs-root");
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

const byPackage = new Map<string, string[]>();
const tools: Bundled[] = [];
for (const file of bundledFiles(root).toSorted()) {
  if (file === `usr/bin/${program}`) continue;
  const name = file.split("/").pop()!;
  const direct = run("dpkg", ["-S", `/${file}`]);
  const pkg =
    (direct.ok ? owner(direct.out, `/${file}`) : null) ??
    owner(run("dpkg", ["-S", name]).out, file);
  if (pkg) {
    byPackage.set(pkg, [...(byPackage.get(pkg) ?? []), file]);
  } else if (TOOLS.has(file)) {
    const sha256 = createHash("sha256")
      .update(readFileSync(join(root, file)))
      .digest("hex");
    tools.push({ package: null, version: null, licenses: [], files: [file], sha256 });
  } else {
    fail(`${file} comes from no installed package and isn't one of the AppImage's tools`);
  }
}

const bundled: Bundled[] = [...byPackage].map(([pkg, files]) => {
  const installed = run("dpkg-query", ["-W", "-f=${Version}", pkg]).out.trim() || null;
  const copyright = `/usr/share/doc/${pkg}/copyright`;
  const licenses = existsSync(copyright) ? copyrightLicenses(readFileSync(copyright, "utf8")) : [];
  return { package: pkg, version: installed, licenses, files };
});

const arch = run("dpkg", ["--print-architecture"]).out.trim();
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
