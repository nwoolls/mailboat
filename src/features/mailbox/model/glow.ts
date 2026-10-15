/** How quickly the glow closes in on the pointer, and drifts home after. */
export const GLOW_FOLLOW_SECONDS = 0.35;
export const GLOW_RETURN_SECONDS = 1.1;

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
