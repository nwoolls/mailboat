import { expect, it } from "vitest";
import { linkHref } from "./links";

it("adds https:// or mailto: to typed links, and keeps full ones", () => {
  expect(linkHref(" docs.example.com/plan ")).toBe("https://docs.example.com/plan");
  expect(linkHref("jane@example.com")).toBe("mailto:jane@example.com");
  expect(linkHref("http://x.example")).toBe("http://x.example");
  expect(linkHref("mailto:a@b.example")).toBe("mailto:a@b.example");
});
