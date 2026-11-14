import { describe, expect, it } from "vitest";
import {
  birdChar,
  DEPTH,
  MURMURATION_DEFAULTS as T,
  makeMurmuration,
  ROOST_SECONDS,
  stepMurmuration,
} from "./murmuration";
import { seeded } from "./scene";

const run = (m: ReturnType<typeof makeMurmuration>, seconds: number, rng = seeded(5)) => {
  let nodded = false;
  for (let i = 0; i < seconds * 60; i++)
    nodded = stepMurmuration(m, 1 / 60, null, { x: 400, y: 300 }, T, rng) || nodded;
  return nodded;
};

describe("the flock", () => {
  it("keeps within the area, and flies at about cruising speed", () => {
    const m = makeMurmuration(800, 600, { ...T, count: 200 }, seeded(1));
    m.nextRoost = Infinity;
    run(m, 10);
    for (const b of m.birds) {
      expect(b.x).toBeGreaterThan(-20);
      expect(b.x).toBeLessThan(820);
      expect(b.y).toBeGreaterThan(-20);
      expect(b.y).toBeLessThan(620);
      expect(Math.hypot(b.vx, b.vy, b.vz)).toBeGreaterThan(T.speed * 0.6);
    }
  });

  it("has volume: its birds spread through depth, near and far", () => {
    const m = makeMurmuration(800, 600, { ...T, count: 300 }, seeded(2));
    m.nextRoost = Infinity;
    run(m, 8);
    const depths = m.birds.map((b) => b.depth);
    expect(Math.min(...depths)).toBeLessThan(0.35);
    expect(Math.max(...depths)).toBeGreaterThan(0.65);
    for (const b of m.birds) expect(b.z).toBeLessThanOrEqual(DEPTH);
  });

  it("flees the pointer", () => {
    const m = makeMurmuration(800, 600, { ...T, count: 1 }, seeded(3));
    const b = m.birds[0]!;
    Object.assign(b, { x: 400, y: 300, vx: 0, vy: 0, vz: 0 });
    m.nextRoost = Infinity;
    for (let i = 0; i < 20; i++) stepMurmuration(m, 1 / 60, { x: 380, y: 300 }, null, T, seeded(i));
    expect(b.x).toBeGreaterThan(400);
  });

  it("roosts in the icon now and then, and the icon nods once as it goes in", () => {
    const m = makeMurmuration(800, 600, { ...T, count: 150 }, seeded(4));
    m.nextRoost = 1;
    let nods = 0;
    const rng = seeded(8);
    for (let i = 0; i < (1 + ROOST_SECONDS) * 60; i++)
      if (stepMurmuration(m, 1 / 60, null, { x: 400, y: 300 }, T, rng)) nods++;
    expect(nods).toBe(1);
  });

  it("shows a lone bird in ASCII flying the way it goes", () => {
    expect(birdChar(1, 0)).toBe(">");
    expect(birdChar(0, 1)).toBe("v");
    expect(birdChar(-1, 0)).toBe("<");
    expect(birdChar(0, -1)).toBe("^");
  });
});
