/**
 * How the glow moves (the same for every style). It drifts around the
 * middle. When the pointer comes over the list it follows it on a spring:
 * starting from rest, it speeds up and settles in, and it keeps pace with a
 * moving pointer a short way behind rather than falling further back. The
 * spring tightens smoothly over `catchSeconds` from a slow glide
 * (`glideSeconds`) to a looser-than-exact hold (`holdSeconds`), so there's
 * no visible moment of locking on (owner, 2026-11-13: the old easing slowed
 * near the pointer and never caught a moving one, the switch to holding
 * showed, and holding exactly on the pointer felt too tight). When the
 * pointer leaves it lingers, then drifts home slowly (`returnSeconds`).
 *
 * The times are the spring's response time (1 / its angular frequency):
 * a moving pointer is trailed by about 2 × that × its speed.
 */
export type GlowMotion = {
  /** The spring's response time when the pointer arrives: a slow glide. */
  glideSeconds: number;
  /** Its response time once tightened: how closely it holds on. */
  holdSeconds: number;
  /** How long it takes to tighten from gliding to holding. */
  catchSeconds: number;
  /** Its response time drifting home after the pointer leaves. */
  returnSeconds: number;
  /**
   * How long it lingers where the pointer left before heading home, so a
   * quick trip to the sidebar doesn't send it rebounding to the middle.
   */
  lingerSeconds: number;
};

export const GLOW_MOTION_DEFAULTS: GlowMotion = {
  glideSeconds: 0.16,
  holdSeconds: 0.04,
  catchSeconds: 0.6,
  returnSeconds: 0.9,
  lingerSeconds: 2,
};

let motion: GlowMotion = GLOW_MOTION_DEFAULTS;

/** How the glow moves; the defaults unless the playground changed them. */
export function glowMotion(): GlowMotion {
  return motion;
}

/** For the playground only. */
export function setGlowMotion(next: GlowMotion) {
  motion = next;
}

/**
 * The spring's response time `since` seconds after the pointer arrived:
 * from gliding to holding, easing between (no step).
 */
export function followSeconds(since: number, m: GlowMotion): number {
  const k = m.catchSeconds > 0 ? Math.max(0, Math.min(1, since / m.catchSeconds)) : 1;
  const ease = k * k * (3 - 2 * k);
  return m.glideSeconds + (m.holdSeconds - m.glideSeconds) * ease;
}

/**
 * One frame of a critically damped spring pulling `x` (moving at `v`)
 * toward `target`: it accelerates, then settles in without overshooting.
 * `response` is 1 / the spring's angular frequency, in seconds. Stepped
 * finely, so a long frame stays stable. Returns the new place and speed.
 */
export function spring(
  x: number,
  v: number,
  target: number,
  dt: number,
  response: number,
): { x: number; v: number } {
  if (response <= 0) return { x: target, v: 0 };
  const w = 1 / response;
  const steps = Math.max(1, Math.ceil((dt * w) / 0.25));
  const h = dt / steps;
  let px = x;
  let pv = v;
  for (let i = 0; i < steps; i++) {
    pv += (w * w * (target - px) - 2 * w * pv) * h;
    px += pv * h;
  }
  return { x: px, v: pv };
}

/**
 * One frame of smooth following: move `current` part of the way to
 * `target`. `tau` is the time constant (after `tau` seconds about 63% of
 * the gap is closed), and `dt` the frame time, so speed doesn't depend on
 * the display's refresh rate. Unlike restarting a CSS transition on every
 * pointer move, this never jumps back to full speed, so it glides.
 */
export function approach(current: number, target: number, dt: number, tau: number): number {
  if (tau <= 0) return target;
  return current + (target - current) * (1 - Math.exp(-dt / tau));
}
