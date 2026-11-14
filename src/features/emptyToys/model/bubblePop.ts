import type { Rgb } from "../../screensaver/model/palettes";

/**
 * Bubble wrap's pops, made joyful (owner, 2026-11-13: "an actual joyful
 * animation for pops, not just a switch from unpopped to popped"). Pure
 * timing and particles here, drawn in chunky pixel art or ASCII art by
 * `ui/BubbleWrap.tsx`:
 *
 * - the bubble squashes for a moment under the click, then bursts: a bright
 *   ring flashes outward and the bubble's skin snaps away;
 * - confetti flies out, arcing under gravity and tumbling, in the accent
 *   color, two neighboring hues and a warm spark; a few puffs of air rise;
 * - nearby bubbles wobble outward with the shock, less the farther away;
 * - the crumpled film drops flat with a small bounce;
 * - popping quickly in a row (a streak) makes each pop a little bigger;
 * - the last pop sends confetti up from every film, the old sheet blows
 *   away, and a fresh one inflates bubble by bubble from the middle out.
 *
 * The numbers are in `BubbleTuning`, for the playground; the app uses
 * `BUBBLE_DEFAULTS`.
 */
export type BubbleTuning = {
  /** Screen pixels per block, in pixel art. */
  pixel: number;
  /** How long the bubble squashes before it bursts, and how long the flash ring takes, in seconds. */
  squashSeconds: number;
  flashSeconds: number;
  /** Confetti per pop, how fast it flies out (px/s), and gravity (px/s²). */
  confetti: number;
  speed: number;
  gravity: number;
  /** How long confetti lasts, in seconds. */
  confettiSeconds: number;
  /** Puffs of air per pop. */
  puffs: number;
  /** How much neighbors wobble (share of their size), and how far it reaches (in bubble spacings). */
  jiggle: number;
  jiggleReach: number;
  /** How much bigger each pop in a streak gets, up to `streakMax` steps. */
  streakBoost: number;
  streakMax: number;
  /** Seconds between pops that still count as a streak. */
  streakSeconds: number;
  /** The soft glow around a burst (0 is none). */
  bloom: number;
  /** The finale: seconds before the fresh sheet inflates, and how long its ripple takes to cross. */
  refillSeconds: number;
  inflateSeconds: number;
};

export const BUBBLE_DEFAULTS: BubbleTuning = {
  pixel: 5,
  squashSeconds: 0.05,
  flashSeconds: 0.22,
  confetti: 10,
  speed: 260,
  gravity: 900,
  confettiSeconds: 0.9,
  puffs: 3,
  jiggle: 0.14,
  jiggleReach: 2.5,
  streakBoost: 0.18,
  streakMax: 5,
  streakSeconds: 0.45,
  bloom: 0.5,
  refillSeconds: 1.1,
  inflateSeconds: 0.7,
};

let tuning: BubbleTuning = BUBBLE_DEFAULTS;

/** What bubble wrap uses; the defaults unless the playground changed it. */
export function bubbleTuning(): BubbleTuning {
  return tuning;
}

/** For the playground only. */
export function setBubbleTuning(next: BubbleTuning) {
  tuning = next;
}

/** A bit of a burst. `tone` picks its color (`confettiColors`); air puffs rise and fade. */
export type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  kind: "confetti" | "puff";
  tone: number;
  /** Tumbling: which way up the confetti is now, 0–1. */
  spin: number;
  spinRate: number;
};

/**
 * A burst's confetti and puffs, from a bubble at (x, y) of `radius`.
 * `streak` (0 up) makes it bigger; `rng` gives 0–1.
 */
export function burst(
  x: number,
  y: number,
  radius: number,
  streak: number,
  rng: () => number,
  t: BubbleTuning,
): Particle[] {
  const boost = 1 + Math.min(streak, t.streakMax) * t.streakBoost;
  const out: Particle[] = [];
  const n = Math.round(t.confetti * boost);
  for (let k = 0; k < n; k++) {
    // Spread all round, but thrown a little upward, as from a pop.
    const a = (k / n) * Math.PI * 2 + rng() * 0.6;
    const v = t.speed * boost * (0.55 + rng() * 0.6);
    out.push({
      x: x + Math.cos(a) * radius * 0.6,
      y: y + Math.sin(a) * radius * 0.6,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v - t.speed * 0.5,
      age: 0,
      life: t.confettiSeconds * (0.7 + rng() * 0.5),
      kind: "confetti",
      tone: k % 4,
      spin: rng(),
      spinRate: 3 + rng() * 6,
    });
  }
  for (let k = 0; k < t.puffs; k++)
    out.push({
      x: x + (rng() - 0.5) * radius,
      y: y - radius * 0.3,
      vx: (rng() - 0.5) * 30,
      vy: -40 - rng() * 30,
      age: 0,
      life: 0.6 + rng() * 0.3,
      kind: "puff",
      tone: 0,
      spin: 0,
      spinRate: 0,
    });
  return out;
}

/** Moves particles on by `dt`, dropping those whose time is up. */
export function stepParticles(ps: Particle[], dt: number, t: BubbleTuning): Particle[] {
  const kept: Particle[] = [];
  for (const p of ps) {
    p.age += dt;
    if (p.age >= p.life) continue;
    if (p.kind === "confetti") {
      p.vy += t.gravity * dt;
      // A little air drag, so it floats down at the end.
      p.vx *= Math.exp(-dt * 1.6);
      p.vy *= Math.exp(-dt * 0.8);
      p.spin = (p.spin + p.spinRate * dt) % 1;
    } else {
      p.vx *= Math.exp(-dt * 2);
      p.vy *= Math.exp(-dt * 1.2);
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    kept.push(p);
  }
  return kept;
}

/**
 * How a popping bubble looks `age` seconds after the click: it squashes
 * (wider, flatter) for `squashSeconds`, then it's gone (`null`), leaving
 * the flash and the film.
 */
export function popShape(age: number, t: BubbleTuning): { sx: number; sy: number } | null {
  if (age >= t.squashSeconds) return null;
  const k = age / Math.max(0.001, t.squashSeconds);
  return { sx: 1 + 0.14 * k, sy: 1 - 0.18 * k };
}

/** The flash ring after the burst: its radius (as a share of the bubble's) and brightness, or null once done. */
export function flash(age: number, t: BubbleTuning): { reach: number; alpha: number } | null {
  const k = (age - t.squashSeconds) / Math.max(0.001, t.flashSeconds);
  if (k < 0 || k >= 1) return null;
  const ease = 1 - (1 - k) ** 3;
  return { reach: 0.8 + ease * 0.9, alpha: 1 - k };
}

/**
 * The film settling after the burst: 0 (not yet) to 1 (lying flat), with
 * a small overshoot on the way, as it drops into place.
 */
export function filmSettle(age: number, t: BubbleTuning): number {
  return backOut((age - t.squashSeconds) / 0.3);
}

/** Eases from 0 to 1 with a small overshoot past 1 (clamped outside 0–1). */
export function backOut(k: number): number {
  if (k <= 0) return 0;
  if (k >= 1) return 1;
  const c = 1.9;
  const u = k - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
}

/**
 * How much a neighbor `distance` px from a pop swells, `age` seconds after
 * it: the shock reaches it a moment later and it wobbles, dying away. As a
 * share of its size; 0 beyond `jiggleReach` spacings.
 */
export function jiggle(distance: number, age: number, pitch: number, t: BubbleTuning): number {
  const reach = t.jiggleReach * pitch;
  if (distance <= 0 || distance > reach) return 0;
  const since = age - distance / 900;
  if (since <= 0) return 0;
  const strength = t.jiggle * (1 - distance / reach);
  return strength * Math.exp(-since * 7) * Math.sin(since * 34);
}

/** How many pops in a row: one more than the last if it came quickly enough. */
export function nextStreak(streak: number, sinceLast: number, t: BubbleTuning): number {
  return sinceLast <= t.streakSeconds ? streak + 1 : 0;
}

/**
 * A fresh bubble inflating: 0 (none) to 1 (full), with a little overshoot,
 * `since` seconds after the refill began, for a bubble `fromMiddle` (0–1)
 * of the way out, so the sheet inflates from the middle out.
 */
export function inflate(since: number, fromMiddle: number, t: BubbleTuning): number {
  const start = fromMiddle * t.inflateSeconds * 0.6;
  return backOut((since - start) / (t.inflateSeconds * 0.4));
}

/**
 * The confetti's colors from the accent: the accent, a hue each side of
 * it, and a warm spark, so a burst looks festive but still belongs.
 */
export function confettiColors(accent: Rgb): Rgb[] {
  const [h, s, l] = toHsl(accent);
  const vivid = Math.max(0.55, s);
  return [
    accent,
    fromHsl((h + 40) % 360, vivid, Math.min(0.7, l + 0.05)),
    fromHsl((h + 320) % 360, vivid, Math.min(0.7, l + 0.05)),
    fromHsl(45, 0.95, 0.62),
  ];
}

function toHsl([r, g, b]: Rgb): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === rn
      ? ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60
      : max === gn
        ? ((bn - rn) / d + 2) * 60
        : ((rn - gn) / d + 4) * 60;
  return [h, s, l];
}

function fromHsl(h: number, s: number, l: number): Rgb {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    const u = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    const v =
      u < 1 / 6
        ? p + (q - p) * 6 * u
        : u < 1 / 2
          ? q
          : u < 2 / 3
            ? p + (q - p) * (2 / 3 - u) * 6
            : p;
    return Math.round(v * 255);
  };
  const hn = h / 360;
  return [channel(hn + 1 / 3), channel(hn), channel(hn - 1 / 3)];
}
