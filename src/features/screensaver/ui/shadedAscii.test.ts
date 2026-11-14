import { describe, expect, it } from "vitest";
import { SHADE_RAMP, shadeChar } from "./shadedAscii";

describe("a koi in ASCII art", () => {
  it("is dense where it is solid and bright, lighter at its shaded sides and thin fins", () => {
    const back = shadeChar(1, 1)!;
    const side = shadeChar(1, 0.3)!;
    const fin = shadeChar(0.35, 0.8)!;
    expect(SHADE_RAMP.indexOf(back)).toBeGreaterThan(SHADE_RAMP.indexOf(side));
    expect(SHADE_RAMP.indexOf(back)).toBeGreaterThan(SHADE_RAMP.indexOf(fin));
  });

  it("leaves a cell it barely touches empty", () => {
    expect(shadeChar(0.05, 1)).toBeNull();
  });
});
