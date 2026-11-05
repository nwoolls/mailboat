// Fails unless a tag can release the version in package.json: the tag is `v`
// and that version, and CHANGELOG.md has a section for it. The release
// workflow runs this first, so a mistake costs seconds, not a build.
//
//   bun scripts/check-release-tag.ts v0.1.0
import { readFileSync } from "node:fs";
import { tagProblem } from "./releaseFiles";

const tag = process.argv[2];
if (!tag) {
  console.error("usage: bun scripts/check-release-tag.ts <tag>");
  process.exit(2);
}
const { version } = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
const problem = tagProblem(tag, version, readFileSync("CHANGELOG.md", "utf8"));
if (problem) {
  console.error(`check-release-tag: ${problem}`);
  process.exit(1);
}
console.log(`${tag} can release ${version}.`);
