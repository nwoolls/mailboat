import { describe, expect, it } from "vitest";
import { editorWouldSimplify, signatureToSave } from "./signature";

describe("signatures", () => {
  it("warns about tables the editor would flatten", () => {
    expect(editorWouldSimplify('<TABLE border="0"><tr><td>Jordan</td></tr></TABLE>')).toBe(true);
    expect(
      editorWouldSimplify("<div>Jordan<br><a href='https://x.example'>x.example</a></div>"),
    ).toBe(false);
    expect(editorWouldSimplify("<p>tablet</p>")).toBe(false);
    expect(editorWouldSimplify(null)).toBe(false);
  });

  it("saves an emptied editor as no signature, but keeps an image-only one", () => {
    expect(signatureToSave("<p></p>", "  ")).toBe("");
    expect(signatureToSave('<p><img src="https://x.example/logo.png"></p>', "")).toBe(
      '<p><img src="https://x.example/logo.png"></p>',
    );
    expect(signatureToSave("<p>Jordan</p>", "Jordan")).toBe("<p>Jordan</p>");
  });
});
