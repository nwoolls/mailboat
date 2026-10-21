import { describe, expect, it } from "vitest";
import {
  appearanceVars,
  DEFAULT_APPEARANCE,
  isDefault,
  parseAppearance,
  TINT_RANGE,
  tintFor,
  seeThrough,
  withTint,
} from "./appearance";

describe("appearance", () => {
  it("defaults when nothing or junk was saved", () => {
    expect(parseAppearance(null)).toEqual(DEFAULT_APPEARANCE);
    expect(parseAppearance("not json")).toEqual(DEFAULT_APPEARANCE);
    expect(parseAppearance("[1]")).toEqual(DEFAULT_APPEARANCE);
    expect(parseAppearance('{"sidebarTint":"a"}')).toEqual(DEFAULT_APPEARANCE);
  });

  it("reads saved values, kept within range, to half points", () => {
    expect(parseAppearance('{"sidebarTint":4.6,"listTint":-99,"accent":"green"}')).toEqual({
      sidebarTint: 4.5,
      listTint: TINT_RANGE.listTint.min,
      accent: "green",
    });
    expect(parseAppearance('{"accent":"plaid"}').accent).toBe("blue");
  });

  it("changes one tint, clamped", () => {
    const a = withTint(DEFAULT_APPEARANCE, "sidebarTint", 999);
    expect(a).toEqual({ ...DEFAULT_APPEARANCE, sidebarTint: TINT_RANGE.sidebarTint.max });
    expect(isDefault(a)).toBe(false);
    expect(isDefault(DEFAULT_APPEARANCE)).toBe(true);
  });

  it("becomes CSS adjustments in percentage points", () => {
    expect(appearanceVars({ sidebarTint: -3, listTint: 10, accent: "blue" })).toEqual({
      "--glass-sidebar-adjust": "-3%",
      "--glass-panel-adjust": "10%",
      "--color-accent": "hsl(217 85% 62%)",
    });
  });

  it("shows how see-through an area is, in percent", () => {
    expect(seeThrough(6.5, 0)).toBe(94);
    expect(seeThrough(34, 10)).toBe(56);
    expect(seeThrough(6.5, -6)).toBe(100);
    expect(seeThrough(90, 40)).toBe(0);
  });

  it("runs sliders from 0% to 100% see-through, keeping saved settings", () => {
    // Both ends reachable from either look's default (dark 6.5, light 10).
    for (const base of [6.5, 10]) {
      const clear = withTint(DEFAULT_APPEARANCE, "sidebarTint", tintFor(base, 100));
      expect(seeThrough(base, clear.sidebarTint)).toBe(100);
      expect(base + clear.sidebarTint).toBe(0);
      const solid = withTint(DEFAULT_APPEARANCE, "sidebarTint", tintFor(base, 0));
      expect(seeThrough(base, solid.sidebarTint)).toBe(0);
    }
    for (const base of [34, 37]) {
      expect(
        seeThrough(base, withTint(DEFAULT_APPEARANCE, "listTint", tintFor(base, 0)).listTint),
      ).toBe(0);
      expect(
        seeThrough(base, withTint(DEFAULT_APPEARANCE, "listTint", tintFor(base, 100)).listTint),
      ).toBe(100);
    }
    // A setting saved under the old ranges reads back unchanged.
    expect(parseAppearance('{"sidebarTint":-6,"listTint":40}')).toMatchObject({
      sidebarTint: -6,
      listTint: 40,
    });
  });
});
