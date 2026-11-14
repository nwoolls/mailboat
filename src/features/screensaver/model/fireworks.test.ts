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

  it("carries on through a resize: the same sparks, where they were", () => {
    const scene = new FireworksScene(testSetup(450, 300, seeded(2)));
    for (let i = 0; i < 60 * 4; i++) scene.frame(1 / 60, null);
    const before = scene.sparks.map((p) => [p.x, p.y]);
    const bursts = scene.bursts;
    scene.resize(testSetup(600, 360, seeded(3)));
    expect(scene.sparks.map((p) => [p.x, p.y])).toEqual(before);
    expect(scene.bursts).toBe(bursts);
    for (let i = 0; i < 60 * 4; i++) scene.frame(1 / 60, null);
    expect(scene.bursts).toBeGreaterThan(bursts);
  });

  it("has a weeping willow: its sparks sink slowly, most of the way to the ground", () => {
    const rows = 300;
    const scene = new FireworksScene(testSetup(450, rows, seeded(2)));
    const quiet = scene as unknown as {
      nextLaunch: number;
      nextLogo: number;
      launch: (x: number, y: number, shell: string, depth: number) => void;
    };
    quiet.nextLaunch = Infinity;
    quiet.nextLogo = Infinity;
    quiet.launch(225, 60, "weeping", 0);
    while (scene.rockets.length) scene.frame(1 / 60, null);
    const burstY = Math.min(...scene.sparks.filter((p) => !p.small).map((p) => p.y));
    for (let i = 0; i < 60 * 4; i++) scene.frame(1 / 60, null);
    const strands = scene.sparks.filter((p) => !p.small);
    // Four seconds on, still burning, and well down toward the ground.
    expect(strands.length).toBeGreaterThan(50);
    const lowest = Math.max(...strands.map((p) => p.y));
    expect(lowest - burstY).toBeGreaterThan(rows * 0.35);
    // Each hangs a long trail above it.
    expect(Math.max(...strands.map((p) => p.trail.length))).toBeGreaterThan(60);
  });
});
