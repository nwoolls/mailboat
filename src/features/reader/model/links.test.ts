import { describe, expect, it } from "vitest";
import { externalLink } from "./links";

describe("externalLink", () => {
  it("allows web and mail links", () => {
    expect(externalLink("https://vendor.com/pay")).toBe("https://vendor.com/pay");
    expect(externalLink("mailto:a@b.com")).toBe("mailto:a@b.com");
  });
  it("rejects scripts, files, relative and empty links", () => {
    expect(externalLink("javascript:alert(1)")).toBeNull();
    expect(externalLink("file:///etc/passwd")).toBeNull();
    expect(externalLink("/relative")).toBeNull();
    expect(externalLink(null)).toBeNull();
  });
});
