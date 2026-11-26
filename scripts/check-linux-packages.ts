// Fails unless each Linux package's program is hardened and marked as that
// kind of package. The updater installs the kind the program says it came as
// (Tauri writes the mark into the program separately for each package, and
// carries on if it can't), so a package without its mark would be signed and
// published with an update it can't pick. Unpacks the programs without
// running anything:
//
//   bun scripts/check-linux-packages.ts <folder with the .deb, .rpm and AppImage>
//
// Needs dpkg-deb, rpm2cpio and cpio, unsquashfs (squashfs-tools) and readelf.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { elfEnd } from "./appimageRuntime";
import { elfProblems } from "./binaryChecks";

function fail(message: string): never {
  console.error(`check-linux-packages: ${message}`);
  process.exit(1);
}

function run(command: string, args: string[], cwd?: string): string {
  const r = spawnSync(command, args, { encoding: "utf8", cwd, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) fail(`${command} ${args.join(" ")} failed:\n${r.stderr}`);
  return r.stdout;
}

const folder = resolve(process.argv[2] ?? fail("usage: check-linux-packages.ts <folder>"));
const program = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")).mainBinaryName;
const files = readdirSync(folder);
const one = (ending: string) => {
  const found = files.filter((f) => f.endsWith(ending));
  if (found.length !== 1) fail(`expected one ${ending}, found ${found.length}`);
  return join(folder, found[0]!);
};

/**
 * Every mark Tauri can leave. A release build keeps only the one it was
 * built with (`UNK`, before bundling); the others it compares against are
 * folded away, so a patched program holds exactly its own, and one left
 * unpatched or patched as another kind fails. (A debug build keeps all
 * four, so this check is for release builds only.)
 */
const MARKS = ["DEB", "RPM", "APP", "UNK"].map((kind) => `__TAURI_BUNDLE_TYPE_VAR_${kind}`);

/** Each package, how to unpack its program, and the mark it must carry. */
const packages = [
  {
    file: one(".deb"),
    mark: "__TAURI_BUNDLE_TYPE_VAR_DEB",
    unpack: (file: string, into: string) => run("dpkg-deb", ["-x", file, into]),
  },
  {
    file: one(".rpm"),
    mark: "__TAURI_BUNDLE_TYPE_VAR_RPM",
    unpack: (file: string, into: string) =>
      run("sh", ["-c", 'rpm2cpio "$1" | cpio -idm --quiet', "sh", file], into),
  },
  {
    file: one(".AppImage"),
    mark: "__TAURI_BUNDLE_TYPE_VAR_APP",
    // linuxdeploy points the program at the libraries bundled in the image.
    runpath: "$ORIGIN/../lib",
    unpack: (file: string, into: string) =>
      run("unsquashfs", [
        "-q",
        "-n",
        "-o",
        String(elfEnd(readFileSync(file))),
        "-d",
        join(into, "root"),
        file,
        `usr/bin/${program}`,
      ]),
  },
];

for (const p of packages) {
  const into = mkdtempSync(join(tmpdir(), "linux-package-"));
  p.unpack(p.file, into);
  const inside = p.file.endsWith(".AppImage")
    ? join(into, "root", "usr", "bin", program)
    : join(into, "usr", "bin", program);
  const problems = elfProblems(run("readelf", ["-h", "-l", "-d", "-W", inside]), p.runpath);
  const bytes = readFileSync(inside);
  if (!bytes.includes(Buffer.from(p.mark))) {
    problems.push(`not marked as its kind of package (${p.mark})`);
  }
  const others = MARKS.filter((m) => m !== p.mark && bytes.includes(Buffer.from(m)));
  if (others.length) problems.push(`also marked ${others.join(", ")}`);
  if (problems.length) fail(`${p.file}: ${problems.join("; ")}`);
  console.log(`${p.file}: hardened, marked ${p.mark.split("_").pop()}`);
}
