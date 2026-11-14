import { describe, expect, it } from "vitest";
import {
  DEEP_STAR_DEFAULTS as T,
  makeStarfield,
  project,
  resizeStarfield,
  stepStars,
  streakTail,
} from "./deepStars";
import { streakChar } from "../ui/deepStarsDraw";

const rng = () => 0.4;

describe("the starfield", () => {
  it("brings stars nearer, and replaces those that pass far away again", () => {
    const f = makeStarfield(800, 600, 400, 320, T, rng);
    const s = f.stars[0]!;
    s.z = 0.5;
    stepStars(f, 0.5, null, T, rng);
    expect(f.stars[0]!.z).toBeLessThan(0.5);
    f.stars[0]!.z = 0.031;
    stepStars(f, 0.1, null, T, rng);
    expect(f.stars[0]!.z).toBeGreaterThan(0.8);
  });

  it("spreads nearer stars farther from the vanishing point", () => {
    const f = makeStarfield(800, 600, 400, 320, T, rng);
    const star = { x: 0.3, y: 0.2, z: 0.8, tint: 0 };
    const far = project(f, star);
    const near = project(f, { ...star, z: 0.2 });
    expect(Math.hypot(near.x - 400, near.y - 320)).toBeGreaterThan(
      Math.hypot(far.x - 400, far.y - 320),
    );
    expect(near.near).toBeGreaterThan(far.near);
  });

  it("goes to warp now and then, speeding up, and says so to nod the icon", () => {
    const f = makeStarfield(800, 600, 400, 320, T, rng);
    let began = false;
    for (let i = 0; i < 60 * (T.warpEvery * 1.3); i++)
      if (stepStars(f, 1 / 60, null, T, rng)) began = true;
    expect(began).toBe(true);
    const cruising = T.speed;
    for (let i = 0; i < 60 * 3; i++) stepStars(f, 1 / 60, null, T, rng);
    if (f.time < f.warpUntil) expect(f.speed).toBeGreaterThan(cruising * 2);
  });

  it("is steered by the pointer: the vanishing point leans toward it", () => {
    const f = makeStarfield(800, 600, 400, 320, T, rng);
    for (let i = 0; i < 120; i++) stepStars(f, 1 / 60, { x: 800, y: 320 }, T, rng);
    expect(f.vx).toBeGreaterThan(450);
  });

  it("draws a star's streak behind it, toward where it came from", () => {
    const f = makeStarfield(800, 600, 400, 320, T, rng);
    f.speed = T.warpSpeed;
    const star = { x: 0.4, y: 0, z: 0.3, tint: 0 };
    const head = project(f, star);
    const tail = streakTail(f, star, T);
    // Right of the vanishing point, it flies right: its tail is to its left.
    expect(tail.x).toBeLessThan(head.x);
    expect(tail.x).toBeGreaterThan(400);
  });

  it("draws streaks in characters that follow their direction", () => {
    expect(streakChar(0)).toBe("-");
    expect(streakChar(Math.PI / 2)).toBe("|");
    expect(streakChar(Math.PI / 4)).toBe("\\");
    expect(streakChar(-Math.PI / 4)).toBe("/");
  });
});

describe("resizing", () => {
  it("carries on: the same stars keep flying, the vanishing point follows its rest, dust keeps its share", () => {
    const f = makeStarfield(800, 600, 400, 300, T, rng);
    stepStars(f, 1, null, T, rng);
    const stars = f.stars.map((s) => ({ ...s }));
    const time = f.time;
    const dust = { ...f.dust[0]! };
    resizeStarfield(f, 1200, 900, 600, 450);
    expect(f.time).toBe(time);
    expect(f.stars).toEqual(stars);
    expect([f.vx, f.vy]).toEqual([600, 450]);
    expect(f.dust[0]!.x).toBeCloseTo(dust.x * 1.5, 5);
    expect(f.dust[0]!.y).toBeCloseTo(dust.y * 1.5, 5);
  });
});
