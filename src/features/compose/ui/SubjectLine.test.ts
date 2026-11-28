import { Editor } from "@tiptap/react";
import { afterEach, describe, expect, it } from "vitest";
import { ONE_LINE_EXTENSIONS, ONE_LINE_PARSE } from "../../templates/ui/oneLineEditor";
import { subjectContent } from "./SubjectLine";

const editors: Editor[] = [];
afterEach(() => {
  for (const e of editors.splice(0)) e.destroy();
});

function load(content: string) {
  const e = new Editor({ extensions: ONE_LINE_EXTENSIONS, content, parseOptions: ONE_LINE_PARSE });
  editors.push(e);
  return e;
}

const field = '<span class="template-field" data-field="n">Name</span>';
const text = (e: Editor) =>
  e.getText({ textSerializers: { templateField: ({ node }) => `[${node.attrs.label}]` } });

describe("subjectContent", () => {
  it("reloads a line with a field exactly, spaces beside the field kept", () => {
    // As when a minimized card is restored: the line comes back from its own HTML.
    const first = load(`<p>Project   ${field}  </p>`);
    expect(text(first)).toBe("Project   [Name]  ");
    const again = load(subjectContent(text(first), first.getHTML()));
    expect(text(again)).toBe("Project   [Name]  ");
    expect(again.getHTML()).toBe(first.getHTML());
  });

  it("keeps a plain subject's spaces, and puts a line break on the line as a space", () => {
    expect(text(load(subjectContent("  Two   spaces ", undefined)))).toBe("  Two   spaces ");
    expect(text(load(subjectContent("First\r\nSecond", undefined)))).toBe("First Second");
  });

  it("loads plain text as text, never as markup", () => {
    const e = load(subjectContent("<b>Not bold</b> & more", undefined));
    expect(text(e)).toBe("<b>Not bold</b> & more");
  });
});
