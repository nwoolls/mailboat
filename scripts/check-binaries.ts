// Fails a release whose built binaries lost a hardening setting
// (`binaryChecks.ts` has the rules). Run by the release workflow after the
// builds are signed:
//
//   bun scripts/check-binaries.ts macos <App>.app       every binary in Contents/MacOS
//   bun scripts/check-binaries.ts windows <target>       the app's program for that target
//                                                        (needs llvm-readobj: Homebrew's llvm)
//   bun scripts/check-binaries.ts linux <program>        the app's program, as a package installs it
//                                                        (needs readelf: binutils)
//
// Prints what it found, so the output is also the evidence for the lab.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { elfProblems, macProblems, peProblems } from "./binaryChecks";

/** A tool's output; stdout and stderr together (`codesign -d` writes to stderr). */
function run(command: string, args: string[]): string {
  const r = Bun.spawnSync([command, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      // Homebrew keeps LLVM off PATH so it doesn't shadow Xcode's clang.
      PATH: `/opt/homebrew/opt/llvm/bin:${process.env.PATH ?? ""}`,
    },
  });
  const out = `${r.stdout.toString()}${r.stderr.toString()}`;
  if (r.exitCode !== 0) {
    console.error(`check-binaries: ${command} ${args.join(" ")} failed:\n${out}`);
    process.exit(1);
  }
  return out;
}

const [platform, target] = process.argv.slice(2);
if (!platform || !target || !["macos", "windows", "linux"].includes(platform)) {
  console.error(
    "Usage: bun scripts/check-binaries.ts macos <App>.app | windows <target triple> | linux <program>",
  );
  process.exit(2);
}

const problems: string[] = [];
if (platform === "macos") {
  const folder = join(target, "Contents", "MacOS");
  for (const name of readdirSync(folder).toSorted()) {
    const binary = join(folder, name);
    const found = macProblems({
      codesign: run("codesign", ["-d", "--verbose=4", binary]),
      // Entitlements exit 0 with nothing printed when there are none.
      entitlements: run("codesign", ["-d", "--entitlements", "-", "--xml", binary]),
      header: run("otool", ["-hv", binary]),
      loadCommands: run("otool", ["-l", binary]),
    });
    console.log(
      `${name}: ${found.length ? "problems" : "hardened runtime, no entitlements, PIE, no RPATH"}`,
    );
    problems.push(...found.map((p) => `${name}: ${p}`));
  }
} else if (platform === "linux") {
  const found = elfProblems(run("readelf", ["-h", "-l", "-d", "-W", target]));
  console.log(
    `${target}: ${found.length ? "problems" : "64-bit, PIE, non-executable stack, full RELRO, no RPATH"}`,
  );
  problems.push(...found.map((p) => `${target}: ${p}`));
} else {
  // The program Tauri builds for the target, named in its config.
  const name = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")).mainBinaryName;
  const program = join("target", target, "release", `${name}.exe`);
  const found = peProblems(run("llvm-readobj", ["--file-headers", program]));
  console.log(
    `${program}: ${found.length ? "problems" : "64-bit, DYNAMICBASE, NXCOMPAT, GUARD_CF, HIGHENTROPYVA"}`,
  );
  problems.push(...found.map((p) => `${program}: ${p}`));
}

for (const p of problems) console.error(`check-binaries: ${p}`);
if (problems.length) process.exit(1);
