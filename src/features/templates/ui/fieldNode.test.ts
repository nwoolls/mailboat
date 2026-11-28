import { Editor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";
import { insertHtmlAtCursor, TemplateFieldNode } from "./fieldNode";

let editor: Editor | null = null;
afterEach(() => editor?.destroy());

function make(content: string) {
  editor = new Editor({ extensions: [StarterKit, TemplateFieldNode], content });
  editor.commands.focus("end");
  return editor;
}

describe("insertHtmlAtCursor", () => {
  it("is one undo step of its own, apart from typing just before and after", () => {
    const e = make("<p>Hello</p>");
    // Typing, then the template within the history's half second, then more typing.
    e.commands.insertContent(" there");
    insertHtmlAtCursor(e, "<p>Thanks,</p><p>Alex</p>");
    e.commands.insertContent("!");
    // The first line joins the line typed into, as a paste would.
    expect(e.getText({ blockSeparator: "|" })).toBe("Hello thereThanks,|Alex!");
    e.commands.undo();
    expect(e.getText({ blockSeparator: "|" })).toBe("Hello thereThanks,|Alex");
    e.commands.undo();
    expect(e.getText({ blockSeparator: "|" })).toBe("Hello there");
  });

  it("joins the text on both sides, as a paste does", () => {
    const e = make("<p>Before after</p>");
    e.commands.setTextSelection(8);
    insertHtmlAtCursor(e, "<p>one</p><p>two</p>");
    expect(e.getText({ blockSeparator: "|" })).toBe("Before one|twoafter");
  });
});

describe("TemplateFieldNode", () => {
  it("takes only the app's own fields, not a pasted span with the same attribute", () => {
    const e = make(
      '<p><span class="template-field" data-field="a">Name</span> and <strong><span data-field="b">kept bold</span></strong></p>',
    );
    const html = e.getHTML();
    expect(html).toContain('<span data-field="a" class="template-field">Name</span>');
    expect(html).toContain("<strong>kept bold</strong>");
  });
});
