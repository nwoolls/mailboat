// Checks the version README.md names against package.json, for a stable
// version (readmeVersionProblems in scripts/readme.ts).
// Run by `bun run check:readme`, which `bun run check:web` includes.
import { readFileSync } from "node:fs";
import { readmeVersionProblems } from "./readme";

const repoFile = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url).pathname, "utf8");

const problems = readmeVersionProblems(
  repoFile("README.md"),
  JSON.parse(repoFile("package.json")).version,
);

if (problems.length) {
  console.error(`check:readme: ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log("check:readme: the version in README.md matches package.json");
