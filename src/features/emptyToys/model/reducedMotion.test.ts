import { describe, expect, it } from "vitest";
import { REDUCED_MOTION_EFFECTS, reducedMotionIntro } from "./reducedMotion";
import { TOYS } from "./toys";

describe("reducedMotionIntro", () => {
  it("names the Mac's setting, and says when it is on", () => {
    expect(reducedMotionIntro(true, true)).toMatch(/^Reduce motion is on in System Settings/);
    expect(reducedMotionIntro(false, true)).toMatch(/^When Reduce motion is on/);
  });

  it("names the Windows setting, which is off to reduce motion", () => {
    expect(reducedMotionIntro(true, false)).toMatch(/^Animation effects are off in Windows/);
    expect(reducedMotionIntro(false, false)).toMatch(/^When Animation effects are off/);
  });
});

describe("REDUCED_MOTION_EFFECTS", () => {
  it("covers every toy, by the name Settings shows, then the screensaver", () => {
    const toys = TOYS.filter((t) => t.id !== "none").map((t) => t.label);
    expect(REDUCED_MOTION_EFFECTS.map((e) => e.label)).toEqual([...toys, "Screensaver"]);
  });
});
