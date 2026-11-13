/**
 * The Toybox playground (`bun run playground`): the app's real empty view in
 * a browser, with dials for every number its look depends on, to tune by
 * eye and copy the values back into the code. Development only; nothing
 * here ships, and the app always draws with the defaults in the code.
 *
 * So far it has the ASCII glow (`ASCII_GLOW_DEFAULTS`). Another toy joins by
 * exporting its own tuning object with a setter, as `model/asciiGlow.ts`
 * does, and adding a `Dials` section below.
 */
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../src/styles/index.css";
import { EmptyState } from "../src/features/mailbox/ui/EmptyState";
import {
  ASCII_GLOW_DEFAULTS,
  type AsciiGlowTuning,
  setAsciiGlowTuning,
} from "../src/features/mailbox/model/asciiGlow";
import { toyboxStyle } from "../src/features/emptyToys/ui/prefs";
import { setFeatureFlag } from "../src/shared/lib/featureFlags";
import { ACCENTS } from "../src/features/settings/model/appearance";

// The glow, drawn as ASCII art, and no screensaver taking over after a minute.
setFeatureFlag("emptyGlow", true);
setFeatureFlag("screensavers", false);
toyboxStyle.set("ascii");

const SAVED = "playground.asciiGlow";

/** One dial: a number in the tuning, its range and what it does. */
type Dial = { key: keyof AsciiGlowTuning; min: number; max: number; step: number; hint: string };

const GLOW_DIALS: readonly { title: string; dials: readonly Dial[] }[] = [
  {
    title: "Grid",
    dials: [
      { key: "fontPx", min: 8, max: 20, step: 1, hint: "character size, px" },
      { key: "lineHeight", min: 1, max: 2, step: 0.05, hint: "cell height ÷ size" },
      { key: "gridDark", min: 0, max: 0.1, step: 0.005, hint: "grid lines, dark" },
      { key: "gridLight", min: 0, max: 0.1, step: 0.005, hint: "grid lines, light" },
    ],
  },
  {
    title: "Shape",
    dials: [
      { key: "radiusScale", min: 0.4, max: 2, step: 0.05, hint: "size, × the glow's" },
      { key: "reach", min: 0.8, max: 1.6, step: 0.05, hint: "edge reach" },
      { key: "wobble", min: 0, max: 0.3, step: 0.01, hint: "edge breathing" },
      { key: "cutoff", min: 0, max: 0.4, step: 0.01, hint: "faintest cell drawn" },
    ],
  },
  {
    title: "Motion",
    dials: [
      { key: "wakeSeconds", min: 0, max: 3, step: 0.05, hint: "trail fade, s" },
      { key: "wakeStrength", min: 0, max: 1, step: 0.05, hint: "trail brightness" },
      { key: "jitter", min: 0, max: 4, step: 0.1, hint: "character scatter" },
      { key: "shimmerBase", min: 0, max: 3, step: 0.05, hint: "shimmer, dim cells" },
      { key: "shimmerGain", min: 0, max: 6, step: 0.1, hint: "shimmer, bright cells" },
    ],
  },
  {
    title: "Hot core",
    dials: [
      { key: "hotAt", min: 0.5, max: 1.01, step: 0.01, hint: "flip above (1.01 = never)" },
      { key: "hotShare", min: 0, max: 1, step: 0.05, hint: "share that flips" },
      { key: "hotTileDark", min: 0, max: 1, step: 0.05, hint: "flipped tile, dark" },
      { key: "hotTileLight", min: 0, max: 1, step: 0.05, hint: "flipped tile, light" },
      { key: "hotMixDark", min: 0, max: 1, step: 0.05, hint: "accent → text, dark" },
      { key: "hotMixLight", min: 0, max: 1, step: 0.05, hint: "accent → text, light" },
    ],
  },
  {
    title: "Tiles and characters",
    dials: [
      { key: "tileBaseDark", min: 0, max: 0.6, step: 0.01, hint: "tile, dim, dark" },
      { key: "tileGainDark", min: 0, max: 1, step: 0.01, hint: "tile, bright, dark" },
      { key: "tileBaseLight", min: 0, max: 0.6, step: 0.01, hint: "tile, dim, light" },
      { key: "tileGainLight", min: 0, max: 1, step: 0.01, hint: "tile, bright, light" },
      { key: "glyphBase", min: 0, max: 1, step: 0.05, hint: "character, dim" },
      { key: "glyphGain", min: 0, max: 1, step: 0.05, hint: "character, bright" },
    ],
  },
  {
    title: "Clearing round the icon",
    dials: [
      { key: "iconPad", min: 0, max: 40, step: 1, hint: "fully clear within, px" },
      { key: "iconFeather", min: 0, max: 120, step: 1, hint: "soft edge, px" },
      { key: "iconFloor", min: 0, max: 1, step: 0.05, hint: "left inside (0 = none)" },
      { key: "iconRadius", min: 0, max: 40, step: 1, hint: "corner roundness, px" },
    ],
  },
  {
    title: "Clearing round the words",
    dials: [
      { key: "wordsPad", min: 0, max: 30, step: 1, hint: "fully clear within, px" },
      { key: "wordsFeather", min: 0, max: 80, step: 1, hint: "soft edge, px" },
      { key: "wordsFloor", min: 0, max: 1, step: 0.05, hint: "left inside (0 = none)" },
      { key: "wordsRadius", min: 0, max: 30, step: 1, hint: "corner roundness, px" },
      { key: "thin", min: 0, max: 1, step: 0.05, hint: "thin (1) or fade (0), both" },
    ],
  },
];

function loadTuning(): AsciiGlowTuning {
  try {
    const raw = localStorage.getItem(SAVED);
    if (raw) return { ...ASCII_GLOW_DEFAULTS, ...(JSON.parse(raw) as Partial<AsciiGlowTuning>) };
  } catch {
    // Fall through to the defaults.
  }
  return ASCII_GLOW_DEFAULTS;
}

/** Light or dark without touching the system setting: the same tokens `index.css` sets. */
const THEMES = {
  dark: {
    "--background-lightness": "9%",
    "--raised-lightness": "12%",
    "--content-lightness": "92%",
  },
  light: {
    "--background-lightness": "99%",
    "--raised-lightness": "97%",
    "--content-lightness": "12%",
  },
} as const;
type Theme = keyof typeof THEMES;

function applyTheme(theme: Theme, accent: string) {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(THEMES[theme])) root.style.setProperty(k, v);
  root.style.setProperty("--color-accent", accent);
  root.style.colorScheme = theme;
  document.body.style.background = theme === "dark" ? "hsl(240 4% 6%)" : "hsl(240 4% 93%)";
}

const initial = loadTuning();
setAsciiGlowTuning(initial);

function Playground() {
  const [tuning, setTuning] = useState(initial);
  const [theme, setTheme] = useState<Theme>(() =>
    window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark",
  );
  const [accent, setAccent] = useState<string>(ACCENTS[0].color);
  // Hide the icon or words to see the clearing's shape on its own; the
  // glow still clears round them, as they're only made invisible.
  const [show, setShow] = useState({ icon: true, words: true, detail: false });
  useEffect(() => applyTheme(theme, accent), [theme, accent]);

  const change = (next: AsciiGlowTuning) => {
    setTuning(next);
    setAsciiGlowTuning(next);
    try {
      localStorage.setItem(SAVED, JSON.stringify(next));
    } catch {
      // Not remembered; still applied.
    }
  };
  const changed = Object.fromEntries(
    Object.entries(tuning).filter(
      ([k, v]) => ASCII_GLOW_DEFAULTS[k as keyof AsciiGlowTuning] !== v,
    ),
  );

  return (
    <div
      className="playground flex h-full gap-4 p-4 text-[12px] text-content"
      data-hide-icon={!show.icon || undefined}
      data-hide-words={!show.words || undefined}
    >
      <style>{`
        .playground[data-hide-icon] .empty-rise > div:first-child,
        .playground[data-hide-words] .empty-words { visibility: hidden; }
      `}</style>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {(["dark", "light"] as const).map((t) => (
            <button key={t} type="button" className={chip(theme === t)} onClick={() => setTheme(t)}>
              {t === "dark" ? "Dark" : "Light"}
            </button>
          ))}
          <span className="w-2" />
          {(
            [
              ["icon", "Icon"],
              ["words", "Words"],
              ["detail", "Second line"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              className={chip(show[k])}
              onClick={() => setShow({ ...show, [k]: !show[k] })}
            >
              {label}
            </button>
          ))}
          <span className="w-2" />
          {ACCENTS.map((a) => (
            <button
              key={a.id}
              type="button"
              title={a.label}
              aria-label={a.label}
              onClick={() => setAccent(a.color)}
              className="size-5 rounded-full"
              style={{
                background: a.color,
                outline: accent === a.color ? "2px solid var(--color-content)" : "none",
                outlineOffset: 2,
              }}
            />
          ))}
        </div>
        {/* The list card, as in the app; drag its corner to resize. */}
        <div
          className="panel"
          style={{
            display: "flex",
            flexDirection: "column",
            width: 760,
            height: 620,
            maxWidth: "100%",
            resize: "both",
            overflow: "hidden",
          }}
        >
          <div className="flex h-11 shrink-0 items-center px-4 text-[14px] font-semibold">
            Inbox
          </div>
          <EmptyState
            state={{
              icon: "caughtUp",
              title: "All caught up",
              detail: show.detail ? "Nothing new in your Inbox." : undefined,
            }}
            swapKey="inbox"
          />
        </div>
      </div>

      <aside className="flex w-80 shrink-0 flex-col gap-4 overflow-y-auto">
        <div className="flex items-center justify-between">
          <h1 className="text-[14px] font-semibold">ASCII glow</h1>
          <button type="button" className={chip(false)} onClick={() => change(ASCII_GLOW_DEFAULTS)}>
            Reset
          </button>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-content/60">ramp, faint → dense (first is empty)</span>
          <input
            className="rounded border border-stroke bg-selection-subtle px-2 py-1 font-mono"
            value={tuning.ramp}
            onChange={(e) => change({ ...tuning, ramp: e.target.value })}
          />
        </label>
        {GLOW_DIALS.map((section) => (
          <section key={section.title} className="flex flex-col gap-2">
            <h2 className="text-[11px] tracking-wide text-content/50 uppercase">{section.title}</h2>
            {section.dials.map((d) => (
              <label key={d.key} className="grid grid-cols-[1fr_auto] items-center gap-x-2">
                <span className="text-content/70">{d.hint}</span>
                <span className="font-mono text-content/50 tabular-nums">
                  {Number(tuning[d.key])
                    .toFixed(3)
                    .replace(/\.?0+$/, "")}
                </span>
                <input
                  className="col-span-2"
                  type="range"
                  min={d.min}
                  max={d.max}
                  step={d.step}
                  value={Number(tuning[d.key])}
                  onChange={(e) => change({ ...tuning, [d.key]: Number(e.target.value) })}
                />
              </label>
            ))}
          </section>
        ))}
        <section className="flex flex-col gap-1">
          <h2 className="text-[11px] tracking-wide text-content/50 uppercase">
            Changed from the defaults
          </h2>
          <textarea
            readOnly
            rows={6}
            className="rounded border border-stroke bg-selection-subtle p-2 font-mono text-[11px]"
            value={Object.keys(changed).length ? JSON.stringify(changed, null, 2) : "(nothing)"}
          />
          <span className="text-content/50">
            Paste this to the agent to make it the app's defaults.
          </span>
        </section>
      </aside>
    </div>
  );
}

function chip(on: boolean): string {
  return `rounded-md border border-stroke px-2.5 py-1 ${on ? "bg-selection-strong" : "bg-selection-subtle"}`;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Playground />
  </StrictMode>,
);
