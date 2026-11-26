import { describe, expect, it } from "vitest";
import { REDUCED_MOTION_EFFECTS, reducedMotionIntro } from "./reducedMotion";
import { TOYS } from "./toys";

describe("reducedMotionIntro", () => {
  it("names the Mac's setting, and says when it is on", () => {
    expect(reducedMotionIntro(true, "mac")).toMatch(/^Reduce motion is on in System Settings/);
    expect(reducedMotionIntro(false, "mac")).toMatch(/^When Reduce motion is on/);
  });

  it("names the Windows setting, which is off to reduce motion", () => {
    expect(reducedMotionIntro(true, "windows")).toMatch(/^Animation effects are off in Windows/);
    expect(reducedMotionIntro(false, "windows")).toMatch(/^When Animation effects are off/);
  });

  it("points Linux at the desktop's own settings, which differ between desktops", () => {
    expect(reducedMotionIntro(true, "linux")).toMatch(/^Animations are turned off in your desktop/);
    expect(reducedMotionIntro(false, "linux")).toMatch(/^When animations are turned off/);
  });
});

describe("REDUCED_MOTION_EFFECTS", () => {
  it("covers every toy, by the name Settings shows, then the screensaver", () => {
    const toys = TOYS.filter((t) => t.id !== "none").map((t) => t.label);
    expect(REDUCED_MOTION_EFFECTS.map((e) => e.label)).toEqual([...toys, "Screensaver"]);
  });
});
