import { describe, expect, it } from "vitest";
import { lifeChar } from "./deepLife";
import { LifeScene } from "./life";
import { seeded, testSetup } from "./scene";

describe("Life in the Toybox's styles", () => {
  it("draws a cell in ASCII by its age: newborn @, settling to .", () => {
    expect([0, 5, 20, 60].map(lifeChar)).toEqual(["@", "O", "o", "."]);
  });

  it("with big tiles still seeds enough life to keep going a while", () => {
    // About an ASCII character's cell, on a reader-sized grid of 1px cells.
    const scene = new LifeScene(testSetup(760, 520, seeded(3)), { w: 8, h: 15, ox: 0, oy: 0 });
    expect(scene.population).toBeGreaterThan(60);
    for (let i = 0; i < 60 * 8; i++) scene.frame(1 / 60, null);
    expect(scene.phase).toBe("living");
  });

  it("carries on through a resize: the same cells where they were", () => {
    const tiles = { w: 8, h: 8, ox: 0, oy: 0 };
    const old = new LifeScene(testSetup(400, 300, seeded(1)), tiles);
    for (let i = 0; i < 60; i++) old.frame(1 / 60, null);
    const next = new LifeScene(testSetup(480, 320, seeded(9)), tiles);
    next.carryFrom(old);
    for (let y = 0; y < old.rows; y++)
      for (let x = 0; x < old.cols; x++)
        expect(next.alive[y * next.cols + x]).toBe(old.alive[y * old.cols + x]);
    expect(next.phase).toBe(old.phase);
  });
});
