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
