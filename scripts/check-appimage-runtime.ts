// Fails when an AppImage's runtime isn't the pinned one
// (scripts/appimage-tools.sh): a build that ignored LDAI_RUNTIME_FILE would
// have let appimagetool download its own. Reads the files; runs nothing.
//
//   bun scripts/check-appimage-runtime.ts <file.AppImage> <pinned runtime>

import { readFileSync } from "node:fs";
import { runtimeProblem } from "./appimageRuntime";

const [appimage, runtime] = process.argv.slice(2);
if (!appimage || !runtime) {
  console.error("usage: bun scripts/check-appimage-runtime.ts <file.AppImage> <pinned runtime>");
  process.exit(2);
}
const problem = runtimeProblem(readFileSync(appimage), readFileSync(runtime));
if (problem) {
  console.error(`check-appimage-runtime: ${appimage}: ${problem}`);
  process.exit(1);
}
console.log(`${appimage}: the pinned runtime`);
