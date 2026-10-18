import { describe, expect, it } from "vitest";
import {
  arrowCells,
  CURSOR,
  fillCeiling,
  GRAIN,
  grainValue,
  HELD,
  isRealMove,
  kindOf,
  SAND_KINDS,
  SandBox,
  SandShow,
  SOLID,
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
const countHeld = (box: SandBox) => box.cells.filter((v) => v >= GRAIN && v & HELD).length;
const run = (box: SandBox, frames: number) => {
  for (let i = 0; i < frames; i++) box.step();
};

describe("SandBox", () => {
  it("sinks a grain to the floor", () => {
    const box = new SandBox(5, 10, seeded());
    box.pour(2, grain);
    run(box, 60);
    expect(at(box, 2, 9)).toBe(grain);
    expect(countGrains(box)).toBe(1);
    expect(box.moving).toBe(0);
  });

  it("rests sand on solids and never inside them", () => {
    const box = new SandBox(9, 12, seeded());
    const mask = new Uint8Array(9 * 12);
    for (let x = 2; x <= 6; x++) mask[6 * 9 + x] = 1; // a shelf
    box.setSolids(mask);
    box.pour(4, grain);
    run(box, 60);
    expect(at(box, 4, 5)).toBe(grain);
    for (let x = 2; x <= 6; x++) expect(at(box, x, 6)).toBe(SOLID);
  });

  it("builds a steep hill from a trickle and keeps every grain", () => {
    const box = new SandBox(41, 30, seeded());
    for (let i = 0; i < 120; i++) {
      box.pour(20, grain);
      run(box, 4);
    }
    run(box, 300);
    expect(countGrains(box)).toBe(120);
    expect(box.grains).toBe(120);
    const heights = Array.from({ length: 41 }, (_, x) => {
      let h = 0;
      while (h < 30 && at(box, x, 29 - h) >= GRAIN) h++;
      return h;
    });
    // Taller than a 45° heap of the same sand would be.
    expect(Math.max(...heights)).toBeGreaterThan(Math.sqrt(120));
    expect(heights.filter((h) => h > 0).length).toBeGreaterThan(5);
  });

  it("holds ceiling grains until released from below", () => {
    // One column wide, so nothing drifts or slides out of it.
    const box = new SandBox(1, 10, seeded());
    box.hang(0, 0, grain);
    box.hang(0, 1, grain);
    run(box, 30);
    expect(at(box, 0, 1)).toBe(grain | HELD);
    expect(box.release(0)).toBe(true); // the lower one goes
    expect(box.held).toBe(1);
    run(box, 60);
    expect(at(box, 0, 9)).toBe(grain);
    expect(at(box, 0, 0)).toBe(grain | HELD);
    box.hang(0, 8, grain); // held, but sitting on the pile
    expect(box.release(0)).toBe(false); // the lowest held grain can't fall
    expect(box.release(1)).toBe(false); // no such column
  });

  it("releases from the deepest loose column within reach, as the given sand", () => {
    const box = new SandBox(7, 10, seeded());
    for (let x = 0; x < 7; x++) box.hang(x, 0, grain);
    box.hang(5, 1, grain); // column 5 hangs lowest
    expect(box.release(3, 2, grainValue(1, 0))).toBe(true);
    expect(at(box, 5, 1)).toBe(grainValue(1, 0));
    expect(box.held).toBe(7);
    expect(box.release(3, 0)).toBe(true); // within reach 0: column 3 only
    expect(at(box, 3, 0) & HELD).toBe(0);
  });

  it("turns over: the landscape becomes a hanging ceiling", () => {
    const box = new SandBox(1, 8, seeded());
    box.pour(0, grain);
    run(box, 80);
    box.pour(0, grainValue(1, 0));
    run(box, 80);
    box.turnOver();
    // The pile now hangs from the top, upside down.
    expect(at(box, 0, 0)).toBe(grain | HELD);
    expect(at(box, 0, 1)).toBe(grainValue(1, 0) | HELD);
    expect(box.held).toBe(2);
    expect(countHeld(box)).toBe(2);
    expect(box.grains).toBe(2);
  });

  it("drops grains that turn over into a solid", () => {
    const box = new SandBox(1, 4, seeded());
    const mask = new Uint8Array(4);
    mask[0] = 1; // the top is solid; the grain on the floor turns into it
    box.setSolids(mask);
    box.hang(0, 3, grain);
    box.turnOver();
    expect(box.grains).toBe(0);
    expect(countGrains(box)).toBe(0);
  });

  it("rests sand on the pointer and pushes what it moves into", () => {
    const box = new SandBox(10, 20, seeded());
    const shape = [[-1, 0] as const, [0, 0] as const, [1, 0] as const];
    box.setCursor({ x: 4, y: 10 }, shape);
    box.pour(4, grain);
    run(box, 60);
    expect(at(box, 4, 9)).toBe(grain);
    // Moving up into the grain launches it instead of overwriting it.
    box.setCursor({ x: 4, y: 9 }, shape);
    expect(at(box, 4, 9)).toBe(CURSOR);
    expect(box.particles).toHaveLength(1);
    run(box, 200);
    expect(box.particles).toHaveLength(0);
    expect(countGrains(box)).toBe(1);
    box.setCursor(null, shape);
    expect(box.cells.includes(CURSOR)).toBe(false);
  });

  it("shrugs the heap off a ledge", () => {
    const box = new SandBox(20, 30, seeded());
    const mask = new Uint8Array(20 * 30);
    for (let x = 6; x <= 13; x++) mask[20 * 20 + x] = 1;
    box.setSolids(mask);
    for (let i = 0; i < 30; i++) {
      box.pour(9 + (i % 2), grain);
      run(box, 6);
    }
    run(box, 100);
    expect(box.restingOn(6, 13, 20, 4)).toBeGreaterThan(0);
    expect(box.shrug(6, 13, 20)).toBe(box.particles.length);
    expect(box.restingOn(6, 13, 20, 4)).toBe(0);
    run(box, 400);
    expect(box.grains).toBe(30);
    expect(countGrains(box)).toBe(30);
  });
});

describe("fillCeiling", () => {
  it("hangs about a sixth of the frame in alternating bands", () => {
    const box = new SandBox(60, 60, seeded());
    fillCeiling(box, seeded(2));
    expect(box.held).toBe(box.grains);
    expect(box.grains / (60 * 60)).toBeGreaterThan(0.1);
    expect(box.grains / (60 * 60)).toBeLessThan(0.25);
    const kinds = new Set(Array.from({ length: 10 }, (_, y) => kindOf(at(box, 30, y))));
    expect(kinds.size).toBeGreaterThan(1);
  });
});

describe("SandShow", () => {
  it("leaks the ceiling into a landscape, rests, turns over and goes again", () => {
    const show = new SandShow(40, 40, seeded());
    const start = show.box.grains;
    const seen = new Set<string>();
    let turns = 0;
    let wasTurning = false;
    for (let i = 0; i < 60 * 120 && turns < 1; i++) {
      show.frame(1 / 60);
      seen.add(show.phase);
      if (wasTurning && show.phase === "falling") turns++;
      wasTurning = show.phase === "turning";
    }
    expect([...seen].toSorted()).toEqual(["falling", "resting", "turning"]);
    expect(turns).toBe(1);
    // After the turn the landscape hangs again; little is lost.
    expect(show.box.held).toBeGreaterThan(start * 0.5);
    expect(show.box.grains).toBeGreaterThan(start * 0.9);
  });

  it("shrugs off the icon's heap once it piles up", () => {
    const show = new SandShow(40, 60, seeded());
    const mask = new Uint8Array(40 * 60);
    for (let x = 0; x < 40; x++) mask[40 * 40 + x] = 1; // icon spans the width
    show.box.setSolids(mask);
    let shrugged = false;
    for (let i = 0; i < 60 * 120 && !shrugged; i++)
      shrugged = show.frame(1 / 60, { x0: 0, x1: 39, top: 40 });
    expect(shrugged).toBe(true);
  });
});

describe("grains", () => {
  it("encodes kinds above the reserved values and below HELD", () => {
    expect(grainValue(0, 0)).toBe(GRAIN);
    expect(grainValue(SAND_KINDS.length - 1, 3)).toBeLessThan(HELD);
    expect(kindOf(grainValue(2, 3) | HELD)).toBe(2);
  });
});

describe("isRealMove", () => {
  it("ignores pointer events that don't move", () => {
    expect(isRealMove(null, { clientX: 5, clientY: 5 })).toBe(false);
    expect(isRealMove({ x: 5, y: 5 }, { clientX: 5, clientY: 5 })).toBe(false);
    expect(isRealMove({ x: 5, y: 5 }, { clientX: 6, clientY: 6 })).toBe(false);
    expect(isRealMove({ x: 5, y: 5 }, { clientX: 12, clientY: 5 })).toBe(true);
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
