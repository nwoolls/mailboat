import { describe, expect, it } from "vitest";
import { reviewAge } from "./codexReviewAge";

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
