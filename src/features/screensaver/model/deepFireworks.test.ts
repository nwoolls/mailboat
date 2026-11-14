import { describe, expect, it } from "vitest";
import { sparkChar, sparkLight } from "./deepFireworks";

describe("a spark in the Toybox's styles", () => {
  it("starts white-hot, cools to its color, and fades as it burns out", () => {
    const fresh = sparkLight(2, 2, 0);
    expect(fresh.cool).toBe(0);
    expect(fresh.fade).toBe(1);
    const old = sparkLight(0.4, 2, 0);
    expect(old.cool).toBe(1);
    expect(old.fade).toBeLessThan(fresh.fade);
    expect(sparkLight(0, 2, 0).fade).toBe(0);
  });

  it("is dimmer far away", () => {
    expect(sparkLight(1, 2, 1).fade).toBeLessThan(sparkLight(1, 2, 0).fade);
  });

  it("shrinks in ASCII as it ages: a star, then a plus, then a dot", () => {
    expect([0.1, 0.5, 0.9].map((age) => sparkChar(age, false))).toEqual(["*", "+", "."]);
    expect(sparkChar(0.1, true)).toBe("'");
  });
});
