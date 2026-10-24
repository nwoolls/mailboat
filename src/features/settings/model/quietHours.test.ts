import { describe, expect, it } from "vitest";
import { minutesOf, timeValue } from "./quietHours";

describe("quiet hours times", () => {
  it("turns minutes into a time field's value and back", () => {
    expect(timeValue(0)).toBe("00:00");
    expect(timeValue(7 * 60 + 30)).toBe("07:30");
    expect(timeValue(22 * 60)).toBe("22:00");
    expect(minutesOf("07:30")).toBe(450);
    expect(minutesOf("23:59:00")).toBe(1439);
  });
  it("rejects what isn't a time", () => {
    expect(minutesOf("")).toBeNull();
    expect(minutesOf("25:00")).toBeNull();
    expect(minutesOf("7")).toBeNull();
  });
});
