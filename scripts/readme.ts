// Checks for README.md (run by `bun run check:readme`, part of every check).
// A pure function: scripts/check-readme.ts reads the files and passes them in,
// so the rule is tested in scripts/readme.test.ts.

/**
 * The README's notice near the top names the released version ("Version
 * 0.2.1 is out, …"), typed by hand: nothing updates it when a version is
 * released. So a stable version in package.json (what `version-packages`
 * writes in a release pull request) must be the one it names, patch
 * included. A beta (a version with a pre-release part, `0.3.0-beta.0`) is
 * skipped: the README names the stable version until it ships. The same
 * rule as the website's chip (versionChipProblems in scripts/website.ts),
 * which names only the major and minor.
 */
export function readmeVersionProblems(readme: string, version: string): string[] {
  const named = /\bVersion (\d+\.\d+\.\d+) is out\b/.exec(readme);
  if (!named) return ["README.md: no version notice (`Version 0.2.1 is out, …`) found"];
  if (!/^\d+\.\d+\.\d+$/.test(version)) return [];
  return named[1] === version
    ? []
    : [
        `README.md: it says version ${named[1]} is out but package.json is ${version}: change it to ${version}`,
      ];
}
