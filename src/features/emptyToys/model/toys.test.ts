import { describe, expect, it } from "vitest";
import { allPopped, bubbleAt, pop, sheetFor } from "./bubbles";
import { PondToy, SETTLE_SECONDS } from "./pond";
import { moonPath, moonPhase, nightness, skyAt, starsFor } from "./sky";
import { parseToy } from "./toys";

describe("parseToy", () => {
  it("keeps a known toy, else none", () => {
    expect(parseToy('"bubbles"')).toBe("bubbles");
    expect(parseToy('"kites"')).toBe("none");
    expect(parseToy(null)).toBe("none");
    expect(parseToy("{oops")).toBe("none");
  });
});

describe("pond", () => {
  it("splashes, sends waves out, and settles still and clear", () => {
    const pond = new PondToy(200, 120, () => 0.5);
    pond.drop(100, 60);
    expect(pond.active).toBe(true);
    expect(pond.droplets.length).toBeGreaterThan(5);
    for (let i = 0; i < 30; i++) pond.frame(1 / 60);
    // Half a second on, the wave has spread out from the stone.
    expect(Math.abs(pond.heightAt(130, 60))).toBeGreaterThan(0.005);
    const out = new Uint8Array(200 * 120);
    const opacity = new Uint8Array(200 * 120).fill(255);
    pond.draw(out, opacity);
    expect(out.some((v) => v > 0)).toBe(true);
    for (let i = 0; i < 60 * SETTLE_SECONDS && pond.active; i++) pond.frame(1 / 60);
    expect(pond.active).toBe(false);
    pond.draw(out, opacity);
    expect(out.every((v) => v === 0)).toBe(true);
  });

  it("holds still where something stands in it, and shelters the water behind", () => {
    const open = new PondToy(200, 120, () => 0.5);
    const walled = new PondToy(200, 120, () => 0.5);
    // A wall across the whole height, between the stone and the far side.
    walled.setSolids([{ x0: 98, y0: 0, x1: 102, y1: 120 }]);
    for (const p of [open, walled]) p.drop(60, 60);
    let behindOpen = 0;
    let behindWalled = 0;
    for (let i = 0; i < 90; i++) {
      open.frame(1 / 60);
      walled.frame(1 / 60);
      expect(walled.heightAt(100, 60)).toBe(0);
      behindOpen = Math.max(behindOpen, Math.abs(open.heightAt(140, 60)));
      behindWalled = Math.max(behindWalled, Math.abs(walled.heightAt(140, 60)));
    }
    expect(behindOpen).toBeGreaterThan(0.01);
    expect(behindWalled).toBeLessThan(behindOpen / 10);
  });
});

describe("bubble wrap", () => {
  it("fills the area, pops what's clicked once, and knows when it's done", () => {
    let sheet = sheetFor(450, 300);
    expect(sheet.centres.length).toBeGreaterThan(20);
    for (const c of sheet.centres) {
      expect(c.x - sheet.radius).toBeGreaterThanOrEqual(0);
      expect(c.x + sheet.radius).toBeLessThanOrEqual(450);
      expect(c.y - sheet.radius).toBeGreaterThanOrEqual(0);
      expect(c.y + sheet.radius).toBeLessThanOrEqual(300);
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

describe("sky at night", () => {
  it("darkens through dusk and lightens through dawn", () => {
    expect(nightness(13)).toBe(0);
    expect(nightness(23)).toBe(1);
    expect(nightness(2)).toBe(1);
    expect(nightness(19.5)).toBeCloseTo(0.5, 5);
    expect(nightness(6)).toBeCloseTo(0.5, 5);
  });
  it("knows the moon's phase", () => {
    // Full moon, 2026-10-26 04:12 UTC; new again half a month on.
    const full = Date.UTC(2026, 9, 26, 4, 12);
    expect(moonPhase(new Date(full))).toBeCloseTo(0.5, 1);
    const fresh = moonPhase(new Date(full + 14.77 * 86_400_000));
    expect(Math.min(fresh, 1 - fresh)).toBeLessThan(0.03);
  });
  it("lights the right side waxing, the left waning, all of it when full", () => {
    // Full: two half circles, the whole disc.
    expect(moonPath(0.5, 20)).toBe("M 10 0 A 10 10 0 0 0 10 20 A 10 10 0 0 0 10 0 Z");
    // First quarter: the right half, closed by a straight line.
    expect(moonPath(0.25, 20)).toBe("M 10 0 A 10 10 0 0 1 10 20 A 0 10 0 0 0 10 0 Z");
    expect(moonPath(0.75, 20)).toContain("A 10 10 0 0 0 10 20");
  });
  it("scatters the same stars each time, inside the sky", () => {
    const stars = starsFor(40);
    expect(stars).toEqual(starsFor(40));
    for (const s of stars) {
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThanOrEqual(100);
      expect(s.y).toBeLessThanOrEqual(80);
    }
  });
});
