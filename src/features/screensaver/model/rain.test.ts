import { describe, expect, it } from "vitest";
import { RainScene } from "./rain";
import { seeded, testSetup } from "./scene";

describe("RainScene", () => {
  it("carries on through a resize: drops, fog and trails where they were", () => {
    const scene = new RainScene(testSetup(200, 150, seeded(4)));
    for (let i = 0; i < 60 * 6; i++) scene.frame(1 / 60, null);
    const drops = scene.drops.map((d) => [d.x, d.y, d.r]);
    const at = (x: number, y: number) => [
      scene.trail[y * scene.size.cols + x],
      scene.mist[y * scene.size.cols + x],
    ];
    const before = at(120, 90);
    scene.resize(testSetup(260, 180, seeded(5)));
    expect(scene.size).toEqual({ cols: 260, rows: 180 });
    expect(scene.drops.map((d) => [d.x, d.y, d.r])).toEqual(drops);
    expect(at(120, 90)).toEqual(before);
    // New glass fogs over like the rest, and it keeps raining.
    expect(scene.mist[179 * 260 + 259]).toBeGreaterThan(0.7);
    for (let i = 0; i < 60 * 3; i++) scene.frame(1 / 60, null);
    expect(scene.drops.length).toBeGreaterThan(0);
  });
});
