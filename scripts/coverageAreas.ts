// Groups Vitest's per-file coverage summary into the areas it should be read
// by (`bun run coverage`, scripts/coverage.ts). One number for all of `src`
// misleads: the components in `ui/` are thin by design and are exercised by
// the Playwright browser tests, which this doesn't measure, while the logic
// in `model/` is what the unit tests are for.

/** One file's entry in `coverage-summary.json` (istanbul's json-summary). */
export interface FileSummary {
  lines: { total: number; covered: number };
  branches: { total: number; covered: number };
}

/** Forward slashes, so Windows paths (`C:\\repo\\src\\…`) match the areas too. */
const slashes = (path: string) => path.replaceAll("\\", "/");

export interface AreaCoverage {
  area: string;
  files: number;
  lines: { total: number; covered: number };
  branches: { total: number; covered: number };
}

/** The areas, first match wins; the order is how they're printed. */
export const AREAS: { area: string; matches: (path: string) => boolean }[] = [
  { area: "logic (src/**/model)", matches: (p) => /^src\/.*\/model\//.test(p) },
  { area: "components (src/**/ui, browser-tested)", matches: (p) => /^src\/.*\/ui\//.test(p) },
  { area: "build and release scripts", matches: (p) => p.startsWith("scripts/") },
  { area: "the rest of src (app, shared, platform)", matches: (p) => p.startsWith("src/") },
];

/**
 * Sums the summary's files by area. Paths in the summary are absolute; `root`
 * is the repository folder they are made relative to (pass both through
 * `realpath` first, so a linked folder such as macOS's /tmp matches). The
 * summary's own `total` entry is skipped; a file in no area is listed in
 * `unmatched`, so a wrong root shows up instead of an empty table.
 */
export function groupCoverage(
  summary: Record<string, FileSummary>,
  root: string,
): { areas: AreaCoverage[]; unmatched: string[] } {
  const base = slashes(root);
  const prefix = base.endsWith("/") ? base : `${base}/`;
  const unmatched: string[] = [];
  const areas = AREAS.map(({ area }) => ({
    area,
    files: 0,
    lines: { total: 0, covered: 0 },
    branches: { total: 0, covered: 0 },
  }));
  for (const [file, s] of Object.entries(summary)) {
    if (file === "total") continue;
    const key = slashes(file);
    const path = key.startsWith(prefix) ? key.slice(prefix.length) : key;
    const i = AREAS.findIndex(({ matches }) => matches(path));
    if (i === -1) {
      unmatched.push(file);
      continue;
    }
    const a = areas[i]!;
    a.files++;
    a.lines.total += s.lines.total;
    a.lines.covered += s.lines.covered;
    a.branches.total += s.branches.total;
    a.branches.covered += s.branches.covered;
  }
  return { areas, unmatched };
}

/** "92.1%" of a count, or "n/a" when there is nothing to count. */
export function percent({ total, covered }: { total: number; covered: number }): string {
  return total === 0 ? "n/a" : `${((covered / total) * 100).toFixed(1)}%`;
}
