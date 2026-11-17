import { Schema } from "@tiptap/pm/model";
import { AllSelection, EditorState, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { describe, expect, it } from "vitest";
import { clickCaretGuard } from "./RichEditor";

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "text*", toDOM: () => ["p", 0] },
    text: {},
  },
});

/**
 * Just enough of a ProseMirror view for the guard: its state, whether it has
 * focus, where a point falls (`at`, the document position any point maps
 * to), and the transactions it was sent.
 */
function fakeView(o: {
  focused?: boolean;
  selection?: (s: EditorState) => EditorState["selection"];
}) {
  let state = EditorState.create({
    schema,
    doc: schema.node("doc", null, [schema.node("paragraph", null, [schema.text("Back Monday")])]),
  });
  // The race leaves the old cursor at the start.
  state = state.apply(
    state.tr.setSelection(o.selection?.(state) ?? TextSelection.create(state.doc, 1)),
  );
  const sent: EditorState["selection"][] = [];
  const view = {
    dom: document.createElement("div"),
    get state() {
      return state;
    },
    hasFocus: () => o.focused ?? false,
    posAtCoords: () => ({ pos: 12, inside: -1 }),
    dispatch(tr: ReturnType<EditorState["tr"]["setSelection"]>) {
      state = state.apply(tr);
      sent.push(state.selection);
    },
  };
  return { view: view as unknown as EditorView, sent };
}

const mouse = (type: string, x: number, y: number, extra: MouseEventInit = {}) =>
  new MouseEvent(type, { clientX: x, clientY: y, button: 0, detail: 1, ...extra });

/** A press at (x, y), the pointer moving through `path`, and a release at the end. */
function gesture(view: EditorView, path: [number, number][], extra: MouseEventInit = {}) {
  const guard = clickCaretGuard();
  const [start] = path;
  guard.mousedown(view, mouse("mousedown", start![0], start![1], extra));
  for (const [x, y] of path.slice(1)) window.dispatchEvent(mouse("mousemove", x, y));
  const [x, y] = path.at(-1)!;
  const up = mouse("mouseup", x, y, extra);
  guard.mouseup(view, up);
  window.dispatchEvent(up);
}

describe("putting the cursor where a click focused the editor", () => {
  it("moves the cursor the race left at the start to where the click was", () => {
    const { view, sent } = fakeView({});
    gesture(view, [[100, 50]]);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.from).toBe(12);
  });

  it("leaves a drag alone, even one that comes back to where it started", () => {
    // Review: across table cells and back, ProseMirror had selected the cell.
    const { view, sent } = fakeView({});
    gesture(view, [
      [100, 50],
      [180, 50],
      [100, 50],
    ]);
    expect(sent).toEqual([]);
  });

  it("allows a press that wobbles within a few pixels", () => {
    const { view, sent } = fakeView({});
    gesture(view, [
      [100, 50],
      [102, 51],
      [100, 50],
    ]);
    expect(sent).toHaveLength(1);
  });

  it("leaves anything but a cursor alone: a range, or a whole selection", () => {
    for (const selection of [
      (s: EditorState) => TextSelection.create(s.doc, 1, 5),
      (s: EditorState) => new AllSelection(s.doc),
    ]) {
      const { view, sent } = fakeView({ selection });
      gesture(view, [[100, 50]]);
      expect(sent).toEqual([]);
    }
  });

  it("leaves a click in an editor that already has focus, or with a key held, alone", () => {
    for (const [focused, extra] of [
      [true, {}],
      [false, { shiftKey: true }],
      [false, { detail: 2 }],
    ] as const) {
      const { view, sent } = fakeView({ focused });
      gesture(view, [[100, 50]], extra);
      expect(sent).toEqual([]);
    }
  });

  it("forgets a press released outside the editor", () => {
    const { view, sent } = fakeView({});
    const guard = clickCaretGuard();
    guard.mousedown(view, mouse("mousedown", 100, 50));
    // Released elsewhere: only the window hears it.
    window.dispatchEvent(mouse("mouseup", 100, 50));
    guard.mouseup(view, mouse("mouseup", 100, 50));
    expect(sent).toEqual([]);
  });
});
