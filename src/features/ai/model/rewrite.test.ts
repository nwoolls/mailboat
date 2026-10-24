import { describe, expect, it } from "vitest";
import { REWRITE_STYLES, rewriteContent } from "./rewrite";

describe("rewrite", () => {
  it("puts one line back as text, so it stays inside its paragraph", () => {
    expect(
      rewriteContent({ text: "Could you send it?", html: "<p>Could you send it?</p>" }),
    ).toEqual({ type: "text", text: "Could you send it?" });
  });

  it("puts paragraphs and lists back as HTML", () => {
    const html = "<p>Hi Sam,</p><p>Thanks.</p>";
    expect(rewriteContent({ text: "Hi Sam,\n\nThanks.", html })).toBe(html);
  });

  it("offers each style once", () => {
    const styles = REWRITE_STYLES.map((s) => s.style);
    expect(new Set(styles).size).toBe(styles.length);
  });
});
