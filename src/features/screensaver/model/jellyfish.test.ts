import { describe, expect, it } from "vitest";
import { contraction, JellyfishScene } from "./jellyfish";
import { seeded, testSetup } from "./scene";

const sum = (a: number[]) => a.reduce((n, v) => n + v, 0);

describe("JellyfishScene", () => {
  it("pulses quickly in and slowly out", () => {
    expect(contraction(0)).toBe(0);
    expect(contraction(0.25)).toBeCloseTo(1);
    // A quarter of the way back from full, it's still well contracted.
    expect(contraction(0.4)).toBeGreaterThan(0.5);
    expect(contraction(0.99)).toBeLessThan(0.01);
  });

  it("swims up, and comes back in from below", () => {
    const rows = 300;
    const scene = new JellyfishScene(testSetup(450, rows, seeded(4)));
    const near = scene.jellies[0]!;
    const start = near.y;
    for (let i = 0; i < 60 * 5; i++) scene.frame(1 / 60, null);
    expect(near.y).toBeLessThan(start);
    let cameBack = false;
    for (let i = 0; i < 60 * 300 && !cameBack; i++) {
      const before = near.y;
      scene.frame(1 / 60, null);
      cameBack = near.y > before + rows / 2;
    }
    expect(cameBack).toBe(true);
  });

  it("draws farther jellies fainter, behind nearer ones", () => {
    const cols = 450;
    const rows = 300;
    const scene = new JellyfishScene(testSetup(cols, rows, seeded(4)));
    const [front, back] = [scene.jellies[0]!, scene.jellies[scene.jellies.length - 1]!];
    // Both in the same place, so the front one should cover the back one.
    for (const j of scene.jellies) Object.assign(j, { x: -999, y: -999 });
    Object.assign(front, { x: 200, y: 150 });
    Object.assign(back, { x: 200, y: 150 });
    const out = new Uint8Array(cols * rows);
    const opacity = new Uint8Array(cols * rows).fill(255);
    scene.draw(out, opacity);
    const bothAt = Array.from(opacity.slice(150 * cols + 180, 150 * cols + 220));
    Object.assign(front, { x: -999, y: -999 });
    opacity.fill(255);
    scene.draw(out, opacity);
    const backAlone = Array.from(opacity.slice(150 * cols + 180, 150 * cols + 220));
    expect(sum(bothAt)).toBeGreaterThan(sum(backAlone));
  });
});
