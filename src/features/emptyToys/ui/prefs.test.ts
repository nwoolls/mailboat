import { afterEach, describe, expect, it, vi } from "vitest";

describe("the glow's old switch", () => {
  afterEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it("becomes the glow toy when the app starts, once", async () => {
    localStorage.setItem("prefs.featureFlags", '{"emptyGlow":true,"screensavers":false}');
    localStorage.setItem("prefs.emptyToy", '"none"');
    const { emptyToy } = await import("./prefs");
    expect(emptyToy.get()).toBe("glow");
    expect(JSON.parse(localStorage.getItem("prefs.featureFlags")!)).toEqual({
      screensavers: false,
    });

    // Chosen as None afterwards, it stays None on the next start.
    emptyToy.set("none");
    vi.resetModules();
    const again = await import("./prefs");
    expect(again.emptyToy.get()).toBe("none");
  });

  it("leaves no toy where the glow was turned off", async () => {
    localStorage.setItem("prefs.featureFlags", '{"emptyGlow":false}');
    const { emptyToy } = await import("./prefs");
    expect(emptyToy.get()).toBe("none");
  });
});
