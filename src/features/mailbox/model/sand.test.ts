import { describe, expect, it } from "vitest";
import {
  arrowCells,
  CURSOR,
  EMPTY,
  GRAIN,
  grainValue,
  layerAt,
  LAYER_SECONDS,
  SAND_COLORS,
  SandBox,
  SandShow,
  SOLID,
  spoutAt,
} from "./sand";

/** A repeatable stand-in for Math.random. */
function seeded(seed = 1) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const grain = grainValue(0, 0);
const at = (box: SandBox, x: number, y: number) => box.cells[y * box.cols + x]!;
const countGrains = (box: SandBox) => box.cells.filter((v) => v >= GRAIN).length;
const run = (box: SandBox, frames: number) => {
  for (let i = 0; i < frames; i++) box.step();
};

describe("SandBox", () => {
  it("drops a grain to the floor", () => {
    const box = new SandBox(5, 10, seeded());
    box.pour(2, grain);
    run(box, 20);
    expect(at(box, 2, 9)).toBe(grain);
    expect(countGrains(box)).toBe(1);
  });

  it("rests sand on solids and never inside them", () => {
    const box = new SandBox(9, 12, seeded());
    const mask = new Uint8Array(9 * 12);
    for (let x = 2; x <= 6; x++) mask[6 * 9 + x] = 1; // a shelf
    box.setSolids(mask);
    box.pour(4, grain);
    run(box, 20);
    expect(at(box, 4, 5)).toBe(grain);
    for (let x = 2; x <= 6; x++) expect(at(box, x, 6)).toBe(SOLID);
  });

  it("spreads a poured column into a heap and keeps every grain", () => {
    const box = new SandBox(31, 20, seeded());
    for (let i = 0; i < 60; i++) {
      box.pour(15, grain);
      run(box, 3);
    }
    run(box, 100);
    expect(countGrains(box)).toBe(60);
    expect(box.grains).toBe(60);
    const floor = Array.from({ length: 31 }, (_, x) => at(box, x, 19)).filter((v) => v >= GRAIN);
    expect(floor.length).toBeGreaterThan(8);
  });

  it("drains through the floor", () => {
    const box = new SandBox(10, 10, seeded());
    for (let i = 0; i < 20; i++) {
      box.pour(i % 10, grain);
      run(box, 4);
    }
    box.draining = true;
    run(box, 200);
    expect(countGrains(box)).toBe(0);
    expect(box.grains).toBe(0);
  });

  it("rests sand on the pointer and flings what it moves into", () => {
    const box = new SandBox(10, 20, seeded());
    const shape = [[-1, 0] as const, [0, 0] as const, [1, 0] as const];
    box.setCursor({ x: 4, y: 10 }, shape);
    box.pour(4, grain);
    run(box, 20);
    expect(at(box, 4, 9)).toBe(grain);
    // Moving up into the grain launches it instead of overwriting it.
    box.setCursor({ x: 4, y: 9 }, shape);
    expect(at(box, 4, 9)).toBe(CURSOR);
    expect(box.particles).toHaveLength(1);
    run(box, 60);
    expect(box.particles).toHaveLength(0);
    expect(countGrains(box)).toBe(1);
    box.setCursor(null, shape);
    expect(box.cells.includes(CURSOR)).toBe(false);
  });

  it("shrugs the heap off a ledge into the air", () => {
    const box = new SandBox(20, 30, seeded());
    const mask = new Uint8Array(20 * 30);
    for (let x = 6; x <= 13; x++) mask[20 * 20 + x] = 1;
    box.setSolids(mask);
    for (let i = 0; i < 30; i++) {
      box.pour(9 + (i % 2), grain);
      run(box, 4);
    }
    run(box, 60);
    const before = box.restingOn(6, 13, 20, 4);
    expect(before).toBeGreaterThan(0);
    expect(box.shrug(6, 13, 20)).toBe(box.particles.length);
    expect(box.restingOn(6, 13, 20, 4)).toBe(0);
    run(box, 200);
    expect(box.grains).toBe(30);
    expect(countGrains(box)).toBe(30);
  });
});

describe("SandShow", () => {
  it("pours up to its budget, then drains and starts over", () => {
    const show = new SandShow(40, 40, seeded());
    let drained = false;
    let refilled = false;
    for (let i = 0; i < 6000 && !refilled; i++) {
      show.frame(1 / 60);
      if (show.phase === "draining") drained = true;
      else if (drained) refilled = true;
    }
    expect(drained).toBe(true);
    expect(refilled).toBe(true);
    expect(show.box.grains).toBeLessThan(show.budget * 0.1);
  });

  it("shrugs off the icon's heap once it piles up", () => {
    const show = new SandShow(40, 60, seeded());
    const mask = new Uint8Array(40 * 60);
    for (let x = 0; x < 40; x++) mask[30 * 40 + x] = 1; // icon spans the width
    show.box.setSolids(mask);
    let shrugged = false;
    for (let i = 0; i < 3000 && !shrugged; i++)
      shrugged = show.frame(1 / 60, { x0: 0, x1: 39, top: 30 });
    expect(shrugged).toBe(true);
  });
});

describe("spout and layers", () => {
  it("keeps the spout inside the frame", () => {
    for (let t = 0; t < 600; t += 0.7) {
      expect(spoutAt(t)).toBeGreaterThanOrEqual(0.1);
      expect(spoutAt(t)).toBeLessThanOrEqual(0.9);
    }
  });

  it("changes colour every layer and cycles", () => {
    expect(layerAt(0)).toBe(0);
    expect(layerAt(LAYER_SECONDS)).toBe(1);
    expect(layerAt(LAYER_SECONDS * SAND_COLORS.length)).toBe(0);
  });

  it("encodes grains above the reserved values", () => {
    expect(grainValue(0, 0)).toBe(GRAIN);
    expect(grainValue(SAND_COLORS.length - 1, 3)).toBeLessThan(256);
    expect(EMPTY).toBeLessThan(GRAIN);
  });
});

describe("arrowCells", () => {
  it("covers the pointer's tip and stays within its size", () => {
    const cells = arrowCells(3);
    expect(cells).toContainEqual([0, 0]);
    for (const [x, y] of cells) {
      expect(x).toBeLessThan(5);
      expect(y).toBeLessThan(7);
    }
    expect(cells.length).toBeGreaterThan(8);
  });
});
