import { describe, expect, it } from "vitest";
import { languageLabel, languageName, pickerLanguages, sameLanguage } from "./translate";

describe("translate languages", () => {
  it("names languages in the Mac's language", () => {
    expect(languageName("fr", "en-US")).toBe("French");
    expect(languageLabel("de", "en-US")).toBe("German (de)");
    expect(languageName("fr", "de")).toBe("Französisch");
  });

  it("treats regional variants as one language", () => {
    expect(sameLanguage("en-US", "en")).toBe(true);
    expect(sameLanguage("pt-PT", "es")).toBe(false);
  });

  it("offers each language once, by name, keeping Traditional Chinese apart", () => {
    const list = pickerLanguages(["fr", "fr-CA", "en-GB", "en", "zh", "zh-TW", "zh-HK"], "en-US");
    expect(list.map((l) => l.code)).toEqual(["zh", "zh-TW", "en", "fr"]);
  });

  it("falls back to common languages without Apple's list", () => {
    expect(pickerLanguages([], "en-US").length).toBeGreaterThan(20);
  });
});
