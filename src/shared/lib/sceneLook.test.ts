import { describe, expect, it } from "vitest";
import { claimLook, releaseLook, setLook } from "./sceneLook";

const look = (el: HTMLElement) =>
  el.hasAttribute("data-scene-night") ? "night" : el.hasAttribute("data-scene-day") ? "day" : null;

describe("scene looks", () => {
  it("sets and clears a scene's own look", () => {
    const el = document.createElement("div");
    const sky = {};
    claimLook(sky, [el, null], "day");
    expect(look(el)).toBe("day");
    setLook(sky, [el], "night");
    expect(look(el)).toBe("night");
    releaseLook(sky, [el]);
    expect(look(el)).toBe(null);
  });

  it("a scene leaving after the next one took over leaves the new look", () => {
    const title = document.createElement("h2");
    const oldSky = {};
    const newSky = {};
    claimLook(oldSky, [title], "night");
    claimLook(newSky, [title], "night");
    releaseLook(oldSky, [title]);
    expect(look(title)).toBe("night");
    // Nor can the leaving one's last frames change it.
    setLook(oldSky, [title], "day");
    expect(look(title)).toBe("night");
    releaseLook(newSky, [title]);
    expect(look(title)).toBe(null);
  });

  it("a scene sets the look once the one before has let go", () => {
    const title = document.createElement("h2");
    const sky = {};
    const screensaver = {};
    claimLook(sky, [title], "night");
    setLook(screensaver, [title], "night");
    expect(look(title)).toBe("night");
    releaseLook(sky, [title]);
    expect(look(title)).toBe(null);
    setLook(screensaver, [title], "night");
    expect(look(title)).toBe("night");
  });
});
