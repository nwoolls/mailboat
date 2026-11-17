import { describe, expect, it } from "vitest";
import { readmeVersionProblems } from "./readme";

const readme = (v: string) =>
  `# App\n\n> **Early development.** Version ${v} is out, with signed downloads for Mac\n> (Apple silicon) and Windows.\n`;

describe("readmeVersionProblems", () => {
  it("passes when the README names the released version", () => {
    expect(readmeVersionProblems(readme("0.2.1"), "0.2.1")).toEqual([]);
    expect(readmeVersionProblems(readme("1.0.0"), "1.0.0")).toEqual([]);
  });

  it("fails a stable version the README doesn't name, a patch included", () => {
    expect(readmeVersionProblems(readme("0.1.0"), "0.2.1")).toEqual([
      "README.md: it says version 0.1.0 is out but package.json is 0.2.1: change it to 0.2.1",
    ]);
    expect(readmeVersionProblems(readme("0.2.0"), "0.2.1")).toHaveLength(1);
  });

  it("skips a beta: the README names the stable version until it ships", () => {
    expect(readmeVersionProblems(readme("0.2.1"), "0.3.0-beta.0")).toEqual([]);
  });

  it("fails when the notice is gone, so the check can't pass by accident", () => {
    expect(readmeVersionProblems("# App\n", "0.2.1")).toEqual([
      "README.md: no version notice (`Version 0.2.1 is out, …`) found",
    ]);
  });
});
