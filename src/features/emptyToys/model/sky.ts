/**
 * The sky for a time of day: two gradient colours (top, horizon) and the
 * sun or moon on an arc across. `hour` is local, 0 to 24, fractional.
 */
export type Sky = {
  top: string;
  horizon: string;
  /** Sun by day, moon by night. */
  body: "sun" | "moon";
  /** Along the arc, 0 (rising, left) to 1 (setting, right). */
  along: number;
  /** Height above the horizon, 0 to 1 (the arc's top at the middle). */
  height: number;
};

type Stop = { hour: number; top: [number, number, number]; horizon: [number, number, number] };

/** Through the day: night, dawn, morning, noon, afternoon, dusk, night. */
const STOPS: Stop[] = [
  { hour: 0, top: [14, 18, 42], horizon: [34, 40, 78] },
  { hour: 5, top: [24, 30, 66], horizon: [70, 64, 110] },
  { hour: 6.5, top: [92, 120, 186], horizon: [246, 176, 140] },
  { hour: 9, top: [104, 164, 232], horizon: [196, 222, 246] },
  { hour: 13, top: [78, 150, 232], horizon: [182, 216, 248] },
  { hour: 17, top: [96, 140, 210], horizon: [236, 200, 160] },
  { hour: 19, top: [62, 64, 132], horizon: [240, 140, 110] },
  { hour: 20.5, top: [28, 30, 72], horizon: [72, 58, 108] },
  { hour: 24, top: [14, 18, 42], horizon: [34, 40, 78] },
];

/** Sunrise and sunset for the arc (a fixed, gentle day). */
export const SUNRISE = 6.5;
export const SUNSET = 19.5;

const mix = (a: number[], b: number[], t: number) =>
  `rgb(${a.map((v, i) => Math.round(v + (b[i]! - v) * t)).join(" ")})`;

export function skyAt(hour: number): Sky {
  const h = ((hour % 24) + 24) % 24;
  const i = STOPS.findIndex((s, n) => n > 0 && h < s.hour);
  const a = STOPS[i - 1]!;
  const b = STOPS[i]!;
  const t = (h - a.hour) / (b.hour - a.hour);
  const day = h >= SUNRISE && h < SUNSET;
  const along = day
    ? (h - SUNRISE) / (SUNSET - SUNRISE)
    : ((h - SUNSET + 24) % 24) / (24 - (SUNSET - SUNRISE));
  return {
    top: mix(a.top, b.top, t),
    horizon: mix(a.horizon, b.horizon, t),
    body: day ? "sun" : "moon",
    along,
    height: Math.sin(Math.PI * along),
  };
}

/** The sky's two colors at `hour` as numbers (top, horizon), for drawing on a canvas. */
export function skyColorsAt(hour: number): {
  top: [number, number, number];
  horizon: [number, number, number];
} {
  const h = ((hour % 24) + 24) % 24;
  const i = STOPS.findIndex((s, n) => n > 0 && h < s.hour);
  const a = STOPS[i - 1]!;
  const b = STOPS[i]!;
  const t = (h - a.hour) / (b.hour - a.hour);
  const at = (x: number[], y: number[]) =>
    x.map((v, k) => Math.round(v + (y[k]! - v) * t)) as [number, number, number];
  return { top: at(a.top, b.top), horizon: at(a.horizon, b.horizon) };
}

/** How close it is to sunrise or sunset, 1 at either to 0 an hour and a half away. */
export function duskiness(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  const near = Math.min(Math.abs(h - SUNRISE), Math.abs(h - SUNSET));
  return Math.max(0, 1 - near / 1.5);
}

/** How dark it is, 0 by day to 1 at night, easing through dusk and dawn. */
export function nightness(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  const ramp = (from: number, to: number) => Math.min(1, Math.max(0, (h - from) / (to - from)));
  // Dark until 5, light by 7; dimming from 18.5, dark by 20.5.
  return h < 12 ? 1 - ramp(5, 7) : ramp(18.5, 20.5);
}

/** A new moon to count from (2000-01-06 18:14 UTC), and the moon's month in days. */
const NEW_MOON_MS = Date.UTC(2000, 0, 6, 18, 14);
const LUNAR_MONTH_DAYS = 29.530588853;

/** The moon's phase on a date: 0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter. */
export function moonPhase(date: Date): number {
  const days = (date.getTime() - NEW_MOON_MS) / 86_400_000;
  return (((days / LUNAR_MONTH_DAYS) % 1) + 1) % 1;
}

/**
 * For the playground only: an hour both skies show instead of the real one
 * (null for the real time), so pixel and ASCII art can be compared at
 * dawn, noon, dusk or night. `subscribe` tells a sky to draw again.
 */
let hourOverride: number | null = null;
const hourListeners = new Set<() => void>();

export function skyHourOverride(): number | null {
  return hourOverride;
}

export function setSkyHourOverride(hour: number | null) {
  hourOverride = hour;
  for (const listener of hourListeners) listener();
}

export function subscribeSkyHour(listener: () => void): () => void {
  hourListeners.add(listener);
  return () => {
    hourListeners.delete(listener);
  };
}
