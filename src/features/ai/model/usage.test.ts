import { describe, expect, it } from "vitest";
import { describeLimit, describeTotals, formatTokens, startOfToday } from "./usage";

describe("usage", () => {
  it("shortens token counts", () => {
    expect(formatTokens(950)).toBe("950");
    expect(formatTokens(1_234)).toBe("1.2k");
    expect(formatTokens(56_000)).toBe("56k");
    expect(formatTokens(4_200_000)).toBe("4.2M");
  });

  it("describes totals, without tokens for on-device use", () => {
    const t = { requests: 3, failed: 1, inputTokens: 1500, outputTokens: 200, costUsd: 0.0123 };
    expect(describeTotals(t, false)).toBe("3 requests (1 failed) · 1.5k in, 200 out · ≈ $0.012");
    expect(describeTotals({ ...t, costUsd: null }, true)).toBe("3 requests (1 failed)");
    expect(describeTotals({ ...t, requests: 0 }, false)).toBe("None");
  });

  it("says how much of a plan limit is used", () => {
    const now = new Date(2026, 9, 20, 9, 0);
    const resets = new Date(2026, 9, 20, 15, 0).getTime() / 1000;
    expect(describeLimit({ window: "five_hour", used: 0.672, resetsAt: resets }, now)).toMatch(
      /^67% of the 5-hour limit, resets 3:00/,
    );
    expect(describeLimit({ window: "seven_day", used: 0.1, resetsAt: null }, now)).toBe(
      "10% of the weekly limit",
    );
    expect(startOfToday(now)).toBe(new Date(2026, 9, 20).getTime());
  });
});
