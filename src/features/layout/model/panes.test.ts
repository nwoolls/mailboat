import { describe, expect, it } from "vitest";
import {
  clampWidth,
  LIST_WIDTH,
  listMaxWidth,
  panelToggleFor,
  READER_MIN_WIDTH,
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
