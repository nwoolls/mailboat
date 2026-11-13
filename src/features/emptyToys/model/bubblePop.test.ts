import { describe, expect, it } from "vitest";
import {
  backOut,
  BUBBLE_DEFAULTS as T,
  burst,
  confettiColors,
  flash,
  inflate,
  jiggle,
  nextStreak,
  popShape,
  stepParticles,
} from "./bubblePop";
import { gridSheetFor } from "./bubbles";

const rng = () => 0.5;

describe("a pop", () => {
  it("squashes the bubble for a moment, then it's gone", () => {
    const early = popShape(T.squashSeconds / 2, T)!;
    expect(early.sx).toBeGreaterThan(1);
    expect(early.sy).toBeLessThan(1);
    expect(popShape(T.squashSeconds, T)).toBeNull();
  });

  it("flashes a ring that grows and fades, after the squash", () => {
    expect(flash(0, T)).toBeNull();
    const a = flash(T.squashSeconds + T.flashSeconds * 0.2, T)!;
    const b = flash(T.squashSeconds + T.flashSeconds * 0.8, T)!;
    expect(b.reach).toBeGreaterThan(a.reach);
    expect(b.alpha).toBeLessThan(a.alpha);
    expect(flash(T.squashSeconds + T.flashSeconds, T)).toBeNull();
  });

  it("throws confetti and puffs, more in a streak", () => {
    const one = burst(0, 0, 16, 0, rng, T);
    expect(one.filter((p) => p.kind === "confetti")).toHaveLength(T.confetti);
    expect(one.filter((p) => p.kind === "puff")).toHaveLength(T.puffs);
    const streaking = burst(0, 0, 16, 3, rng, T).filter((p) => p.kind === "confetti");
    expect(streaking.length).toBeGreaterThan(T.confetti);
    // Capped, however long the streak.
    expect(burst(0, 0, 16, 99, rng, T).length).toBe(burst(0, 0, 16, T.streakMax, rng, T).length);
  });

  it("lets confetti arc down under gravity and puffs rise, then go", () => {
    let ps = burst(0, 0, 16, 0, rng, T);
    const confetti = ps.find((p) => p.kind === "confetti")!;
    const puff = ps.find((p) => p.kind === "puff")!;
    const startY = puff.y;
    const v0 = confetti.vy;
    ps = stepParticles(ps, 0.1, T);
    expect(confetti.vy).toBeGreaterThan(v0);
    expect(puff.y).toBeLessThan(startY);
    for (let i = 0; i < 40; i++) ps = stepParticles(ps, 0.05, T);
    expect(ps).toHaveLength(0);
  });

  it("is in festive colors that still start from the accent", () => {
    const colors = confettiColors([80, 140, 240]);
    expect(colors[0]).toEqual([80, 140, 240]);
    expect(new Set(colors.map((c) => c.join())).size).toBe(4);
  });
});

describe("the neighbors", () => {
  it("wobble once the shock reaches them, less the farther away, not at all past the reach", () => {
    const pitch = 45;
    expect(jiggle(pitch, 0, pitch, T)).toBe(0);
    let near = 0;
    let far = 0;
    for (let s = 0; s < 0.5; s += 0.005) {
      near = Math.max(near, Math.abs(jiggle(pitch, s, pitch, T)));
      far = Math.max(far, Math.abs(jiggle(pitch * 2, s, pitch, T)));
    }
    expect(near).toBeGreaterThan(far);
    expect(far).toBeGreaterThan(0);
    expect(jiggle(pitch * (T.jiggleReach + 0.5), 0.1, pitch, T)).toBe(0);
  });
});

describe("streaks", () => {
  it("count quick pops in a row, and start over after a pause", () => {
    expect(nextStreak(2, T.streakSeconds / 2, T)).toBe(3);
    expect(nextStreak(2, T.streakSeconds * 2, T)).toBe(0);
  });
});

describe("a fresh sheet", () => {
  it("inflates from the middle out, overshooting a little", () => {
    expect(inflate(0.05, 0, T)).toBeGreaterThan(inflate(0.05, 1, T));
    let most = 0;
    for (let s = 0; s < 2; s += 0.01) most = Math.max(most, inflate(s, 0, T));
    expect(most).toBeGreaterThan(1);
    expect(inflate(5, 1, T)).toBe(1);
    expect(backOut(0)).toBe(0);
  });
});

describe("the ASCII sheet", () => {
  it("puts bubbles on cell centres, far enough apart never to overlap", () => {
    const sheet = gridSheetFor(480, 400, [], 8, 15, 0, 0);
    expect(sheet.centres.length).toBeGreaterThan(10);
    for (const c of sheet.centres) {
      expect((c.x - 4) % 8).toBe(0);
      expect((c.y - 7.5) % 15).toBe(0);
    }
    // A bubble is 5 cells by 3: any two differ by 5+ columns or 3+ rows.
    for (const a of sheet.centres)
      for (const b of sheet.centres) {
        if (a === b) continue;
        expect(Math.abs(a.x - b.x) >= 5 * 8 || Math.abs(a.y - b.y) >= 3 * 15).toBe(true);
      }
  });

  it("leaves room around the icon and words", () => {
    const icon = { x0: 200, y0: 150, x1: 260, y1: 210 };
    const sheet = gridSheetFor(480, 400, [icon], 8, 15, 0, 0);
    for (const c of sheet.centres)
      expect(c.x > icon.x0 - 8 && c.x < icon.x1 + 8 && c.y > icon.y0 && c.y < icon.y1).toBe(false);
  });
});
