import { expect, it } from "vitest";
import { isEditable } from "./editable";

it("tells fields from everything else", () => {
  expect(isEditable(document.createElement("input"))).toBe(true);
  expect(isEditable(document.createElement("textarea"))).toBe(true);
  expect(isEditable(document.createElement("select"))).toBe(true);
  expect(isEditable(document.createElement("button"))).toBe(false);
  expect(isEditable(null)).toBe(false);
});
