import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PLATFORMS, reviewAge, reviewStatuses } from "./codexReviewAge";

/** A local date (the check uses the Mac's own calendar day). */
const day = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h);

describe("reviewAge", () => {
  it("counts calendar days", () => {
    expect(reviewAge("2026-10-31", day(2026, 10, 31, 0))).toEqual({ days: 0 });
    expect(reviewAge("2026-10-31", day(2026, 12, 1, 23))).toEqual({ days: 31 });
    expect(reviewAge("2026-10-31", day(2026, 12, 2, 0))).toEqual({ days: 32 });
  });

  it("isn't moved by daylight saving", () => {
    // Across the spring and autumn changes, at the edges of the day.
    expect(reviewAge("2026-03-01", day(2026, 4, 1, 0))).toEqual({ days: 31 });
    expect(reviewAge("2026-10-01", day(2026, 11, 1, 23))).toEqual({ days: 31 });
  });

  it("refuses dates that can't be used", () => {
    // Code review R6, question 4: these passed as "0 days ago" or similar.
    expect(reviewAge("2026-02-30", day(2026, 3, 2))).toHaveProperty("invalid");
    expect(reviewAge("2027-01-01", day(2026, 12, 1))).toHaveProperty("invalid");
    expect(reviewAge("garbage", day(2026, 12, 1))).toHaveProperty("invalid");
    expect(reviewAge("2026-1-5", day(2026, 12, 1))).toHaveProperty("invalid");
  });
});

describe("reviewStatuses", () => {
  const today = day(2026, 12, 2);

  it("warns for a system never reviewed, and holds every reviewed one to the limit", () => {
    expect(reviewStatuses({ macos: { reviewed: "2026-11-30" } }, today, 31)).toEqual([
      { platform: "macOS", state: "fine", days: 2 },
      { platform: "Windows", state: "never" },
    ]);
    expect(reviewStatuses({ windows: { reviewed: "2026-10-31" } }, today, 31)[1]).toEqual({
      platform: "Windows",
      state: "due",
      days: 32,
      reviewed: "2026-10-31",
    });
  });

  it("names a date that can't be used, with its system", () => {
    expect(reviewStatuses({ windows: { reviewed: "2026-13-01" } }, today, 31)[1]).toEqual({
      platform: "Windows",
      state: "invalid",
      why: '"2026-13-01" isn\'t a real date',
    });
  });
});

describe("PLATFORMS", () => {
  // Review (round 1 of this branch): the list is written in Rust too, and
  // the two must name the same systems.
  it("names the same systems as the Rust review", () => {
    const rust = readFileSync(resolve(__dirname, "../crates/core/src/ai/codex_review.rs"), "utf8");
    const list = /pub const PLATFORMS: \[&str; \d+\] = \[([^\]]*)\]/.exec(rust)?.[1] ?? "";
    expect([...list.matchAll(/"([^"]+)"/g)].map((m) => m[1])).toEqual([...PLATFORMS]);
  });
});
