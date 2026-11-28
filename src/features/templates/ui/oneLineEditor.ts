import { type Editor, Node, useEditor } from "@tiptap/react";
import type { EditorView } from "@tiptap/pm/view";
import { StarterKit } from "@tiptap/starter-kit";
import { useEffect, useRef } from "react";
import { oneLine } from "../model/fields";
import { fieldPositions, TemplateFieldNode } from "./fieldNode";

/** A subject's document: one paragraph, never more. */
const OneLine = Node.create({ name: "doc", topNode: true, content: "paragraph" });

/**
 * A subject line: one line of plain text and template fields, no
 * formatting. Used by the composer and the template editor. A pasted line
 * break or paragraph becomes a space, so words don't run together.
 * `onKey` and `onChange` are read through refs, so they may change between
 * renders (the editor itself is made once).
 */
export function useOneLineEditor(
  html: string,
  options: {
    className: string;
    /** A key the user of the editor handles (true: handled). */
    onKey?: (view: EditorView, event: KeyboardEvent) => boolean;
    /** Each change to the text, by typing or pasting. */
    onChange?: (editor: Editor) => void;
  },
) {
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });
  return useEditor({
    extensions: [
      OneLine,
      StarterKit.configure({
        document: false,
        blockquote: false,
        bold: false,
        bulletList: false,
        code: false,
        codeBlock: false,
        dropcursor: false,
        gapcursor: false,
        hardBreak: false,
        heading: false,
        horizontalRule: false,
        italic: false,
        link: false,
        listItem: false,
        listKeymap: false,
        orderedList: false,
        strike: false,
        trailingNode: false,
        underline: false,
      }),
      TemplateFieldNode,
    ],
    // As given: callers flatten what may have several lines (`oneLine`).
    // Spaces are kept as typed, as a text box keeps them.
    content: html,
    parseOptions: { preserveWhitespace: "full" },
    editorProps: {
      attributes: {
        class: options.className,
        "aria-label": "Subject",
        role: "textbox",
        "aria-multiline": "false",
      },
      handleKeyDown: (view, event) => latest.current.onKey?.(view, event) ?? false,
      transformPastedText: (text) => text.replace(/\s*[\r\n]+\s*/g, " "),
      transformPastedHTML: (pasted) => oneLine(pasted),
    },
    onUpdate: ({ editor, transaction }) => {
      if (transaction.docChanged) latest.current.onChange?.(editor);
    },
  });
}

/** Whether a template's field is in the editor (left empty, in a message). */
export function hasFields(editor: Editor): boolean {
  return fieldPositions(editor).length > 0;
}
