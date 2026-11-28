import { type Editor, mergeAttributes, Node } from "@tiptap/react";
import { DOMParser as PMDOMParser } from "@tiptap/pm/model";
import { closeHistory } from "@tiptap/pm/history";
import { NodeSelection } from "@tiptap/pm/state";

/**
 * A template's field in the editor: `<span data-field="<id>"
 * data-format="<format>">Name</span>`, one piece that can be bold or
 * italic like the text around it. In a template it marks where a value
 * goes; in a message it's a field left to fill in (highlighted, and Send
 * asks about it), which a click selects so typing replaces it.
 */
export const TemplateFieldNode = Node.create({
  name: "templateField",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      field: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-field") ?? "",
        renderHTML: (attrs) => ({ "data-field": attrs.field }),
      },
      format: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-format"),
        renderHTML: (attrs) => (attrs.format ? { "data-format": attrs.format } : {}),
      },
      label: {
        default: "",
        parseHTML: (el) => el.textContent ?? "",
        renderHTML: () => ({}),
      },
    };
  },

  // Only the app's own (its class, which `renderHTML` writes): a span
  // with a data-field attribute pasted from a web page stays ordinary
  // text. Before text style's own `span` rule, which would take it for
  // styling.
  parseHTML() {
    return [{ tag: "span.template-field[data-field]", priority: 1000 }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { class: "template-field" }), node.attrs.label];
  },

  renderText({ node }) {
    return node.attrs.label as string;
  },
});

export type FieldAttrs = { field: string; format: string | null; label: string };

/** Puts a field where the cursor is. */
export function insertField(editor: Editor, attrs: FieldAttrs) {
  editor.chain().focus().insertContent({ type: "templateField", attrs }).run();
}

/** Every place a field sits, with its attributes. */
export function fieldPositions(editor: Editor): { pos: number; attrs: FieldAttrs }[] {
  const out: { pos: number; attrs: FieldAttrs }[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "templateField") out.push({ pos, attrs: node.attrs as FieldAttrs });
  });
  return out;
}

/** Changes every copy of a field (a rename), or removes them all (`null`). */
export function updateFieldEverywhere(
  editor: Editor,
  field: string,
  attrs: Partial<FieldAttrs> | null,
) {
  const { tr } = editor.state;
  // Last first, so earlier positions stay right as nodes go.
  for (const { pos, attrs: was } of fieldPositions(editor).toReversed()) {
    if (was.field !== field) continue;
    if (attrs === null) tr.delete(pos, pos + 1);
    else tr.setNodeMarkup(pos, undefined, { ...was, ...attrs });
  }
  if (tr.docChanged) editor.view.dispatch(tr);
}

/** Selects the first field still waiting and shows it (Send → Go to it). */
export function selectFirstField(editor: Editor): boolean {
  const first = fieldPositions(editor)[0];
  if (!first) return false;
  const { state } = editor;
  editor.view.dispatch(
    state.tr.setSelection(NodeSelection.create(state.doc, first.pos)).scrollIntoView(),
  );
  editor.commands.focus();
  return true;
}

/**
 * Puts HTML in place of the selection as a paste would: its first
 * paragraph joins the text before the cursor and its last the text after,
 * in one step that one undo takes back. Parsed in an inert document, so
 * nothing in it loads or runs.
 */
export function insertHtmlAtCursor(editor: Editor, html: string) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const slice = PMDOMParser.fromSchema(editor.schema).parseSlice(doc.body);
  // An undo step of its own: typing just before or after it (within the
  // history's half second) would otherwise go with it.
  editor.view.dispatch(closeHistory(editor.state.tr.replaceSelection(slice).scrollIntoView()));
  editor.view.dispatch(closeHistory(editor.state.tr));
  focusWhereItWas(editor);
}

/** The field selected as a whole (a click, or the arrow keys onto it), if any. */
export function selectedField(editor: Editor): { pos: number; attrs: FieldAttrs } | null {
  const { selection } = editor.state;
  if (!(selection instanceof NodeSelection) || selection.node.type.name !== "templateField")
    return null;
  return { pos: selection.from, attrs: selection.node.attrs as FieldAttrs };
}

/**
 * Focus back in the text with the cursor where it was. Done at once, while
 * the control that had focus is still there: TipTap's own focus waits a
 * frame, by when that control is gone, and WebKit then put the cursor at
 * the start of the text.
 */
export function focusWhereItWas(editor: Editor) {
  if (editor.isDestroyed) return;
  const { from, to } = editor.state.selection;
  editor.view.focus();
  editor.chain().setTextSelection({ from, to }).run();
}
