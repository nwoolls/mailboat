import { expect, it } from "vitest";
import { goToView, SHORTCUTS } from "./shortcuts";

it("maps Gmail's go-to letters to views", () => {
  expect(goToView("i")).toEqual({ kind: "system", label: "inbox" });
  expect(goToView("e")).toEqual({ kind: "archive" });
  expect(goToView("q")).toBeNull();
});

it("lists every go-to letter in the help", () => {
  const listed = SHORTCUTS.flatMap((g) => g.keys.map(([k]) => k));
  for (const letter of ["i", "s", "t", "d", "a", "e"]) expect(listed).toContain(`g then ${letter}`);
});
