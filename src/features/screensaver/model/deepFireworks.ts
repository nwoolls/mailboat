/**
 * The fireworks screensaver in the Toybox's styles (UX Spike 5). Its motion
 * is the fireworks scene's own (`fireworks.ts`: rockets, the five shells,
 * the boat, aiming at the pointer); `ui/deepFireworksDraw.ts` draws it in
 * chunky pixel art or ASCII art with glowing light, instead of converting
 * its fine cells. The numbers are in `DeepFireworkTuning`, for the
 * playground; the app uses `DEEP_FIREWORK_DEFAULTS`.
 */
export type DeepFireworkTuning = {
  /** Pixel art's block size, in screen pixels. */
  pixel: number;
  /** The soft light round young sparks and rockets (0 is none). */
  bloom: number;
  /** A burst's flash (0 is none). */
  flash: number;
  /** The smoke a burst leaves (0 is none). */
  smoke: number;
  /** How long a trail is drawn, as a share of the scene's own. */
  trail: number;
};

export const DEEP_FIREWORK_DEFAULTS: DeepFireworkTuning = {
  pixel: 4,
  bloom: 0.6,
  flash: 0.8,
  smoke: 0.6,
  trail: 1,
};

let tuning: DeepFireworkTuning = DEEP_FIREWORK_DEFAULTS;

/** What the fireworks use; the defaults unless the playground changed it. */
export function deepFireworkTuning(): DeepFireworkTuning {
  return tuning;
}

/** For the playground only. */
export function setDeepFireworkTuning(next: DeepFireworkTuning) {
  tuning = next;
}

/** How a spark looks at its age: white-hot, then its color (0–1, how far it has cooled), and how bright. */
export function sparkLight(
  life: number,
  max: number,
  depth: number,
): { cool: number; fade: number; age: number } {
  const age = 1 - life / max;
  return {
    age,
    cool: age < 0.15 ? 0 : Math.min(1, (age - 0.15) * 3),
    fade: Math.min(1, Math.max(0, life / max) ** 0.6 * 1.3) * (1 - depth * 0.45),
  };
}

/** A spark's ASCII character by age: a star while hot, then smaller as it fades. */
export function sparkChar(age: number, small: boolean): string {
  if (small) return age < 0.5 ? "'" : ".";
  return age < 0.3 ? "*" : age < 0.65 ? "+" : ".";
}
