import { describe, expect, it } from "vitest";
import { KOI_RAMP, koiChar } from "./koiAscii";

describe("a koi in ASCII art", () => {
  it("is dense where it is solid and bright, lighter at its shaded sides and thin fins", () => {
    const back = koiChar(1, 1)!;
    const side = koiChar(1, 0.3)!;
    const fin = koiChar(0.35, 0.8)!;
    expect(KOI_RAMP.indexOf(back)).toBeGreaterThan(KOI_RAMP.indexOf(side));
    expect(KOI_RAMP.indexOf(back)).toBeGreaterThan(KOI_RAMP.indexOf(fin));
  });

  it("leaves a cell it barely touches empty", () => {
    expect(koiChar(0.05, 1)).toBeNull();
  });
});
