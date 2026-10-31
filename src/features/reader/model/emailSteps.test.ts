import { describe, expect, it } from "vitest";
import { emailStep } from "./emailSteps";

describe("emailStep", () => {
  it("goes to the next card below the top", () => {
    // The second card is at the top.
    expect(emailStep([-300, 0, 120, 400], "next")).toBe(2);
    expect(emailStep([-300, 0.5, 120], "next")).toBe(2);
  });
  it("goes back to the card above the top", () => {
    expect(emailStep([-300, 0, 120], "prev")).toBe(0);
    // Partway into a long email: back to its own top.
    expect(emailStep([-900, -200, 300], "prev")).toBe(1);
  });
  it("steps from a card still settling at the top, wherever it is", () => {
    // Card 1 was just brought to the top and sits 1.4px below it.
    expect(emailStep([-300, 1.4, 120], "next")).toBe(1);
    expect(emailStep([-300, 1.4, 120], "next", 1)).toBe(2);
    expect(emailStep([-300, -1.4, 120], "prev", 1)).toBe(0);
    expect(emailStep([-300, 0, 120], "next", 2)).toBeNull();
    expect(emailStep([-300, 0, 120], "prev", 0)).toBeNull();
  });
  it("stops at either end", () => {
    expect(emailStep([-300, -100], "next")).toBeNull();
    expect(emailStep([0, 200], "prev")).toBeNull();
    expect(emailStep([], "next")).toBeNull();
  });
});
