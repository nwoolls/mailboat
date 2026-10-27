import { describe, expect, it } from "vitest";
import { seeded, testSetup } from "./scene";
import { StarfieldScene } from "./starfield";

describe("StarfieldScene", () => {
  it("brings the stars nearer, and new ones in from far away", () => {
    const scene = new StarfieldScene(testSetup(450, 300, seeded(3)));
    const before = scene.stars.map((s) => s.z);
    scene.frame(1 / 60, null);
    // All nearer, but for the few that just passed and were replaced.
    const nearer = scene.stars.filter((s, i) => s.z < before[i]!).length;
    expect(nearer / scene.stars.length).toBeGreaterThan(0.85);
    // In a minute every star has passed at least once.
    for (let i = 0; i < 60 * 60; i++) scene.frame(1 / 60, null);
    expect(scene.stars.every((s) => s.z > 0)).toBe(true);
  });

  it("goes to warp now and then, with a nod, then back to cruising", () => {
    const scene = new StarfieldScene(testSetup(450, 300, seeded(3)));
    let nods = 0;
    let fastest = 0;
    let slowedAgain = false;
    for (let i = 0; i < 60 * 120; i++) {
      if (scene.frame(1 / 60, null).nod) nods++;
      fastest = Math.max(fastest, scene.speed);
      if (fastest > 0.9 && scene.speed < 0.13) slowedAgain = true;
    }
    expect(nods).toBeGreaterThan(0);
    expect(fastest).toBeGreaterThan(0.9);
    expect(slowedAgain).toBe(true);
  });

  it("asks for a night sky", () => {
    expect(new StarfieldScene(testSetup(90, 80, seeded())).night).toBe(true);
  });
});
