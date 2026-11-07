import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// CI skips work for a pull request that only changes docs or the website
// (.github/workflows/ci.yml, "What changed"). If that job fails or says
// nothing, everything must run. That holds only while every condition that
// reads its answer says "is not docs / is not site", never "is app".
const ci = readFileSync(resolve(__dirname, "../.github/workflows/ci.yml"), "utf8");

describe("the CI's skips fail safe", () => {
  const conditions = ci
    .split("\n")
    .filter((line) => /^\s*(- )?if:/.test(line) && line.includes("needs.changes.outputs"));

  it("has conditions that read the answer", () => {
    expect(conditions.length).toBeGreaterThan(8);
  });

  it("never runs something only when the answer is a particular kind", () => {
    for (const line of conditions) {
      expect(line, line).not.toMatch(/outputs\.kind\s*==/);
      expect(line, line).toMatch(/outputs\.kind != '(docs|site)'/);
    }
  });

  it('lets the jobs that must always report run even if "What changed" failed', () => {
    for (const name of ["Web checks", "Rust checks (${{ matrix.os }})"]) {
      const at = ci.indexOf(`name: ${name}`);
      expect(at, name).toBeGreaterThan(-1);
      const block = ci.slice(at, ci.indexOf("runs-on:", at));
      expect(block, name).toContain("!cancelled()");
    }
  });

  it("keeps the formatting, brand and privacy checks unconditional", () => {
    // an unconditional step starts as "- run: …"; a gated one starts as "- if: …"
    for (const step of ["bun run fmt:check", "bun run check:brand", "bun run check:privacy"]) {
      expect(ci, step).toContain(`      - run: ${step}\n`);
    }
  });
});
