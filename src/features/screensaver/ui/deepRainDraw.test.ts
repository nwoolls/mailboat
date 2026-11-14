import { describe, expect, it } from "vitest";
import type { Drop } from "../model/rain";
import { stickyColumn } from "./deepRainDraw";

const drop = (): Drop => ({ x: 0, y: 0, r: 3, vy: 0, sliding: true, life: 10, onIcon: false });

describe("a drop in ASCII art", () => {
  it("stays in its column while it wobbles on the line, instead of flipping back and forth", () => {
    const d = drop();
    const seen = new Set<number>();
    for (const gx of [4.98, 5.02, 4.97, 5.03, 4.99, 5.01]) seen.add(stickyColumn(d, gx));
    expect(seen.size).toBe(1);
  });

  it("moves on once it is well into the next column", () => {
    const d = drop();
    expect(stickyColumn(d, 4.9)).toBe(4);
    expect(stickyColumn(d, 5.2)).toBe(4);
    expect(stickyColumn(d, 5.4)).toBe(5);
  });
});
