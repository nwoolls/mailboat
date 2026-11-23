import { describe, expect, it } from "vitest";
import { EDGE_PX, firstOutlined, readerKeyFor, readerStep, revealBy } from "./readerKeys";

const key = (k: string, mods: Partial<KeyboardEvent> = {}) => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

describe("readerKeyFor", () => {
  it("maps the arrows, Enter and Esc", () => {
    expect(readerKeyFor(key("ArrowDown"), false)).toBe("down");
    expect(readerKeyFor(key("ArrowUp"), false)).toBe("up");
    expect(readerKeyFor(key("ArrowRight"), false)).toBe("open");
    expect(readerKeyFor(key("Enter"), false)).toBe("open");
    expect(readerKeyFor(key("ArrowLeft"), false)).toBe("close");
    expect(readerKeyFor(key("Escape"), false)).toBe("leave");
  });

  it("leaves typing, modifiers and other keys alone", () => {
    expect(readerKeyFor(key("ArrowDown"), true)).toBeNull();
    expect(readerKeyFor(key("ArrowDown", { shiftKey: true }), false)).toBeNull();
    expect(readerKeyFor(key("ArrowDown", { metaKey: true }), false)).toBeNull();
    expect(readerKeyFor(key("j"), false)).toBeNull();
  });
});

describe("readerStep", () => {
  const view = 400;
  const cards = [
    { top: 0, bottom: 40, open: false },
    { top: 48, bottom: 1000, open: true },
    { top: 1008, bottom: 1048, open: false },
  ];

  it("↓ reads down a long email before moving on", () => {
    expect(readerStep("down", cards, 1, view)).toEqual({ kind: "scroll", by: 100 });
  });

  it("↓ stops at the end of a long email, then outlines the next", () => {
    const nearEnd = cards.map((c) => ({ ...c, top: c.top - 560, bottom: c.bottom - 560 }));
    expect(readerStep("down", nearEnd, 1, view)).toEqual({ kind: "scroll", by: 40 + EDGE_PX });
    const atEnd = cards.map((c) => ({ ...c, top: c.top - 608, bottom: c.bottom - 608 }));
    expect(readerStep("down", atEnd, 1, view)).toEqual({ kind: "move", to: 2, by: 40 + EDGE_PX });
  });

  it("↓ from a short email outlines the next, bringing its top into view", () => {
    expect(readerStep("down", cards, 0, view)).toEqual({ kind: "move", to: 1, by: 48 - EDGE_PX });
  });

  it("↑ reads up a long email, then shows the previous one's end", () => {
    const scrolled = cards.map((c) => ({ ...c, top: c.top - 300, bottom: c.bottom - 300 }));
    expect(readerStep("up", scrolled, 1, view)).toEqual({ kind: "scroll", by: -100 });
    const atTop = cards.map((c) => ({ ...c, top: c.top - 48, bottom: c.bottom - 48 }));
    expect(readerStep("up", atTop, 1, view)).toEqual({ kind: "move", to: 0, by: -48 - EDGE_PX });
  });

  it("keeps scrolling past either end", () => {
    expect(readerStep("up", cards, 0, view)).toEqual({ kind: "scroll", by: -100 });
    const last = [{ top: 0, bottom: 40, open: false }];
    expect(readerStep("down", last, 0, view)).toEqual({ kind: "scroll", by: 100 });
  });

  it("opens, closes, and goes back to the list", () => {
    expect(readerStep("open", cards, 0, view)).toEqual({ kind: "open" });
    expect(readerStep("open", cards, 1, view)).toBeNull();
    expect(readerStep("close", cards, 1, view)).toEqual({ kind: "close" });
    expect(readerStep("close", cards, 0, view)).toEqual({ kind: "leave" });
    expect(readerStep("leave", cards, 1, view)).toEqual({ kind: "leave" });
  });
});

describe("revealBy", () => {
  it("doesn't move for a card in view", () => {
    expect(revealBy({ top: 10, bottom: 100, open: true }, 400, "start")).toBe(0);
  });

  it("moves the least for a card that fits", () => {
    expect(revealBy({ top: 380, bottom: 420, open: false }, 400, "start")).toBe(20 + EDGE_PX);
    expect(revealBy({ top: -30, bottom: 10, open: false }, 400, "end")).toBe(-30 - EDGE_PX);
  });

  it("shows a tall card's top going down and its end going up", () => {
    const tall = { top: 300, bottom: 1300, open: true };
    expect(revealBy(tall, 400, "start")).toBe(300 - EDGE_PX);
    expect(revealBy(tall, 400, "end")).toBe(900 + EDGE_PX);
  });
});

describe("firstOutlined", () => {
  const cards = [
    { top: -200, bottom: -100, open: false },
    { top: -90, bottom: 300, open: true },
  ];
  it("outlines the email it landed on", () => {
    expect(firstOutlined(cards, 400, 0)).toBe(0);
  });
  it("else the first one showing", () => {
    expect(firstOutlined(cards, 400, -1)).toBe(1);
  });
});
