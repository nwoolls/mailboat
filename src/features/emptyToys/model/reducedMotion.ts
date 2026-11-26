import { PLATFORM, type Platform } from "../../../shared/lib/platform";

/**
 * What the system's reduce-motion setting does to the toys and the
 * screensaver, as Settings → Toybox says it. Asked for after someone took
 * the toys for frozen, not knowing the system setting stills them. Each
 * line says what the code does with `prefers-reduced-motion: reduce`
 * (the toys' components, `skyInput`, `useScreensaver`, `ScenePreview`).
 */

/**
 * Where the setting lives: macOS's Reduce motion, Windows' Animation
 * effects (off), and on Linux the desktop's animations (GNOME's Reduce
 * animation, KDE's animation speed), which WebKitGTK reports as
 * `prefers-reduced-motion`. Only the top level of each path, since the
 * pane under Accessibility differs between system versions.
 */
export function reducedMotionIntro(on: boolean, platform: Platform = PLATFORM): string {
  if (platform === "mac")
    return on
      ? "Reduce motion is on in System Settings → Accessibility, so the toys stay mostly still."
      : "When Reduce motion is on in System Settings → Accessibility, the toys stay mostly still.";
  if (platform === "linux")
    return on
      ? "Animations are turned off in your desktop’s settings, so the toys stay mostly still."
      : "When animations are turned off in your desktop’s settings, the toys stay mostly still.";
  return on
    ? "Animation effects are off in Windows Settings → Accessibility, so the toys stay mostly still."
    : "When Animation effects are off in Windows Settings → Accessibility, the toys stay mostly still.";
}

/** One line per toy, then the screensaver. Kept general (owner, 2026-11-23). */
export const REDUCED_MOTION_EFFECTS: readonly { label: string; effect: string }[] = [
  { label: "Glow", effect: "stays still behind the icon." },
  { label: "Pond", effect: "the water stays calm." },
  { label: "Bubble wrap", effect: "bubbles still pop, without confetti." },
  { label: "Sky", effect: "the sky still follows the time of day, but nothing else moves." },
  {
    label: "Screensaver",
    effect: "doesn't start, even from the command palette, and the previews above don't move.",
  },
];
