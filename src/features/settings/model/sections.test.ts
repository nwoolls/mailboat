import { describe, expect, it } from "vitest";
import { SETTINGS_SECTIONS, sectionFor } from "./sections";

describe("settings sections", () => {
  it("keeps the roadmap's order", () => {
    expect(SETTINGS_SECTIONS.map((s) => s.id)).toEqual([
      "general",
      "accounts",
      "notifications",
      "appearance",
      "list",
      "viewing",
      "composing",
      "ai",
      "signatures",
      "rules",
      "vacation",
      "keyboard",
      "toybox",
      "privacy",
      "advanced",
    ]);
  });

  it("finds a section by id", () => {
    expect(sectionFor("appearance").label).toBe("Appearance");
  });
});
