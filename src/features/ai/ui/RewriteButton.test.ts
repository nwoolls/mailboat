import { Editor } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";
import { applyRewrite } from "./RewriteButton";

let editor: Editor;
afterEach(() => editor.destroy());

function open(html: string) {
  editor = new Editor({ extensions: [StarterKit], content: html });
  return editor;
}

/** The document positions of `text`'s first appearance. */
function find(e: Editor, text: string) {
  let at = -1;
  e.state.doc.descendants((node, pos) => {
    if (at < 0 && node.isText && node.text?.includes(text)) at = pos + node.text.indexOf(text);
  });
  return { from: at, to: at + text.length, original: text };
}

describe("applyRewrite", () => {
  it("swaps words mid-sentence without breaking the paragraph, and selects them", () => {
    const e = open("<p>Hi Sam, send the report by fri ok. Thanks!</p>");
    const at = find(e, "send the report by fri ok");
    const done = applyRewrite(e, at, {
      text: "could you send the report by Friday?",
      html: "<p>could you send the report by Friday?</p>",
    });
    expect(done).toBe(true);
    expect(e.getHTML()).toBe("<p>Hi Sam, could you send the report by Friday?. Thanks!</p>");
    const { from, to } = e.state.selection;
    expect(e.state.doc.textBetween(from, to)).toBe("could you send the report by Friday?");
  });

  it("replaces paragraphs with paragraphs, in one undo step", () => {
    const e = open("<p>First bit.</p><p>Second bit.</p><p>Keep me.</p>");
    const start = find(e, "First bit.");
    const end = find(e, "Second bit.");
    const at = { from: start.from, to: end.to, original: "First bit.\n\nSecond bit." };
    applyRewrite(e, at, { text: "One.\n\nTwo.", html: "<p>One.</p><p>Two.</p>" });
    expect(e.getHTML()).toBe("<p>One.</p><p>Two.</p><p>Keep me.</p>");
    e.commands.undo();
    expect(e.getHTML()).toBe("<p>First bit.</p><p>Second bit.</p><p>Keep me.</p>");
  });

  it("leaves text that was edited meanwhile alone", () => {
    const e = open("<p>Hello there friend</p>");
    const at = find(e, "there");
    e.commands.insertContentAt(at.from, "over ");
    expect(applyRewrite(e, at, { text: "here", html: "<p>here</p>" })).toBe(false);
    expect(e.getHTML()).toBe("<p>Hello over there friend</p>");
  });
});
