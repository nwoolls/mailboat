import { describe, expect, it } from "vitest";
import { FireworksScene } from "./fireworks";
import { seeded, testSetup } from "./scene";

describe("FireworksScene", () => {
  it("launches rockets that burst into sparks, which burn out", () => {
    const scene = new FireworksScene(testSetup(450, 300, seeded(2)));
    let most = 0;
    for (let i = 0; i < 60 * 10; i++) {
      scene.frame(1 / 60, null);
      most = Math.max(most, scene.sparks.length);
    }
    expect(scene.bursts).toBeGreaterThan(3);
    expect(most).toBeGreaterThan(100);
    // Left alone with no more launches, every spark goes out.
    for (const r of scene.rockets) r.vy = 0;
    (scene as unknown as { nextLaunch: number; nextLogo: number }).nextLaunch = Infinity;
    (scene as unknown as { nextLaunch: number; nextLogo: number }).nextLogo = Infinity;
    for (let i = 0; i < 60 * 8; i++) scene.frame(1 / 60, null);
    expect(scene.sparks.length).toBe(0);
  });

  it("bursts into the app icon's boat now and then, and the icon nods", () => {
    const scene = new FireworksScene(testSetup(450, 300, seeded(2)));
    let nodded = false;
    for (let i = 0; i < 60 * 40 && !nodded; i++) nodded = !!scene.frame(1 / 60, null).nod;
    expect(nodded).toBe(true);
  });

  it("aims a rocket at the pointer when it moves", () => {
    const scene = new FireworksScene(testSetup(450, 300, seeded(2)));
    scene.frame(1 / 60, { x: 100, y: 80 });
    scene.frame(1 / 60, { x: 104, y: 80 });
    const aimed = scene.rockets.find((r) => Math.abs(r.x - 104) < 6);
    expect(aimed).toBeDefined();
  });
});
