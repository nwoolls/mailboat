import { describe, expect, it } from "vitest";
import { approach, followSeconds, GLOW_MOTION_DEFAULTS as M, spring } from "./glow";

describe("approach", () => {
  it("closes about 63% of the gap after one time constant", () => {
    expect(approach(0, 100, 0.5, 0.5)).toBeCloseTo(63.2, 1);
  });

  it("is the same whether the frames are short or long", () => {
    let fast = 0;
    for (let i = 0; i < 12; i++) fast = approach(fast, 100, 1 / 120, 0.3);
    let slow = 0;
    for (let i = 0; i < 6; i++) slow = approach(slow, 100, 1 / 60, 0.3);
    expect(fast).toBeCloseTo(slow, 6);
  });

  it("never overshoots", () => {
    expect(approach(0, 100, 10, 0.3)).toBeLessThanOrEqual(100);
    expect(approach(90, 100, 0.016, 0.3)).toBeGreaterThan(90);
  });
});

describe("following the pointer", () => {
  it("keeps pace with a moving pointer a short, steady way behind", () => {
    // The old easing fell behind; a spring trails by about 2 × response × speed.
    const lag = chase(600, 2, M.holdSeconds);
    expect(lag).toBeGreaterThan(0);
    expect(lag).toBeLessThan(2.5 * M.holdSeconds * 600);
    expect(Math.abs(lag - chase(600, 3, M.holdSeconds))).toBeLessThan(1);
  });

  it("starts from rest and speeds up, rather than jumping", () => {
    const one = spring(0, 0, 100, 1 / 60, M.glideSeconds);
    const two = spring(one.x, one.v, 100, 1 / 60, M.glideSeconds);
    expect(one.x).toBeLessThan(5);
    expect(two.x - one.x).toBeGreaterThan(one.x);
  });

  it("settles on a still pointer without overshooting", () => {
    let x = 0;
    let v = 0;
    let most = 0;
    for (let i = 0; i < 120; i++) {
      ({ x, v } = spring(x, v, 100, 1 / 60, M.holdSeconds));
      most = Math.max(most, x);
    }
    expect(x).toBeCloseTo(100, 1);
    expect(most).toBeLessThanOrEqual(100.01);
  });

  it("tightens from gliding to holding smoothly, with no step", () => {
    expect(followSeconds(0, M)).toBe(M.glideSeconds);
    expect(followSeconds(M.catchSeconds * 2, M)).toBeCloseTo(M.holdSeconds, 9);
    let prev = followSeconds(0, M);
    for (let t = 0.01; t <= M.catchSeconds; t += 0.01) {
      const now = followSeconds(t, M);
      expect(Math.abs(now - prev)).toBeLessThan(0.01);
      prev = now;
    }
  });

  it("is looser than exact once holding: a moving pointer is trailed", () => {
    expect(chase(800, 1.5, M.holdSeconds)).toBeGreaterThan(20);
  });

  it("stays stable over a long frame", () => {
    const s = spring(0, 0, 100, 0.1, M.holdSeconds);
    expect(Number.isFinite(s.x)).toBe(true);
    expect(s.x).toBeLessThan(110);
  });
});

/** A pointer moving steadily at `speed` px/s; the glow following for `seconds`. */
function chase(speed: number, seconds: number, response: number) {
  let x = 0;
  let v = 0;
  for (let t = 0; t < seconds; t += 1 / 60) {
    const s = spring(x, v, speed * t, 1 / 60, response);
    x = s.x;
    v = s.v;
  }
  return speed * seconds - x;
}
