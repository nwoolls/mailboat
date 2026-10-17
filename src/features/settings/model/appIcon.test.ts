import { describe, expect, it } from "vitest";
import { BUILT_IN_ICON, iconLabel, iconSetting, shownIcon } from "./appIcon";

describe("app icon choice", () => {
  it("shows the built-in icon when nothing was chosen", () => {
    expect(shownIcon(null)).toBe(BUILT_IN_ICON);
    expect(shownIcon(undefined)).toBe(BUILT_IN_ICON);
    expect(shownIcon("C10-orange")).toBe("C10-orange");
  });

  it("saves the built-in icon as no choice", () => {
    expect(iconSetting(BUILT_IN_ICON)).toBeNull();
    expect(iconSetting("C01-mint")).toBe("C01-mint");
  });

  it("names choices for people", () => {
    expect(iconLabel("C10-orange")).toBe("Orange");
    expect(iconLabel("C17-system-blue")).toBe("System blue");
  });
});
