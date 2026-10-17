import { describe, expect, it } from "vitest";
import {
  appearanceVars,
  DEFAULT_APPEARANCE,
  isDefault,
  parseAppearance,
  TINT_RANGE,
  tintLabel,
  withTint,
} from "./appearance";

describe("appearance", () => {
  it("defaults when nothing or junk was saved", () => {
    expect(parseAppearance(null)).toEqual(DEFAULT_APPEARANCE);
    expect(parseAppearance("not json")).toEqual(DEFAULT_APPEARANCE);
    expect(parseAppearance("[1]")).toEqual(DEFAULT_APPEARANCE);
    expect(parseAppearance('{"sidebarTint":"a"}')).toEqual(DEFAULT_APPEARANCE);
  });

  it("reads saved values, kept within range and whole", () => {
    expect(parseAppearance('{"sidebarTint":4.6,"listTint":-99}')).toEqual({
      sidebarTint: 5,
      listTint: TINT_RANGE.listTint.min,
    });
  });

  it("changes one tint, clamped", () => {
    const a = withTint(DEFAULT_APPEARANCE, "sidebarTint", 999);
    expect(a).toEqual({ sidebarTint: TINT_RANGE.sidebarTint.max, listTint: 0 });
    expect(isDefault(a)).toBe(false);
    expect(isDefault(DEFAULT_APPEARANCE)).toBe(true);
  });

  it("becomes CSS adjustments in percentage points", () => {
    expect(appearanceVars({ sidebarTint: -3, listTint: 10 })).toEqual({
      "--glass-sidebar-adjust": "-3%",
      "--glass-panel-adjust": "10%",
    });
  });

  it("labels slider values", () => {
    expect(tintLabel(0)).toBe("Default");
    expect(tintLabel(5)).toBe("+5");
    expect(tintLabel(-5)).toBe("−5");
  });
});
