import { describe, expect, it } from "vitest";
import { allPopped, bubbleAt, pop, sheetFor } from "./bubbles";
import { alive, drop, MAX_RIPPLES, RIPPLE_MS, ringAt } from "./ripples";
import { skyAt } from "./sky";
import { parseToy } from "./toys";

describe("parseToy", () => {
  it("keeps a known toy, else none", () => {
    expect(parseToy('"bubbles"')).toBe("bubbles");
    expect(parseToy('"kites"')).toBe("none");
    expect(parseToy(null)).toBe("none");
    expect(parseToy("{oops")).toBe("none");
  });
});

describe("ripples", () => {
  it("spread out and fade, rings a little apart, then go", () => {
    const [r] = drop([], 10, 20, 1000);
    expect(ringAt(r!, 0, 1000)!.radius).toBeCloseTo(4);
    expect(ringAt(r!, 1, 1000)).toBeNull();
    const early = ringAt(r!, 0, 1500)!;
    const late = ringAt(r!, 0, 3000)!;
    expect(late.radius).toBeGreaterThan(early.radius);
    expect(late.alpha).toBeLessThan(early.alpha);
    expect(ringAt(r!, 0, 1000 + RIPPLE_MS)).toBeNull();
    expect(alive([r!], 1000 + RIPPLE_MS * 3)).toEqual([]);
  });
  it("keeps only the newest few", () => {
    let ripples = drop([], 0, 0, 0);
    for (let i = 1; i < 30; i++) ripples = drop(ripples, i, 0, i);
    expect(ripples).toHaveLength(MAX_RIPPLES);
    expect(ripples.at(-1)!.x).toBe(29);
  });
});

describe("bubble wrap", () => {
  it("fills the area, pops what's clicked once, and knows when it's done", () => {
    let sheet = sheetFor(300, 200);
    expect(sheet.centres.length).toBeGreaterThan(20);
    for (const c of sheet.centres) {
      expect(c.x - sheet.radius).toBeGreaterThanOrEqual(0);
      expect(c.x + sheet.radius).toBeLessThanOrEqual(300);
      expect(c.y - sheet.radius).toBeGreaterThanOrEqual(0);
      expect(c.y + sheet.radius).toBeLessThanOrEqual(200);
    }
    const first = sheet.centres[0]!;
    const i = bubbleAt(sheet, first.x + 2, first.y - 2);
    expect(i).toBe(0);
    sheet = pop(sheet, 0);
    expect(bubbleAt(sheet, first.x, first.y)).toBeNull();
    expect(allPopped(sheet)).toBe(false);
    sheet.centres.forEach((_, n) => (sheet = pop(sheet, n)));
    expect(allPopped(sheet)).toBe(true);
    expect(allPopped(sheetFor(0, 0))).toBe(false);
  });
});

describe("sky", () => {
  it("has the sun up by day, the moon by night, highest at the middle", () => {
    expect(skyAt(13).body).toBe("sun");
    expect(skyAt(23).body).toBe("moon");
    expect(skyAt(3).body).toBe("moon");
    expect(skyAt(13).height).toBeCloseTo(1, 1);
    expect(skyAt(6.6).height).toBeLessThan(0.1);
    expect(skyAt(13).along).toBeCloseTo(0.5, 1);
  });
  it("blends colours between the stops, wrapping past midnight", () => {
    expect(skyAt(0).top).toBe("rgb(14 18 42)");
    expect(skyAt(24).top).toBe(skyAt(0).top);
    expect(skyAt(-1).top).toBe(skyAt(23).top);
    expect(skyAt(13).top).toBe("rgb(78 150 232)");
  });
});
