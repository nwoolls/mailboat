/// <reference types="node" />
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  feedWheel,
  GOO_REACH,
  isCoasting,
  NEW_GESTURE,
  openRest,
  releaseTo,
  SNAP_GAP,
  springStep,
  SWIPE,
  swipeActions,
  swipeLabel,
  swipePose,
} from "./swipe";

describe("swipe pose", () => {
  it("resists a little before it takes", () => {
    expect(swipePose(SWIPE.deadZone).shift).toBeLessThan(SWIPE.deadZone / 2);
  });

  it("then follows the fingers one to one, uncovering the button as one shape", () => {
    const a = swipePose(40);
    const b = swipePose(50);
    expect(b.shift - a.shift).toBeCloseTo(10);
    expect(a.budWidth).toBe(a.shift);
    expect([a.joined, a.separated]).toEqual([true, false]);
  });

  it("stops the button at its width, then the gap opens and it stands apart", () => {
    const p = swipePose(openRest());
    expect(p.budWidth).toBe(SWIPE.capsule);
    expect(p.shift - p.budWidth).toBeCloseTo(SWIPE.apart);
    expect([p.label, p.ring, p.armed]).toEqual([1, 0, false]);
    expect([p.joined, p.separated]).toEqual([false, true]);
  });

  it("keeps the ring empty just past revealing the button", () => {
    expect(swipePose(openRest() + SWIPE.ringAfter).ring).toBe(0);
    expect(swipePose(openRest() + SWIPE.ringAfter + 10).ring).toBeGreaterThan(0);
  });

  it("arms a little further on, with the ring full", () => {
    const at = openRest() + SWIPE.armAfter;
    expect(swipePose(at - 1).armed).toBe(false);
    const p = swipePose(at);
    expect([p.armed, p.ring]).toEqual([true, 1]);
  });

  it("never goes backwards as the fingers travel", () => {
    let last = swipePose(0);
    for (let d = 1; d < 400; d++) {
      const p = swipePose(d);
      expect(p.shift).toBeGreaterThanOrEqual(last.shift);
      expect(p.budWidth).toBeGreaterThanOrEqual(last.budWidth);
      last = p;
    }
  });
});

describe("release", () => {
  it("commits when armed, opens past a short swipe, else springs back", () => {
    expect(releaseTo(openRest() + SWIPE.armAfter)).toBe("commit");
    expect(releaseTo(openRest())).toBe("open");
    expect(releaseTo(20)).toBe("close");
  });

  it("puts an open row away with a small push back", () => {
    const rest = openRest();
    expect(releaseTo(rest - SWIPE.closeBack, SWIPE, rest)).toBe("close");
    expect(releaseTo(rest - 4, SWIPE, rest)).toBe("open");
    // Opening from closed still needs the same travel as before.
    expect(releaseTo(rest - SWIPE.closeBack)).toBe("open");
  });

  it("settles on its target", () => {
    let s = { x: 100, v: 0, done: false };
    for (let i = 0; i < 200 && !s.done; i++) s = springStep(s.x, s.v, 0, 1 / 60);
    expect(s).toEqual({ x: 0, v: 0, done: true });
  });
});

describe("reading the trackpad", () => {
  it("locks to sideways or scrolling on the first clear move", () => {
    expect(feedWheel(NEW_GESTURE, 6, 1).axis).toBe("x");
    const scroll = feedWheel(NEW_GESTURE, 2, 8);
    expect(scroll.axis).toBe("y");
    expect(feedWheel(scroll, 30, 0).dx).toBe(0);
  });

  it("adds up sideways travel until coasting starts", () => {
    let g = NEW_GESTURE;
    for (const d of [4, 9, 12, 7, 11]) g = feedWheel(g, d, 0);
    expect([g.dx, g.released]).toEqual([43, false]);
    for (const d of [10, 9, 8.2, 7.5]) g = feedWheel(g, d, 0);
    expect(g.released).toBe(true);
    const after = feedWheel(g, 7, 0);
    expect(after.dx).toBe(g.dx);
  });

  it("keeps following a smoothly slowing hand when macOS reports the lift", () => {
    let g = NEW_GESTURE;
    for (const d of [12, 10, 9, 8.2, 7.5, 6.9]) g = feedWheel(g, d, 0, false);
    expect(g.released).toBe(false);
    expect(g.dx).toBeCloseTo(53.6);
  });

  it("tells coasting from a hand slowing unevenly", () => {
    expect(isCoasting([20, 18, 16.5, 15])).toBe(true);
    expect(isCoasting([20, 12, 11, 4])).toBe(false);
    expect(isCoasting([5, 6, 5, 4])).toBe(false);
  });
});

describe("what each side does", () => {
  it("archives from the Inbox, moves back to it from Trash, trashes elsewhere", () => {
    const inbox = { unread: true, inInbox: true, inTrash: false, starred: false, inSpam: false };
    expect(swipeActions(inbox)).toEqual({
      left: { kind: "archive", archived: true },
      right: { kind: "read", read: true },
    });
    expect(swipeActions({ ...inbox, inInbox: false }).left).toEqual({
      kind: "trash",
      trashed: true,
    });
    expect(swipeActions({ ...inbox, inInbox: false, inTrash: true }).left).toEqual({
      kind: "archive",
      archived: false,
    });
    expect(swipeActions({ ...inbox, unread: false }).right).toEqual({ kind: "read", read: false });
  });

  it("does what each side was set to, toggling like its key", () => {
    const row = { unread: false, inInbox: true, inTrash: true, starred: true, inSpam: true };
    expect(swipeActions(row, { swipeLeft: "star", swipeRight: "none" })).toEqual({
      left: { kind: "star", starred: false },
      right: null,
    });
    expect(swipeActions(row, { swipeLeft: "trash", swipeRight: "spam" })).toEqual({
      left: { kind: "trash", trashed: false },
      right: { kind: "spam", spam: false },
    });
  });
});

it("labels each button in a word", () => {
  expect(swipeLabel({ kind: "archive", archived: true })).toBe("Archive");
  expect(swipeLabel({ kind: "trash", trashed: true })).toBe("Trash");
  expect(swipeLabel({ kind: "read", read: false })).toBe("Unread");
  expect(swipeLabel({ kind: "spam", spam: false })).toBe("Not spam");
  expect(swipeLabel({ kind: "star", starred: true })).toBe("Star");
});

describe("the button's snap as it separates", () => {
  // The real stylesheet, so this guards what the app draws. (Read from
  // disk: Vitest stubs CSS imports, `?raw` ones too, as empty.)
  const css = readFileSync(resolve(__dirname, "../../../styles/index.css"), "utf8");

  it("is read from the stylesheet", () => {
    const keyframes = snapKeyframes(css);
    expect(keyframes.length).toBeGreaterThanOrEqual(2);
    expect(keyframes[0]!.at).toBe(0);
    expect(keyframes.at(-1)!.at).toBe(1);
  });

  it("never reaches back within the goo's reach of the row", () => {
    // The snap scales the button from its outer edge, so growing past its
    // width moves its near edge toward the row. It starts the moment the
    // gap reaches SNAP_GAP; the finger may stop there.
    expect(SNAP_GAP).toBeGreaterThan(GOO_REACH);
    expect(snapGap(css)).toBeGreaterThan(GOO_REACH);
  });

  // Edits a browser would draw with the button back inside the goo's reach.
  // Each must fail the check above: by the gap it computes, or by refusing
  // CSS it can't read the way the browser does.
  const first = "transform: scaleX(0.94);";
  const opening = /0% \{\n\s*transform: scaleX\(0\.94\);\n\s*animation-timing-function: [^;]+;/;
  const bouncy =
    "0% {\n    transform: scaleX(0.94);\n    animation-timing-function: cubic-bezier(0.3, 2, 0.5, 1)";
  const broken: Record<string, string> = {
    "the old stretch toward the row": css.replace(first, "transform: scaleX(1.07);"),
    "an easing that overshoots past full width": css.replace(opening, `${bouncy};`),
    "that easing as a step's last line, without a semicolon": css.replace(opening, `${bouncy}`),
    "a second transform in a step (the last wins)": css.replace(
      first,
      `${first} transform: scaleX(1.07);`,
    ),
    "another transform function alongside": css.replace(
      first,
      "transform: translateX(-8px) scaleX(0.94);",
    ),
    "a second scale on top": css.replace(first, "transform: scaleX(0.94) scale(1.07);"),
    "a later block of the same name (the last wins)": `${css}\n@keyframes swipe-snap { 0% { transform: scaleX(1.07); } 100% { transform: scaleX(1); } }`,
    "a step behind a comment": css.replace(
      "  75% {",
      "  75% /* dip */ {\n    transform: scaleX(1.07);\n  }\n  76% {",
    ),
    // In source order 0% eases to 75% (0.94 to 0.985, under 1 however it
    // overshoots); in time order to 50% (0.94 to 1, so past it).
    "steps out of order": moveStep(css.replace(opening, `${bouncy};`), "50%", "100%"),
    "a later block under a quoted name": `${css}\n@keyframes "swipe-snap" { from { transform: scaleX(1.07); } to { transform: scaleX(1); } }`,
    "a later block under an escaped name": `${css}\n@keyframes swipe\\-snap { from { transform: scaleX(1.07); } to { transform: scaleX(1); } }`,
    "a later block under the WebKit prefix": `${css}\n@-webkit-keyframes swipe-snap { from { transform: scaleX(1.07); } to { transform: scaleX(1); } }`,
    "a second transform in capitals": css.replace(first, `${first} TRANSFORM: scaleX(1.07);`),
    "a scale property alongside the transform": css.replace(first, `${first} scale: 1.15 1;`),
    "a scale on the rule that runs it": css.replace(
      "transform-box: fill-box;",
      "transform-box: fill-box;\n  scale: 1.15 1;",
    ),
    "another rule that selects the button": `${css}\nsvg .swipe-snap { scale: 1.15 1; }`,
    "a later block with the at-rule in capitals": `${css}\n@KEYFRAMES swipe-snap { from { transform: scaleX(1.07); } to { transform: scaleX(1); } }`,
    "a scale beside an unchanged transform": css.replace(
      "transform: scaleX(1);",
      "transform: scaleX(1);\n    scale: 1.07;",
    ),
    "a rule for the rect alone": `${css}\nrect.swipe-snap { scale: 1.07; }`,
    "an invalid easing the browser drops for an overshooting one": css
      .replace("320ms ease-in-out both", "320ms cubic-bezier(0.3, 2, 0.5, 1) both")
      .replace("cubic-bezier(0.2, 0.8, 0.3, 1)", "cubic-bezier(2, 0, 0.5, 1)"),
    "a shorthand the browser drops (two fill modes)": css.replace(
      "320ms ease-in-out both;",
      "320ms ease-in-out both both;",
    ),
  };

  it("is turned off for reduced motion", () => {
    const moving = css.replace(
      "@media (prefers-reduced-motion: reduce) {\n  .swipe-snap",
      "@media (prefers-reduced-motion: no-preference) {\n  .swipe-snap",
    );
    expect(moving).not.toBe(css);
    expect(() => snapKeyframes(moving)).toThrow(/reduced-motion/);
  });

  it("keeps the 320 ms a video clip places it by", () => {
    const shorter = css.replace("swipe-snap 320ms", "swipe-snap 32ms");
    expect(shorter).not.toBe(css);
    expect(() => snapKeyframes(shorter)).toThrow(/unread animation/);
  });

  it.each(Object.entries(broken))("catches %s", (_name, sheet) => {
    expect(sheet).not.toBe(css);
    let gap: number;
    try {
      gap = snapGap(sheet);
    } catch {
      return; // refused: unreadable CSS fails the check above too
    }
    expect(gap).toBeLessThanOrEqual(GOO_REACH);
  });
});

/** The stylesheet with one of swipe-snap's steps moved to just after another. */
function moveStep(sheet: string, step: string, after: string): string {
  const at = sheet.indexOf("@keyframes swipe-snap ");
  const head = sheet.slice(0, at);
  const tail = sheet.slice(at);
  const block = new RegExp(`\\n  ${step} \\{[^}]*\\}`).exec(tail)?.[0];
  const anchor = new RegExp(`\\n  ${after} \\{[^}]*\\}`).exec(tail)?.[0];
  if (at < 0 || !block || !anchor) throw new Error(`no ${step} or ${after} step`);
  return head + tail.replace(block, "").replace(anchor, anchor + block);
}

type Bezier = [number, number, number, number];
type Keyframe = { at: number; scale: number; easing: Bezier };

const NAMED_EASINGS: Record<string, Bezier> = {
  linear: [0, 0, 1, 1],
  ease: [0.25, 0.1, 0.25, 1],
  "ease-in": [0.42, 0, 1, 1],
  "ease-out": [0, 0, 0.58, 1],
  "ease-in-out": [0.42, 0, 0.58, 1],
};

/** One easing, exactly: a keyword or a cubic-bezier. Anything else is refused. */
function easing(text: string): Bezier {
  const value = text.trim();
  const named = NAMED_EASINGS[value];
  if (named) return named;
  const bezier = /^cubic-bezier\(([^)]*)\)$/.exec(value);
  const n = bezier?.[1]!.split(",").map(Number);
  // x outside 0–1 is invalid CSS: the browser drops it and eases another way.
  if (!n || n.length !== 4 || n.some(Number.isNaN) || [n[0]!, n[2]!].some((x) => x < 0 || x > 1))
    throw new Error(`unread easing "${value}"`);
  return n as Bezier;
}

/**
 * A block's declarations, the last of each property winning, as in CSS.
 * Property names are case-insensitive; only `allowed` ones may appear, so
 * anything that could also move the button (`scale`, `translate`, …) is
 * refused, not ignored.
 */
function declarations(body: string, allowed: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of body.split(";")) {
    if (!part.trim()) continue;
    const colon = part.indexOf(":");
    const name = part.slice(0, colon).trim().toLowerCase();
    const value = part.slice(colon + 1).trim();
    if (colon < 0 || !allowed.includes(name) || value.includes("!"))
      throw new Error(`unread declaration "${part.trim()}"`);
    out.set(name, value);
  }
  return out;
}

/** The text inside the braces that open at `open`. */
function braced(sheet: string, open: number): string {
  let depth = 0;
  for (let i = open; i < sheet.length; i++) {
    if (sheet[i] === "{") depth++;
    if (sheet[i] === "}" && --depth === 0) return sheet.slice(open + 1, i);
  }
  throw new Error("unclosed block");
}

/**
 * `@keyframes swipe-snap`, read strictly: each step's offset (sorted),
 * its scaleX (the only transform allowed) and its easing to the next.
 * What this can't read as the browser would, it refuses: every mention
 * of swipe-snap in the sheet must be one of the three rules it knows.
 */
function snapKeyframes(source: string): Keyframe[] {
  // Comments out, and escapes decoded (`swipe\-snap` is the same name).
  const sheet = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/\\(.)/g, "$1");
  const mentions = [...sheet.matchAll(/swipe-snap/g)].length;

  // The keyframes, by any spelling of the at-rule or the name.
  const blocks = [
    ...sheet.matchAll(/@(?:-webkit-)?keyframes\s+(?:swipe-snap|"swipe-snap"|'swipe-snap')\s*\{/gi),
  ];
  if (blocks.length !== 1) throw new Error(`${blocks.length} @keyframes swipe-snap blocks`);

  // The one rule that runs it: exactly `swipe-snap 320ms <easing> both`.
  const rules = [...sheet.matchAll(/(?:^|\})\s*\.swipe-snap\s*\{/g)];
  if (rules.length !== 1) throw new Error(`${rules.length} top-level .swipe-snap rules`);
  const rule = declarations(braced(sheet, rules[0]!.index + rules[0]![0].length - 1), [
    "transform-box",
    "animation",
  ]);
  // 320ms: a video clip pauses the snap and places it by that length.
  const shorthand = /^swipe-snap\s+320ms\s+(.+?)\s+both$/.exec(rule.get("animation") ?? "");
  if (!shorthand) throw new Error(`unread animation "${rule.get("animation")}"`);
  const fallback = easing(shorthand[1]!);

  // Reduced motion turns it off, and that's all that rule may do.
  const reduced =
    /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{\s*\.swipe-snap\s*\{\s*animation:\s*none;?\s*\}\s*\}/.test(
      sheet,
    );
  if (!reduced) throw new Error("no reduced-motion rule turning the snap off");
  // Keyframes name, rule selector, its animation, the reduced-motion selector.
  if (mentions !== 4) throw new Error(`swipe-snap is mentioned ${mentions} times, not 4`);

  const block = braced(sheet, blocks[0]!.index + blocks[0]![0].length - 1);
  const frames = new Map<number, Keyframe>();
  for (const m of block.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const props = declarations(m[2]!, ["transform", "animation-timing-function"]);
    const transform = props.get("transform") ?? "";
    const scale = /^scaleX\(([\d.]+)\)$/.exec(transform);
    if (!scale) throw new Error(`a swipe-snap step's transform isn't one scaleX: "${transform}"`);
    const timing = props.get("animation-timing-function");
    for (const selector of m[1]!.split(",").map((x) => x.trim().toLowerCase())) {
      const at =
        selector === "from" ? 0 : selector === "to" ? 1 : Number.parseFloat(selector) / 100;
      if (!/^(from|to|[\d.]+%)$/.test(selector) || frames.has(at))
        throw new Error(`unread or repeated step "${selector}"`);
      frames.set(at, { at, scale: Number(scale[1]), easing: timing ? easing(timing) : fallback });
    }
  }
  return [...frames.values()].toSorted((a, b) => a.at - b.at);
}

/** The gap between button and row at the snap's widest, from a split at SNAP_GAP. */
function snapGap(sheet: string): number {
  const stretch = (largestScale(snapKeyframes(sheet)) - 1) * SWIPE.capsule;
  return SNAP_GAP - Math.max(0, stretch);
}

/**
 * The widest the button gets: each step eases to the next along its
 * cubic-bezier, whose progress can overshoot past 1 or below 0, so the
 * curve is sampled, not just the keyframes' own values.
 */
function largestScale(frames: Keyframe[]): number {
  let most = Math.max(...frames.map((f) => f.scale));
  for (let i = 0; i + 1 < frames.length; i++) {
    const { scale: from, easing: e } = frames[i]!;
    const to = frames[i + 1]!.scale;
    for (let k = 0; k <= 1000; k++) {
      const t = k / 1000;
      // The curve's progress at parameter t; x is monotonic in t for a
      // valid easing, so sampling t covers every moment in time.
      const y = 3 * (1 - t) ** 2 * t * e[1] + 3 * (1 - t) * t ** 2 * e[3] + t ** 3;
      most = Math.max(most, from + (to - from) * y);
    }
  }
  return most;
}
