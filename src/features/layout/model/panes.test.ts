import { describe, expect, it } from "vitest";
import {
  clampWidth,
  DEFAULT_LAYOUT,
  LIST_SHARE,
  LIST_WIDTH,
  listMaxWidth,
  listShareFor,
  panelToggleFor,
  parseLayout,
  parsePanels,
  DEFAULT_PANELS,
  toggledFold,
  READER_MIN_WIDTH,
  SIDEBAR_WIDTH,
  SPLITTER_WIDTH,
} from "./panes";

describe("clampWidth", () => {
  it("keeps a width inside its bounds", () => {
    expect(clampWidth(100, 180, 360)).toBe(180);
    expect(clampWidth(500, 180, 360)).toBe(360);
    expect(clampWidth(250.6, 180, 360)).toBe(251);
  });

  it("prefers the minimum when the bounds cross (window too narrow)", () => {
    expect(clampWidth(300, 260, 200)).toBe(260);
  });
});

describe("listMaxWidth", () => {
  it("leaves the splitter and the reader's minimum width", () => {
    expect(listMaxWidth(1000)).toBe(1000 - SPLITTER_WIDTH - READER_MIN_WIDTH);
  });

  it("never goes below the list's own minimum", () => {
    expect(listMaxWidth(400)).toBe(LIST_WIDTH.min);
  });
});

describe("listShareFor", () => {
  it("turns a dragged list width into its share of the panes", () => {
    expect(listShareFor(400, 1000)).toBeCloseTo(0.4);
  });

  it("keeps room for the reader and the list's minimum", () => {
    expect(listShareFor(990, 1000)).toBeCloseTo((1000 - SPLITTER_WIDTH - READER_MIN_WIDTH) / 1000);
    expect(listShareFor(100, 1000)).toBeCloseTo(LIST_WIDTH.min / 1000);
  });

  it("falls back to the default before the panes have a size", () => {
    expect(listShareFor(400, 0)).toBe(LIST_SHARE.initial);
  });
});

describe("parseLayout", () => {
  it("reads a saved layout", () => {
    expect(parseLayout('{"sidebarWidth":260,"listShare":0.45}')).toEqual({
      sidebarWidth: 260,
      listShare: 0.45,
    });
  });

  it("keeps saved values in bounds", () => {
    expect(parseLayout('{"sidebarWidth":5000,"listShare":3}')).toEqual({
      sidebarWidth: SIDEBAR_WIDTH.max,
      listShare: LIST_SHARE.max,
    });
  });

  it("falls back to the default for nothing, junk or missing values", () => {
    expect(parseLayout(null)).toEqual(DEFAULT_LAYOUT);
    expect(parseLayout("not json")).toEqual(DEFAULT_LAYOUT);
    expect(parseLayout('{"sidebarWidth":"wide"}')).toEqual(DEFAULT_LAYOUT);
  });
});

/** A ⌃⌘ key press, with modifiers overridable. */
function key(code: string, mods: Partial<KeyboardEvent> = {}) {
  return { code, metaKey: true, ctrlKey: true, altKey: false, shiftKey: false, ...mods };
}

describe("panelToggleFor", () => {
  it("maps ⌃⌘S to the sidebar and ⌃⌘R to the reader", () => {
    expect(panelToggleFor(key("KeyS"))).toBe("sidebar");
    expect(panelToggleFor(key("KeyR"))).toBe("reader");
  });

  it("ignores other keys and modifier combinations", () => {
    expect(panelToggleFor(key("KeyB"))).toBeNull();
    expect(panelToggleFor(key("KeyS", { ctrlKey: false }))).toBeNull();
    expect(panelToggleFor(key("KeyR", { metaKey: false }))).toBeNull();
    expect(panelToggleFor(key("KeyS", { shiftKey: true }))).toBeNull();
  });
});

describe("parsePanels", () => {
  it("defaults when nothing or nonsense was saved", () => {
    expect(parsePanels(null)).toEqual(DEFAULT_PANELS);
    expect(parsePanels("{oops")).toEqual(DEFAULT_PANELS);
    expect(parsePanels('{"sidebarOpen":"no","folds":[3,"1:labels"]}')).toEqual({
      ...DEFAULT_PANELS,
      folds: ["1:labels"],
    });
  });
  it("keeps what was saved", () => {
    expect(
      parsePanels('{"sidebarOpen":false,"readerOpen":false,"folds":["2:collapsed","2:more"]}'),
    ).toEqual({ sidebarOpen: false, readerOpen: false, folds: ["2:collapsed", "2:more"] });
  });
  it("flips one fold", () => {
    expect(toggledFold(["a"], "b")).toEqual(["a", "b"]);
    expect(toggledFold(["a", "b"], "a")).toEqual(["b"]);
  });
});
