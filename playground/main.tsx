/**
 * The Toybox playground (`bun run playground`): the app's real empty view in
 * a browser, with dials for every number its look depends on, to tune by
 * eye and copy the values back into the code. Development only; nothing
 * here ships, and the app always draws with the defaults in the code.
 *
 * Each look has a panel: its tuning object's defaults, its setter, and its
 * dials (`ASCII_GLOW_DEFAULTS`, `ASCII_POND_DEFAULTS`). Another joins by
 * exporting the same from its model and adding a `Panel` below.
 */
import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "../src/styles/index.css";
import { EmptyState } from "../src/features/mailbox/ui/EmptyState";
import {
  ASCII_GLOW_DEFAULTS,
  type AsciiGlowTuning,
  setAsciiGlowTuning,
} from "../src/features/mailbox/model/asciiGlow";
import {
  ASCII_POND_DEFAULTS,
  type AsciiPondTuning,
  setAsciiPondTuning,
} from "../src/features/emptyToys/model/asciiPond";
import {
  POND_STIR_DEFAULTS,
  type PondStir,
  setPondStir,
} from "../src/features/emptyToys/model/pond";
import { emptyToy, toyboxStyle } from "../src/features/emptyToys/ui/prefs";
import { setFeatureFlag } from "../src/shared/lib/featureFlags";
import { ACCENTS } from "../src/features/settings/model/appearance";

// ASCII art, and no screensaver taking over after a minute.
setFeatureFlag("screensavers", false);
toyboxStyle.set("ascii");

/** One dial: a number in a tuning, its range and what it does. */
type Dial<T> = { key: keyof T & string; min: number; max: number; step: number; hint: string };
type Sections<T> = readonly { title: string; dials: readonly Dial<T>[] }[];
/** A text field in a tuning (a character ramp, a single character). */
type Field<T> = { key: keyof T & string; hint: string };

const GLOW_DIALS: Sections<AsciiGlowTuning> = [
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

const GLOW_FIELDS: readonly Field<AsciiGlowTuning>[] = [
  { key: "ramp", hint: "ramp, faint → dense (first is empty)" },
];

const POND_DIALS: Sections<AsciiPondTuning> = [
  {
    title: "Water",
    dials: [
      { key: "crestGain", min: 0.5, max: 10, step: 0.1, hint: "lit slopes, brightness" },
      { key: "troughGain", min: 0, max: 10, step: 0.1, hint: "dark slopes, strength" },
      { key: "cutoff", min: 0, max: 0.5, step: 0.01, hint: "calmest water drawn" },
      { key: "jitter", min: 0, max: 4, step: 0.1, hint: "character scatter" },
      { key: "troughAlpha", min: 0, max: 1, step: 0.05, hint: "dark slope characters" },
    ],
  },
  {
    title: "Hot crests",
    dials: [
      { key: "hotAt", min: 0.3, max: 1.01, step: 0.01, hint: "flip above (1.01 = never)" },
      { key: "hotShare", min: 0, max: 1, step: 0.05, hint: "share that flips" },
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
    title: "Splash",
    dials: [
      { key: "plopCols", min: 0, max: 8, step: 1, hint: "plop, cells across" },
      { key: "plopRows", min: 0, max: 4, step: 1, hint: "plop, cells down" },
    ],
  },
];

const POND_FIELDS: readonly Field<AsciiPondTuning>[] = [
  { key: "crestRamp", hint: "lit water, faint → dense (first is empty)" },
  { key: "troughRamp", hint: "dark water, faint → dense (first is empty)" },
  { key: "dropletChar", hint: "droplet" },
  { key: "trailChar", hint: "droplet's trail" },
  { key: "plopChar", hint: "plop" },
];

const STIR_DIALS: Sections<PondStir> = [
  {
    title: "Following the pointer",
    dials: [
      { key: "stirDepth", min: 0, max: 3, step: 0.05, hint: "depth at full speed (0 = off)" },
      { key: "stirRadius", min: 0.5, max: 6, step: 0.1, hint: "width, cells" },
      { key: "stirEvery", min: 1, max: 30, step: 1, hint: "a stir every, cells moved" },
      { key: "stirFullSpeed", min: 50, max: 2000, step: 25, hint: "full depth at, cells/s" },
    ],
  },
];

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

/** A tuning saved from an earlier visit, over the defaults; applied at once. */
function saved<T extends object>(key: string, defaults: T, apply: (t: T) => void): T {
  let t = defaults;
  try {
    const raw = localStorage.getItem(key);
    if (raw) t = { ...defaults, ...(JSON.parse(raw) as Partial<T>) };
  } catch {
    // The defaults.
  }
  apply(t);
  return t;
}

const glowStart = saved("playground.asciiGlow", ASCII_GLOW_DEFAULTS, setAsciiGlowTuning);
const pondStart = saved("playground.asciiPond", ASCII_POND_DEFAULTS, setAsciiPondTuning);
const stirStart = saved("playground.pondStir", POND_STIR_DEFAULTS, setPondStir);

type Look = "glow" | "pond";

function Playground() {
  const [look, setLook] = useState<Look>("glow");
  const [theme, setTheme] = useState<Theme>(() =>
    window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark",
  );
  const [accent, setAccent] = useState<string>(ACCENTS[0].color);
  // Hide the icon or words to see the clearing's shape on its own; the
  // glow still clears around them, as they're only made invisible.
  const [show, setShow] = useState({ icon: true, words: true, detail: false });
  // The pond: stones dropped every so often, so tuning needs no clicking.
  const [stones, setStones] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => applyTheme(theme, accent), [theme, accent]);
  useEffect(() => {
    // One look at a time: the glow, or the pond on its own.
    emptyToy.set(look === "pond" ? "ripples" : "glow");
  }, [look]);
  useEffect(() => {
    if (look !== "pond" || !stones) return;
    const drop = () => {
      const area = cardRef.current?.querySelector<HTMLElement>(".panel > div:last-child");
      if (!area) return;
      const r = area.getBoundingClientRect();
      area.dispatchEvent(
        new PointerEvent("pointerdown", {
          button: 0,
          clientX: r.left + r.width * (0.15 + Math.random() * 0.7),
          clientY: r.top + r.height * (0.15 + Math.random() * 0.7),
        }),
      );
    };
    drop();
    const timer = window.setInterval(drop, 1800);
    return () => window.clearInterval(timer);
  }, [look, stones]);

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
      <div ref={cardRef} className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {(["glow", "pond"] as const).map((l) => (
            <button key={l} type="button" className={chip(look === l)} onClick={() => setLook(l)}>
              {l === "glow" ? "Glow" : "Pond"}
            </button>
          ))}
          <span className="w-2" />
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
          {look === "pond" && (
            <>
              <span className="w-2" />
              <button type="button" className={chip(stones)} onClick={() => setStones(!stones)}>
                Drop stones
              </button>
            </>
          )}
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
        {look === "glow" ? (
          <Panel
            key="glow"
            title="ASCII glow"
            storageKey="playground.asciiGlow"
            defaults={ASCII_GLOW_DEFAULTS}
            start={glowStart}
            apply={setAsciiGlowTuning}
            fields={GLOW_FIELDS}
            sections={GLOW_DIALS}
          />
        ) : (
          <Panel
            key="pond"
            title="ASCII pond"
            note="The character size and grid are the glow's (Glow → Grid)."
            storageKey="playground.asciiPond"
            defaults={ASCII_POND_DEFAULTS}
            start={pondStart}
            apply={setAsciiPondTuning}
            fields={POND_FIELDS}
            sections={POND_DIALS}
          />
        )}
        {look === "pond" && (
          <Panel
            key="stir"
            title="Pointer ripples"
            note="The water stirs faintly where the pointer moves, in pixel and ASCII art alike; a click still drops a stone. A depth of 0 turns it off."
            storageKey="playground.pondStir"
            defaults={POND_STIR_DEFAULTS}
            start={stirStart}
            apply={setPondStir}
            fields={[]}
            sections={STIR_DIALS}
          />
        )}
      </aside>
    </div>
  );
}

/** One look's dials, text fields and the values changed from its defaults. */
function Panel<T extends object>({
  title,
  note,
  storageKey,
  defaults,
  start,
  apply,
  fields,
  sections,
}: {
  title: string;
  note?: string;
  storageKey: string;
  defaults: T;
  start: T;
  apply: (t: T) => void;
  fields: readonly Field<T>[];
  sections: Sections<T>;
}) {
  const [tuning, setTuning] = useState(start);
  const values = tuning as Record<string, unknown>;
  const change = (next: T) => {
    setTuning(next);
    apply(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // Not remembered; still applied.
    }
  };
  const changed = Object.fromEntries(
    Object.entries(tuning).filter(([k, v]) => (defaults as Record<string, unknown>)[k] !== v),
  );
  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-[14px] font-semibold">{title}</h1>
        <button type="button" className={chip(false)} onClick={() => change(defaults)}>
          Reset
        </button>
      </div>
      {note && <p className="text-content/50">{note}</p>}
      {fields.map((f) => (
        <label key={f.key} className="flex flex-col gap-1">
          <span className="text-content/60">{f.hint}</span>
          <input
            className="rounded border border-stroke bg-selection-subtle px-2 py-1 font-mono"
            value={String(values[f.key])}
            onChange={(e) => change({ ...tuning, [f.key]: e.target.value })}
          />
        </label>
      ))}
      {sections.map((section) => (
        <section key={section.title} className="flex flex-col gap-2">
          <h2 className="text-[11px] tracking-wide text-content/50 uppercase">{section.title}</h2>
          {section.dials.map((d) => (
            <label key={d.key} className="grid grid-cols-[1fr_auto] items-center gap-x-2">
              <span className="text-content/70">{d.hint}</span>
              <span className="font-mono text-content/50 tabular-nums">
                {Number(values[d.key])
                  .toFixed(3)
                  .replace(/\.?0+$/, "")}
              </span>
              <input
                className="col-span-2"
                type="range"
                min={d.min}
                max={d.max}
                step={d.step}
                value={Number(values[d.key])}
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
    </>
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
