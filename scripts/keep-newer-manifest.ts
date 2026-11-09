// Decides whether the Beta channel's manifest should be replaced by a newly
// published release's: only when that release is newer than what the channel
// already points at, so a delayed run for an older release (or a maintenance
// release published later) can't move the channel backward. Prints "replace"
// or "keep".
//
//   bun scripts/keep-newer-manifest.ts <current latest.json or "none"> <new latest.json>
import { existsSync, readFileSync } from "node:fs";
import { compareVersions, isVersion } from "./releaseFiles";

const [current, next] = process.argv.slice(2);

function versionOf(path: string): string {
  const version = JSON.parse(readFileSync(path, "utf8"))?.version;
  if (typeof version !== "string" || !isVersion(version)) {
    console.error(`keep-newer-manifest: ${path} has no valid version`);
    process.exit(1);
  }
  return version;
}

if (!next) {
  console.error("Usage: keep-newer-manifest.ts <current|none> <new>");
  process.exit(2);
}
const replace =
  current === "none" ||
  !existsSync(current) ||
  compareVersions(versionOf(next), versionOf(current)) > 0;
console.log(replace ? "replace" : "keep");
