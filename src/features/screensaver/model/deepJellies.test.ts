import { describe, expect, it } from "vitest";
import {
  bellRadius,
  bellShape,
  contraction,
  DEEP_JELLY_DEFAULTS as T,
  depthLight,
  type Jelly,
  jellyBounds,
  jellyHues,
  makeSwarm,
  resizeSwarm,
  step,
  type Swarm,
} from "./deepJellies";

const rng = () => 0.5;

/** Runs `seconds` of the swarm with nothing pushing it. */
function run(s: Swarm, seconds: number, pointer: { x: number; y: number } | null = null) {
  for (let i = 0; i < seconds * 60; i++) step(s, 1 / 60, pointer, [], T, rng);
}

/** The average x of a jelly's tentacle tips. */
function tipsX(j: Jelly): number {
  return j.tentacles.reduce((sum, t) => sum + t.links.at(-1)!.x, 0) / j.tentacles.length;
}

describe("the jellies", () => {
  it("are few, at different depths, the farther smaller and dimmer", () => {
    const s = makeSwarm(800, 600, T, rng);
    expect(s.jellies).toHaveLength(T.count);
    const [near, far] = [s.jellies[0]!, s.jellies.at(-1)!];
    expect(bellRadius(s, far, T)).toBeLessThan(bellRadius(s, near, T));
    expect(depthLight(far, T)).toBeLessThan(depthLight(near, T));
  });

  it("are big: the nearest bell spans a good share of the area", () => {
    const s = makeSwarm(800, 600, T, rng);
    expect(bellRadius(s, s.jellies[0]!, T) * 2).toBeGreaterThan(600 * 0.2);
  });

  it("pulse: a quick squeeze, easing back", () => {
    expect(contraction(0)).toBe(0);
    expect(contraction(0.2)).toBeCloseTo(1, 5);
    expect(contraction(0.6)).toBeLessThan(contraction(0.3));
    expect(contraction(0.99)).toBeLessThan(0.01);
  });

  it("swim up in surges, and come back in from below once gone above the top", () => {
    const s = makeSwarm(800, 600, T, rng);
    const j = s.jellies[0]!;
    const y0 = j.y;
    run(s, T.pulseSeconds * 1.5);
    expect(j.y).toBeLessThan(y0);
    j.y = -10_000;
    run(s, 1 / 60);
    expect(j.y).toBeGreaterThan(600);
  });

  it("are pushed away from the pointer", () => {
    const s = makeSwarm(800, 600, T, rng);
    const j = s.jellies[0]!;
    j.x = 400;
    j.y = 300;
    for (let i = 0; i < 30; i++) step(s, 1 / 60, { x: j.x - 20, y: j.y }, [], T, rng);
    expect(j.x).toBeGreaterThan(400);
  });

  it("never spin: their lean stays small however long they swim", () => {
    const s = makeSwarm(800, 600, T, rng);
    let most = 0;
    for (let i = 0; i < 60 * 90; i++) {
      step(s, 1 / 60, null, [], T, rng);
      for (const j of s.jellies) most = Math.max(most, Math.abs(j.lean));
    }
    expect(most).toBeLessThan(0.45);
  });
});

describe("the tentacles", () => {
  it("hang from the rim, below the bell", () => {
    const s = makeSwarm(800, 600, T, rng);
    const j = s.jellies[0]!;
    run(s, 1);
    for (const t of j.tentacles) expect(t.links.at(-1)!.y).toBeGreaterThan(j.y);
  });

  it("trail behind a jelly moving sideways: moving right, they stream out to the left", () => {
    const s = makeSwarm(800, 600, T, rng);
    const j = s.jellies[0]!;
    run(s, 2);
    // Pulled steadily to the right for a while, as a current would.
    for (let i = 0; i < 60; i++) {
      j.vx = 60;
      step(s, 1 / 60, null, [], T, rng);
    }
    expect(tipsX(j)).toBeLessThan(j.x - bellRadius(s, j, T) * 0.3);
    // And the other way, to the right.
    for (let i = 0; i < 120; i++) {
      j.vx = -60;
      step(s, 1 / 60, null, [], T, rng);
    }
    expect(tipsX(j)).toBeGreaterThan(j.x + bellRadius(s, j, T) * 0.3);
  });

  it("flare out as the bell squeezes", () => {
    const s = makeSwarm(800, 600, T, rng);
    const j = s.jellies[0]!;
    const spread = () => {
      const xs = j.tentacles.map((t) => t.links[Math.floor(t.links.length / 2)]!.x);
      return Math.max(...xs) - Math.min(...xs);
    };
    // Relaxed, then squeezed.
    j.pulse = 0.6;
    run(s, 0.4);
    const relaxed = spread();
    j.pulse = 0;
    run(s, (T.pulseSeconds * 0.2) / j.rate);
    expect(spread()).toBeGreaterThan(relaxed);
  });

  it("undulate: even with the jelly held still they keep moving, the tips most", () => {
    const s = makeSwarm(800, 600, T, rng);
    const j = s.jellies[0]!;
    const thin = j.tentacles.find((t) => !t.arm)!;
    const range = (k: number) => {
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < 60 * 6; i++) {
        j.x = 400;
        j.y = 250;
        j.vx = 0;
        j.vy = 0;
        j.pulse = 0.5;
        step(s, 1 / 60, null, [], T, rng);
        const x = thin.links[k]!.x;
        lo = Math.min(lo, x);
        hi = Math.max(hi, x);
      }
      return hi - lo;
    };
    const tip = range(thin.links.length - 1);
    const middle = range(Math.floor(thin.links.length / 2));
    expect(middle).toBeGreaterThan(2);
    expect(tip).toBeGreaterThan(middle);
  });

  it("thin toward their tips; the oral arms are shorter and thicker", () => {
    const s = makeSwarm(800, 600, T, rng);
    const j = s.jellies[0]!;
    const thin = j.tentacles.filter((t) => !t.arm);
    const arms = j.tentacles.filter((t) => t.arm);
    expect(thin).toHaveLength(T.tentacles);
    expect(arms).toHaveLength(4);
    for (const t of j.tentacles) expect(t.w1).toBeLessThan(t.w0);
    expect(arms[0]!.w0).toBeGreaterThan(thin[0]!.w0);
    expect(Math.max(...arms.map((t) => t.length))).toBeLessThan(
      Math.min(...thin.map((t) => t.length)),
    );
  });
});

describe("a jelly's bell", () => {
  it("narrows and lengthens as it squeezes", () => {
    const s = makeSwarm(800, 600, T, rng);
    const j = s.jellies[0]!;
    j.pulse = 0.6;
    const relaxed = bellShape(s, j, T);
    j.pulse = 0.2;
    const squeezed = bellShape(s, j, T);
    expect(squeezed.rw).toBeLessThan(relaxed.rw);
    expect(squeezed.rh).toBeGreaterThan(relaxed.rh);
  });

  it("bounds the jelly, tentacles and arms included", () => {
    const s = makeSwarm(800, 600, T, rng);
    run(s, 2);
    for (const j of s.jellies) {
      const b = jellyBounds(s, j, T);
      for (const t of j.tentacles)
        for (const q of t.links) {
          expect(q.x).toBeGreaterThanOrEqual(b.x0);
          expect(q.x).toBeLessThanOrEqual(b.x1);
          expect(q.y).toBeLessThanOrEqual(b.y1);
        }
    }
  });
});

describe("hues", () => {
  it("are two from the palette: its accent and its light color", () => {
    const [a, b] = jellyHues([
      [10, 10, 10],
      [80, 80, 80],
      [160, 160, 160],
      [230, 230, 230],
      [80, 140, 240],
    ]);
    expect(a).toEqual([80, 140, 240]);
    expect(b).not.toEqual(a);
  });

  it("differ between jellies, so a swarm isn't one color", () => {
    const s = makeSwarm(800, 600, T, rng);
    expect(new Set(s.jellies.map((j) => j.hue.toFixed(2))).size).toBeGreaterThan(1);
  });
});

describe("resizing", () => {
  it("carries on: each jelly keeps its place as a share of the area, tentacles moved, not stretched", () => {
    const s = makeSwarm(800, 600, T, rng);
    run(s, 2);
    const j = s.jellies[0]!;
    const [x, y, time] = [j.x, j.y, s.time];
    const tip = j.tentacles[0]!.links.at(-1)!;
    const offset = [tip.x - j.x, tip.y - j.y];
    resizeSwarm(s, 1200, 900);
    expect(s.time).toBe(time);
    expect(j.x).toBeCloseTo(x * 1.5, 5);
    expect(j.y).toBeCloseTo(y * 1.5, 5);
    expect(tip.x - j.x).toBeCloseTo(offset[0]!, 5);
    expect(tip.y - j.y).toBeCloseTo(offset[1]!, 5);
    expect([s.width, s.height]).toEqual([1200, 900]);
  });
});
