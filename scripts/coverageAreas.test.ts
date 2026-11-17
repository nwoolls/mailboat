import { describe, expect, it } from "vitest";
import { type FileSummary, groupCoverage, percent } from "./coverageAreas";

const file = (lines: [number, number], branches: [number, number]): FileSummary => ({
  lines: { total: lines[0], covered: lines[1] },
  branches: { total: branches[0], covered: branches[1] },
});

describe("coverage by area", () => {
  it("sums each file into the first area it matches", () => {
    const { areas, unmatched } = groupCoverage(
      {
        total: file([999, 999], [999, 999]),
        "/repo/src/features/mail/model/a.ts": file([10, 9], [4, 3]),
        "/repo/src/features/mail/model/b.ts": file([10, 10], [2, 2]),
        "/repo/src/features/mail/ui/List.tsx": file([20, 2], [10, 1]),
        "/repo/src/shared/lib/x.ts": file([5, 1], [0, 0]),
        "/repo/scripts/sbom.ts": file([8, 6], [4, 2]),
        "/repo/vite.config.ts": file([3, 0], [0, 0]),
      },
      "/repo",
    );
    expect(unmatched).toEqual(["/repo/vite.config.ts"]);
    expect(areas.map((a) => [a.area, a.files, a.lines.covered, a.lines.total])).toEqual([
      ["logic (src/**/model)", 2, 19, 20],
      ["components (src/**/ui, browser-tested)", 1, 2, 20],
      ["build and release scripts", 1, 6, 8],
      ["the rest of src (app, shared, platform)", 1, 1, 5],
    ]);
    expect(areas[0]!.branches).toEqual({ total: 6, covered: 5 });
  });

  it("reads Windows paths, with either kind of slash", () => {
    const one = file([4, 3], [2, 1]);
    for (const [key, root] of [
      ["C:\\repo\\src\\features\\mail\\model\\a.ts", "C:\\repo"],
      ["C:/repo/src/features/mail/model/a.ts", "C:\\repo"],
      ["C:\\repo\\src\\features\\mail\\model\\a.ts", "C:/repo/"],
    ]) {
      const { areas, unmatched } = groupCoverage({ [key!]: one }, root!);
      expect(unmatched, key).toEqual([]);
      expect(areas[0]!.files, key).toBe(1);
    }
  });

  it("lists a file it can't place, as a wrong root would leave every file", () => {
    const { areas, unmatched } = groupCoverage(
      { "/private/tmp/repo/src/x/model/a.ts": file([1, 1], [0, 0]) },
      "/tmp/repo",
    );
    expect(unmatched).toEqual(["/private/tmp/repo/src/x/model/a.ts"]);
    expect(areas.every((a) => a.files === 0)).toBe(true);
  });

  it("prints a share, and n/a when there is nothing to count", () => {
    expect(percent({ total: 8, covered: 6 })).toBe("75.0%");
    expect(percent({ total: 0, covered: 0 })).toBe("n/a");
  });
});
