// Fails when an AppImage's runtime isn't the pinned one
// (scripts/appimage-tools.sh): a build that ignored LDAI_RUNTIME_FILE would
// have let appimagetool download its own. The reference file is checked
// against the pinned digest first. Reads the files; runs nothing.
//
//   bun scripts/check-appimage-runtime.ts <file.AppImage> <pinned runtime>

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { arch as machine } from "node:os";
import { RUNTIME_SHA256, runtimeProblem } from "./appimageRuntime";

const [appimage, runtime] = process.argv.slice(2);
if (!appimage || !runtime) {
  console.error("usage: bun scripts/check-appimage-runtime.ts <file.AppImage> <pinned runtime>");
  process.exit(2);
}
// The reference itself first: it sits in a cache that could have changed
// since the tools script checked it.
const pinned = readFileSync(runtime);
const names: Record<string, string> = { x64: "x86_64", arm64: "aarch64" };
const want = RUNTIME_SHA256[names[machine()] ?? machine()];
const got = createHash("sha256").update(pinned).digest("hex");
if (!want || got !== want) {
  console.error(`check-appimage-runtime: ${runtime} isn't the pinned runtime (SHA-256 ${got})`);
  process.exit(1);
}
const problem = runtimeProblem(readFileSync(appimage), pinned);
if (problem) {
  console.error(`check-appimage-runtime: ${appimage}: ${problem}`);
  process.exit(1);
}
console.log(`${appimage}: the pinned runtime`);
