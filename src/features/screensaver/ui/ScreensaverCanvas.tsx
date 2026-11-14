import { type RefObject, useEffect, useRef, useState } from "react";
import {
  cellPxOf,
  isSceneId,
  makeScene,
  pickScene,
  SCREENSAVER_EVENT,
  SCREENSAVER_IDLE_SECONDS,
  SCREENSAVER_STOP_EVENT,
  screensaverSticky,
  SCREENSAVER_ROTATE_MINUTES,
  type SceneId,
} from "../model/catalog";
import {
  colorTable,
  type PaletteId,
  paintOverSky,
  paletteColors,
  parseColor,
} from "../model/palettes";
import { blend, ink, type Pointer, type Rect, type Scene, SLOT } from "../model/scene";
import { isRealMove } from "../../../shared/lib/pointer";
import { screensaverPrefs } from "./prefs";
import { deepJellyTuning, makeSwarm, resizeSwarm, step, type Swarm } from "../model/deepJellies";
import { drawDeepJellies } from "./deepJelliesDraw";
import {
  type CodeRain,
  codeRainTuning,
  makeCodeRain,
  resizeCodeRain,
  stepCodeRain,
} from "../model/codeRain";
import { KoiScene } from "../model/koi";
import { LavaScene } from "../model/lava";
import { SandscapeScene } from "../model/sand";
import { drawShadedAscii } from "./shadedAscii";
import { drawCodeRain, pixelCell } from "./codeRainDraw";
import {
  makeMurmuration,
  type Murmuration,
  murmurationTuning,
  resizeMurmuration,
  stepMurmuration,
} from "../model/murmuration";
import { drawMurmuration } from "./murmurationDraw";
import { deepLifeTuning } from "../model/deepLife";
import { LifeScene } from "../model/life";
import { drawLife } from "./lifeDraw";
import { deepFireflyTuning, USUAL_FLASHES } from "../model/deepFireflies";
import { FireflyScene } from "../model/fireflies";
import { drawDeepFireflies } from "./deepFirefliesDraw";
import { deepRainTuning } from "../model/deepRain";
import { RainScene } from "../model/rain";
import { drawDeepRain } from "./deepRainDraw";
import { deepFireworkTuning } from "../model/deepFireworks";
import { FireworksScene } from "../model/fireworks";
import { drawDeepFireworks } from "./deepFireworksDraw";
import {
  deepStarTuning,
  makeStarfield,
  resizeStarfield,
  type Starfield,
  stepStars,
} from "../model/deepStars";
import { drawDeepStars } from "./deepStarsDraw";
import {
  chunkCells,
  coverageChar,
  dominantInk,
  lookFor,
  screensaverLookTuning,
} from "../model/looks";
import type { Rgb } from "../model/palettes";
import type { ToyboxStyle } from "../../emptyToys/model/style";
import { asciiGlowTuning, type ClearShape } from "../../mailbox/model/asciiGlow";
import {
  asciiCell,
  AsciiPainter,
  GLYPH_ON_HOT,
  mix,
  readAsciiColors,
} from "../../emptyToys/ui/asciiPaint";

export type ScreensaverPhase = "off" | "on" | "closing";
const CLOSE_MS = 450;

/**
 * When the empty list's screensaver runs. It starts after
 * SCREENSAVER_IDLE_SECONDS without any input while the window is visible,
 * even with another app in front (owner's choice: it's something to look
 * at beside other work), or at once from the palette's "Start
 * screensaver". It closes on a key, click or scroll. Moving the pointer
 * doesn't close it: the sand plays with the pointer instead. Never starts
 * with "Reduce motion" on, and never while `enabled` (its feature flag) is
 * off.
 *
 * With "Random" chosen, a screensaver left running switches to another
 * scene every SCREENSAVER_ROTATE_MINUTES (a scene picked by name from the
 * palette stays).
 *
 * Pointer events that don't actually move (WebKit sends some when the page
 * changes under a still cursor, such as when the palette closes) don't
 * count as input.
 */
export function useScreensaver(enabled: boolean): { phase: ScreensaverPhase; scene: SceneId } {
  const [phase, setPhase] = useState<ScreensaverPhase>("off");
  const [scene, setScene] = useState<SceneId>("sandscape");
  // Whether the running screensaver came from "Random", so it rotates.
  const rotating = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let timer = 0;
    let last: { x: number; y: number } | null = null;
    // Picks the scene (the one asked for, the chosen one, or a random one
    // other than the last) and starts it.
    const begin = (asked: SceneId | null) => {
      const choice = screensaverPrefs.get().choice;
      rotating.current = asked === null && choice === "random";
      setScene((prev) => pickScene(asked, choice, prev, Math.random));
      setPhase("on");
    };
    // Starts even while the window is hidden: macOS counts a window that
    // another app covers completely as hidden, and waiting for it to show
    // again meant coming back to no screensaver (and another minute's wait,
    // which the click bringing it forward then reset). The canvas pauses
    // itself while hidden, so this costs nothing.
    const start = () => !reduced() && begin(null);
    const arm = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(start, SCREENSAVER_IDLE_SECONDS * 1000);
    };
    if (phase === "off") {
      arm();
      // Asked for: start now, and don't let the palette closing (its key, a stray pointer event) cancel it.
      let now = 0;
      const onStartNow = (e: Event) => {
        const asked = e instanceof CustomEvent && isSceneId(e.detail) ? e.detail : null;
        window.clearTimeout(now);
        now = window.setTimeout(() => !reduced() && begin(asked), 300);
      };
      const onMove = (e: PointerEvent) => {
        const moved = isRealMove(last, e);
        last = { x: e.clientX, y: e.clientY };
        if (moved) arm();
      };
      const events = ["keydown", "pointerdown", "wheel"] as const;
      for (const e of events) window.addEventListener(e, arm, { passive: true });
      window.addEventListener("pointermove", onMove, { passive: true });
      window.addEventListener(SCREENSAVER_EVENT, onStartNow);
      return () => {
        window.clearTimeout(timer);
        window.clearTimeout(now);
        for (const e of events) window.removeEventListener(e, arm);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener(SCREENSAVER_EVENT, onStartNow);
      };
    }
    if (phase === "on") {
      const close = () => setPhase("closing");
      // The playground keeps it playing through clicks (`screensaverSticky`).
      const events = screensaverSticky() ? [] : (["keydown", "pointerdown", "wheel"] as const);
      for (const e of events) window.addEventListener(e, close, { passive: true });
      // Asked for another while one plays: switch to it.
      const onSwitch = (e: Event) => {
        if (e instanceof CustomEvent && isSceneId(e.detail)) setScene(e.detail);
      };
      window.addEventListener(SCREENSAVER_EVENT, onSwitch);
      window.addEventListener(SCREENSAVER_STOP_EVENT, close);
      const rotate = window.setInterval(() => {
        if (rotating.current && screensaverPrefs.get().choice === "random")
          setScene((prev) => pickScene(null, "random", prev, Math.random));
      }, SCREENSAVER_ROTATE_MINUTES * 60_000);
      return () => {
        window.clearInterval(rotate);
        for (const e of events) window.removeEventListener(e, close);
        window.removeEventListener(SCREENSAVER_EVENT, onSwitch);
        window.removeEventListener(SCREENSAVER_STOP_EVENT, close);
      };
    }
    timer = window.setTimeout(() => setPhase("off"), CLOSE_MS);
    return () => window.clearTimeout(timer);
  }, [phase, enabled]);

  return { phase: enabled ? phase : "off", scene };
}

/**
 * A screensaver scene over the empty list (see `model/scene.ts`). It fills
 * `areaRef` (the empty state's box below the title row), gives the scene
 * the icon box and each letter of the words as shapes to play with, and
 * the pointer while it's over the area, and colours it with `palette`. It
 * keeps playing while another app is in front, and pauses only when the
 * window is hidden (minimized, or another Space).
 */
export function ScreensaverCanvas({
  sceneId,
  palette,
  areaRef,
  iconRef,
  wordsRef,
  closing,
  onNod,
  style = "pixel",
}: {
  sceneId: SceneId;
  palette: PaletteId;
  areaRef: RefObject<HTMLElement | null>;
  iconRef: RefObject<HTMLElement | null>;
  wordsRef: RefObject<HTMLElement | null>;
  closing: boolean;
  onNod: () => void;
  /** Settings → Toybox → Style; a scene follows it once restyled (`model/looks.ts`). */
  style?: ToyboxStyle;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodRef = useRef(onNod);
  const colorsRef = useRef<Uint32Array>(new Uint32Array(0));
  /** The palette's five colors, for ASCII art's characters. */
  const slotsRef = useRef<Rgb[]>([]);
  useEffect(() => {
    nodRef.current = onNod;
  }, [onNod]);
  // Recoloured at once when the palette changes, without restarting.
  useEffect(() => {
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--color-accent");
    const slots = paletteColors(palette, parseColor(accent));
    colorsRef.current = colorTable(slots);
    slotsRef.current = [...slots];
  }, [palette]);

  useEffect(() => {
    const area = areaRef.current;
    const canvas = canvasRef.current;
    const card = area?.closest<HTMLElement>(".panel");
    const ctx = canvas?.getContext("2d");
    if (!area || !canvas || !card || !ctx) return;
    // The screensaver's stage: the empty area, reaching up under the
    // card's title row to its top edge, so no dark band is left along the
    // top (owner, 2026-11-13). The title stands in the way, like the words.
    const stageRect = () => {
      const r = area.getBoundingClientRect();
      const top = card.getBoundingClientRect().top;
      return new DOMRect(r.left, top, r.width, r.bottom - top);
    };
    const title = card.querySelector<HTMLElement>("[data-card-title]");

    const look = lookFor(sceneId, style);
    // The koi are drawn larger in the Toybox's styles (owner, 2026-11-13:
    // "i'm fine with larger fish"): in ASCII art a koi at its usual size is
    // only a dozen characters long, too few to read as a fish.
    // The sandscape's pixel art is its own sand with bigger grains, not a
    // conversion, so its fine layers stay crisp.
    const zoom =
      sceneId === "koi"
        ? look === "ascii"
          ? 2
          : look === "chunky"
            ? 1.5
            : 1
        : sceneId === "sandscape" && look === "chunky"
          ? 2
          : 1;
    const px = cellPxOf(sceneId) * zoom;
    // Some scenes have their own drawing in the Toybox's styles, from their
    // own shapes rather than from cells: the jellyfish
    // (`model/deepJellies.ts`) and the starfield (`model/deepStars.ts`).
    const deep =
      (sceneId === "jellyfish" ||
        sceneId === "starfield" ||
        sceneId === "fireworks" ||
        sceneId === "rain" ||
        sceneId === "code" ||
        sceneId === "fireflies" ||
        sceneId === "life" ||
        sceneId === "envelopes") &&
      look !== "fine";
    let swarm: Swarm | null = null;
    let stars: Starfield | null = null;
    let fireworks: FireworksScene | null = null;
    let rain: RainScene | null = null;
    let code: CodeRain | null = null;
    let flies: FireflyScene | null = null;
    let life: LifeScene | null = null;
    let flock: Murmuration | null = null;
    let deepNight = false;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const painter = new AsciiPainter(ctx);
    let scene: Scene | null = null;
    let image: ImageData | null = null;
    let pixels: Uint32Array | null = null;
    let cells: Uint8Array | null = null;
    let opacity: Uint8Array | null = null;
    // The koi in ASCII art: the ripples drawn apart from the koi.
    let ripples: Uint8Array | null = null;
    let rippleOpacity: Uint8Array | null = null;
    let pointer: Pointer = null;
    let frame = 0;
    // Whether the page is light now (Settings → Appearance → Theme).
    const light = window.matchMedia("(prefers-color-scheme: light)");
    // Whether the icon and words are switched to light text for a night sky.
    let nightShown = false;
    let last = 0;

    // (Re)starts the scene to fit the area, with the icon and words in it.
    const layout = () => {
      const a = stageRect();
      const c = card.getBoundingClientRect();
      const cols = Math.max(1, Math.floor(a.width / px));
      const rows = Math.max(1, Math.floor(a.height / px));
      Object.assign(canvas.style, {
        left: `${a.left - c.left}px`,
        top: `${a.top - c.top}px`,
        width: `${cols * px}px`,
        height: `${rows * px}px`,
      });
      // A restyled scene is drawn more solid than a fine one (`solidity`).
      if (look === "fine") canvas.style.removeProperty("--screensaver-opacity");
      else
        canvas.style.setProperty("--screensaver-opacity", String(screensaverLookTuning().solidity));
      // ASCII art draws characters at the screen's own resolution; the
      // other looks draw one canvas pixel per cell, scaled up sharp.
      const sharp = look === "ascii" || deep;
      canvas.width = sharp ? Math.round(cols * px * dpr) : cols;
      canvas.height = sharp ? Math.round(rows * px * dpr) : rows;
      // These scenes fit themselves to a resized area and carry on; the
      // others start over (their cells are laid out around the icon).
      if (deep) {
        const w = cols * px;
        const h = rows * px;
        if (sceneId === "envelopes") {
          if (flock) resizeMurmuration(flock, w, h);
          else flock = makeMurmuration(w, h, murmurationTuning(), Math.random);
        } else if (sceneId === "life") {
          // Each Life cell a character of the glow's grid (lined up with it
          // across the card), or a chunky tile.
          const { solid, letters } = solidMask(
            a,
            cols,
            rows,
            px,
            iconRef.current,
            wordsRef.current,
          );
          const setup = {
            cols,
            rows,
            solid,
            letters,
            icon: rectOf(iconRef.current, a, cols, rows, px),
            words: boundsOf(letters, cols),
            rng: Math.random,
          };
          const g = asciiGlowTuning();
          const { cw, ch } = asciiCell(ctx, g.fontPx, g.lineHeight);
          const tile = Math.max(3, Math.round(deepLifeTuning().pixel));
          const tiles =
            look === "ascii"
              ? {
                  w: cw / px,
                  h: ch / px,
                  ox: -((((a.left - c.left) % cw) + cw) % cw) / px,
                  oy: -((((a.top - c.top) % ch) + ch) % ch) / px,
                }
              : { w: tile / px, h: tile / px, ox: 0, oy: 0 };
          const next = new LifeScene(setup, tiles);
          if (life && life.tiles.w === tiles.w && life.tiles.h === tiles.h) next.carryFrom(life);
          life = next;
        } else if (sceneId === "code") {
          // A character grid: the glow's in ASCII art, the pixel font's in pixel art.
          const g = asciiGlowTuning();
          const charCell =
            look === "ascii" ? asciiCell(ctx, g.fontPx, g.lineHeight) : pixelCell(codeRainTuning());
          const gc = Math.ceil(w / charCell.cw) + 1;
          const gr = Math.ceil(h / charCell.ch) + 1;
          if (code) resizeCodeRain(code, gc, gr, Math.random);
          else code = makeCodeRain(gc, gr, codeRainTuning(), Math.random);
        } else if (sceneId === "jellyfish") {
          if (swarm) resizeSwarm(swarm, w, h);
          else swarm = makeSwarm(w, h, deepJellyTuning(), Math.random);
        } else if (sceneId === "fireworks" || sceneId === "rain" || sceneId === "fireflies") {
          // Their own motion, on the fine grid it was made for.
          const { solid, letters } = solidMask(
            a,
            cols,
            rows,
            px,
            iconRef.current,
            wordsRef.current,
          );
          const setup = {
            cols,
            rows,
            solid,
            letters,
            icon: rectOf(iconRef.current, a, cols, rows, px),
            words: boundsOf(letters, cols),
            rng: Math.random,
          };
          if (sceneId === "rain") {
            if (rain) rain.resize(setup);
            else rain = new RainScene(setup);
          } else if (sceneId === "fireflies") {
            if (flies) flies.resize(setup);
            else flies = new FireflyScene(setup, deepFireflyTuning().count);
          } else if (fireworks) fireworks.resize(setup);
          else fireworks = new FireworksScene(setup);
        } else {
          // The vanishing point rests behind the icon.
          const icon = iconRef.current?.getBoundingClientRect();
          const restX = icon ? icon.left + icon.width / 2 - a.left : w / 2;
          const restY = icon ? icon.top + icon.height / 2 - a.top : h / 2;
          if (stars) resizeStarfield(stars, w, h, restX, restY);
          else stars = makeStarfield(w, h, restX, restY, deepStarTuning(), Math.random);
        }
        return;
      }
      image = ctx.createImageData(cols, rows);
      pixels = new Uint32Array(image.data.buffer);
      cells = new Uint8Array(cols * rows);
      opacity = new Uint8Array(cols * rows);
      ripples = new Uint8Array(cols * rows);
      rippleOpacity = new Uint8Array(cols * rows);
      const { solid, letters } = solidMask(a, cols, rows, px, iconRef.current, wordsRef.current);
      const setup = {
        cols,
        rows,
        solid,
        letters,
        icon: rectOf(iconRef.current, a, cols, rows, px),
        // The words' box is wider than the text; use the letters' extent.
        words: boundsOf(letters, cols),
        rng: Math.random,
        zoom,
      };
      const before = scene;
      scene = makeScene(sceneId, setup);
      // The sandscape carries its sand through a resize; the others not
      // yet restyled start over.
      if (scene instanceof SandscapeScene && before instanceof SandscapeScene)
        scene.carryFrom(before, setup);
    };

    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      if (deep) drawDeep(dt);
      else drawFine(dt);
      frame = requestAnimationFrame(tick);
    };

    // A scene drawn on its fine grid (and converted, if restyled so).
    const drawFine = (dt: number) => {
      if (scene && image && pixels && cells && opacity) {
        const result = scene.frame(dt, pointer);
        if (result.nod) nodRef.current();
        if (result.hideWords !== undefined) setWordsHidden(wordsRef.current, result.hideWords);
        // The sandscape's turn: the canvas rotates, then the grid is turned.
        canvas.style.transform = result.turn ? `rotate(${result.turn}deg)` : "";
        opacity.fill(255);
        scene.draw(cells, opacity);
        const colors = colorsRef.current;
        if (look === "chunky" && sceneId !== "sandscape")
          chunk(cells, opacity, image.width, image.height, chunkCells(px, screensaverLookTuning()));
        const night = !!scene.night && light.matches;
        if (night !== nightShown) {
          nightShown = night;
          setNight([iconRef.current, wordsRef.current, title, canvas], night);
        }
        if (look === "ascii") {
          if (
            (scene instanceof KoiScene ||
              scene instanceof LavaScene ||
              scene instanceof SandscapeScene) &&
            ripples &&
            rippleOpacity
          ) {
            // Smooth shapes as shaded characters; the koi's ripples apart.
            if (scene instanceof KoiScene) {
              scene.draw(cells, opacity, { ripples: false, koi: true });
              rippleOpacity.fill(255);
              scene.draw(ripples, rippleOpacity, { ripples: true, koi: false });
            } else ripples.fill(0);
            const g = asciiGlowTuning();
            const { cw, ch } = asciiCell(ctx, g.fontPx, g.lineHeight);
            const a = stageRect();
            const c = card.getBoundingClientRect();
            const page = readAsciiColors(g.hotMixDark, g.hotMixLight);
            drawShadedAscii({
              ctx,
              shapesInk: cells,
              shapesOpacity: opacity,
              ripples,
              rippleOpacity,
              cols: image.width,
              rows: image.height,
              px,
              colors,
              crest: ink(SLOT.light),
              dpr,
              ox: -((((a.left - c.left) % cw) + cw) % cw),
              oy: -((((a.top - c.top) % ch) + ch) % ch),
              cw,
              ch,
              fontPx: g.fontPx,
              page,
              grid: page.dark ? g.gridDark : g.gridLight,
              shapes: clearShapes(a),
              glow: g,
            });
          } else drawAscii(cells, opacity, image.width, image.height, colors, night);
        } else if (night) {
          // A night sky in the palette's darkest colour, a little lighter low down.
          const top = colors[ink(SLOT.dark, 0)] ?? 0;
          const bottom = colors[blend(SLOT.dark, SLOT.mid, 0.25)] ?? top;
          paintOverSky(pixels, cells, opacity, colors, image.width, top, bottom);
        } else
          for (let i = 0; i < cells.length; i++) {
            const c = colors[cells[i]!] ?? 0;
            const a = opacity[i]!;
            // The colours are solid; a see-through cell scales the alpha byte.
            pixels[i] = a === 255 ? c : ((c & 0xffffff) | (((a * (c >>> 24)) / 255) << 24)) >>> 0;
          }
        if (look !== "ascii") ctx.putImageData(image, 0, 0);
      }
    };

    /**
     * Where characters thin out so the icon, words and title stay
     * readable: the icon's box and each line of the words and the title,
     * in pixels of the stage.
     */
    const clearShapes = (a: DOMRect): ClearShape[] => {
      const shapes: ClearShape[] = [];
      const icon = iconRef.current?.getBoundingClientRect();
      if (icon)
        shapes.push({
          kind: "icon",
          x0: icon.left - a.left,
          y0: icon.top - a.top,
          x1: icon.right - a.left,
          y1: icon.bottom - a.top,
        });
      for (const el of [wordsRef.current, title]) {
        if (!el) continue;
        const range = document.createRange();
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          range.selectNodeContents(n);
          for (const r of range.getClientRects())
            if (r.width > 0)
              shapes.push({
                kind: "words",
                x0: r.left - a.left,
                y0: r.top - a.top,
                x1: r.right - a.left,
                y1: r.bottom - a.top,
              });
        }
      }
      return shapes;
    };

    // A scene with its own motion and drawing (the jellyfish, the starfield).
    const drawDeep = (dt: number) => {
      const g = asciiGlowTuning();
      const page = readAsciiColors(g.hotMixDark, g.hotMixLight);
      const a = stageRect();
      const c = card.getBoundingClientRect();
      const box = (el: HTMLElement | null) => {
        const r = el?.getBoundingClientRect();
        return r
          ? { x0: r.left - a.left, y0: r.top - a.top, x1: r.right - a.left, y1: r.bottom - a.top }
          : null;
      };
      const icon = box(iconRef.current);
      const words = box(wordsRef.current);
      const keep = [icon, words].filter((b): b is NonNullable<typeof b> => b !== null);
      const p = pointer ? { x: pointer.x * px, y: pointer.y * px } : null;
      if (swarm && step(swarm, dt, p, keep, deepJellyTuning(), Math.random)) nodRef.current();
      if (stars && stepStars(stars, dt, p, deepStarTuning(), Math.random)) nodRef.current();
      if (fireworks && fireworks.frame(dt, pointer).nod) nodRef.current();
      if (rain && rain.frame(dt, pointer).nod) nodRef.current();
      if (flies) flies.pace = deepFireflyTuning().flashes / USUAL_FLASHES;
      if (flies && flies.frame(dt, pointer).nod) nodRef.current();
      if (flock) {
        // It roosts in the icon.
        const roost = icon ? { x: (icon.x0 + icon.x1) / 2, y: (icon.y0 + icon.y1) / 2 } : null;
        if (stepMurmuration(flock, dt, p, roost, murmurationTuning(), Math.random, keep))
          nodRef.current();
      }
      if (life) {
        const result = life.frame(dt, pointer);
        if (result.nod) nodRef.current();
        if (result.hideWords !== undefined) setWordsHidden(wordsRef.current, result.hideWords);
      }
      if (code && stepCodeRain(code, dt, codeRainTuning(), Math.random)) nodRef.current();
      // On a light page, a dark backdrop (deep sea, night sky), and light
      // text on it; rain stays on the page's own glass.
      const night = light.matches && !rain && !life && !flock;
      if (night !== deepNight) {
        deepNight = night;
        setNight([iconRef.current, wordsRef.current, title, canvas], night);
      }
      const { cw, ch } = asciiCell(ctx, g.fontPx, g.lineHeight);
      const shapes = clearShapes(a);
      const common = {
        ctx,
        look: look === "ascii" ? ("ascii" as const) : ("chunky" as const),
        dpr,
        ox: -((((a.left - c.left) % cw) + cw) % cw),
        oy: -((((a.top - c.top) % ch) + ch) % ch),
        cw,
        ch,
        glow: g,
        fontPx: g.fontPx,
        page,
        slots: slotsRef.current,
        shapes,
        backdrop: night,
      };
      if (swarm) drawDeepJellies({ ...common, swarm, t: deepJellyTuning() });
      if (stars) drawDeepStars({ ...common, field: stars, t: deepStarTuning() });
      if (fireworks)
        drawDeepFireworks({
          ...common,
          scene: fireworks,
          px,
          width: canvas.width / dpr,
          height: canvas.height / dpr,
          t: deepFireworkTuning(),
        });
      if (rain)
        drawDeepRain({
          ...common,
          scene: rain,
          px,
          width: canvas.width / dpr,
          height: canvas.height / dpr,
          t: deepRainTuning(),
        });
      if (flies)
        drawDeepFireflies({
          ...common,
          scene: flies,
          px,
          width: canvas.width / dpr,
          height: canvas.height / dpr,
          t: deepFireflyTuning(),
        });
      if (life)
        drawLife({
          ...common,
          life,
          width: canvas.width / dpr,
          height: canvas.height / dpr,
          t: deepLifeTuning(),
        });
      if (flock) drawMurmuration({ ...common, flock, t: murmurationTuning() });
      if (code) {
        const pixel = pixelCell(codeRainTuning());
        drawCodeRain({
          ...common,
          ...(look === "ascii" ? {} : { ...pixel, ox: 0, oy: 0 }),
          rain: code,
          width: canvas.width / dpr,
          height: canvas.height / dpr,
          pointer: p,
          t: codeRainTuning(),
        });
      }
    };

    // ASCII art: a character per cell of the glow's grid (lined up with it
    // across the card), picked by how much of it the scene covers, on a
    // tile in the covered cells' average color.
    const drawAscii = (
      cellInks: Uint8Array,
      cellOpacity: Uint8Array,
      cols: number,
      rows: number,
      colors: Uint32Array,
      night: boolean,
    ) => {
      const t = screensaverLookTuning();
      const g = asciiGlowTuning();
      const page = readAsciiColors(g.hotMixDark, g.hotMixLight);
      const { cw, ch } = asciiCell(ctx, g.fontPx, g.lineHeight);
      const slots = slotsRef.current;
      const glyphRows = slots.map((c) => mix(c, page.content, t.glyphLift));
      painter.prepare(cw, ch, dpr, g.fontPx, t.ramp, page, glyphRows);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (night) {
        const top = rgbOf(colors[ink(SLOT.dark, 0)] ?? 0);
        const bottom = rgbOf(colors[blend(SLOT.dark, SLOT.mid, 0.25)] ?? 0);
        const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
        grad.addColorStop(0, `rgb(${top.join(" ")})`);
        grad.addColorStop(1, `rgb(${bottom.join(" ")})`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      const a = stageRect();
      const c = card.getBoundingClientRect();
      const ox = -((((a.left - c.left) % cw) + cw) % cw);
      const oy = -((((a.top - c.top) % ch) + ch) % ch);
      const width = cols * px;
      const height = rows * px;
      for (let y = oy; y < height; y += ch)
        for (let x = ox; x < width; x += cw) {
          const c0 = Math.max(0, Math.floor(x / px));
          const c1 = Math.min(cols, Math.ceil((x + cw) / px));
          const r0 = Math.max(0, Math.floor(y / px));
          const r1 = Math.min(rows, Math.ceil((y + ch) / px));
          let sum = 0;
          let n = 0;
          let rr = 0;
          let gg = 0;
          let bb = 0;
          for (let r = r0; r < r1; r++)
            for (let k = c0; k < c1; k++) {
              n++;
              const i = r * cols + k;
              if (!cellInks[i]) continue;
              const w = cellOpacity[i]! / 255;
              const col = colors[cellInks[i]!] ?? 0;
              sum += w;
              rr += (col & 255) * w;
              gg += ((col >>> 8) & 255) * w;
              bb += ((col >>> 16) & 255) * w;
            }
          if (n === 0 || sum === 0) continue;
          const coverage = sum / n;
          const glyph = coverageChar(coverage, t);
          if (!glyph) continue;
          const avg: Rgb = [rr / sum, gg / sum, bb / sum];
          const bright = (0.2126 * avg[0] + 0.7152 * avg[1] + 0.0722 * avg[2]) / 255;
          if (coverage * t.gain > t.hotAt && bright > t.hotBright) {
            painter.tileIn(x, y, mix(avg, [255, 255, 255], 0.5), 0.85);
            painter.glyph(x, y, glyph, GLYPH_ON_HOT, 1);
            continue;
          }
          const base = page.dark ? t.tileBaseDark : t.tileBaseLight;
          const gain = page.dark ? t.tileGainDark : t.tileGainLight;
          painter.tileIn(x, y, avg, base + gain * coverage);
          painter.glyph(
            x,
            y,
            glyph,
            GLYPH_ON_HOT + 1 + nearest(slots, avg),
            0.45 + 0.55 * Math.min(1, coverage * t.gain),
          );
        }
      ctx.globalAlpha = 1;
    };
    const play = () => {
      if (frame || document.hidden) return;
      last = performance.now();
      frame = requestAnimationFrame(tick);
    };
    const pause = () => {
      cancelAnimationFrame(frame);
      frame = 0;
    };

    const onMove = (e: PointerEvent) => {
      const a = stageRect();
      const inside =
        e.clientX >= a.left && e.clientX < a.right && e.clientY >= a.top && e.clientY < a.bottom;
      pointer = inside ? { x: (e.clientX - a.left) / px, y: (e.clientY - a.top) / px } : null;
    };
    const onLeave = () => {
      pointer = null;
    };
    const onVisibility = () => (document.hidden ? pause() : play());

    layout();
    play();
    // A resize lands after this frame's drawing and before it's shown, and
    // resizing the canvas clears it, so every scene is drawn again at once
    // (else it would be blank, flashing, while dragging).
    const resize = new ResizeObserver(() => {
      layout();
      if (deep) drawDeep(0);
      else drawFine(0);
    });
    resize.observe(area);
    card.addEventListener("pointermove", onMove);
    card.addEventListener("pointerleave", onLeave);
    document.addEventListener("visibilitychange", onVisibility);
    const words = wordsRef.current;
    const icon = iconRef.current;
    return () => {
      pause();
      resize.disconnect();
      card.removeEventListener("pointermove", onMove);
      card.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", onVisibility);
      setWordsHidden(words, false);
      setNight([icon, words, title, canvas], false);
    };
  }, [sceneId, areaRef, iconRef, wordsRef, style]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="screensaver"
      data-closing={closing || undefined}
    />
  );
}

/**
 * On a night sky the icon and words (dark on a light page) switch to light
 * text so they still read, and the canvas is drawn solid (see the CSS).
 */
function setNight(els: (HTMLElement | null)[], night: boolean) {
  for (const el of els) {
    if (!el) continue;
    if (night) el.dataset.sceneNight = "";
    else delete el.dataset.sceneNight;
  }
}

/** Fades the words out (Life plays with them) or back in. */
function setWordsHidden(words: HTMLElement | null, hidden: boolean) {
  if (!words) return;
  if (hidden) words.dataset.sceneHidden = "";
  else delete words.dataset.sceneHidden;
}

/** The smallest box around the set cells of `mask`, or null if none are. */
function boundsOf(mask: Uint8Array, cols: number): Rect | null {
  let box: Rect | null = null;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const x = i % cols;
    const y = Math.floor(i / cols);
    if (!box) box = { x0: x, y0: y, x1: x, y1: y };
    else {
      box.x0 = Math.min(box.x0, x);
      box.x1 = Math.max(box.x1, x);
      box.y1 = y;
    }
  }
  return box;
}

/** A distance in pixels as a cell index, kept on the grid. */
function cell(v: number, max: number, px: number): number {
  return Math.max(0, Math.min(max - 1, Math.floor(v / px)));
}

/** An element's box in cells of the area, or null if it isn't there. */
function rectOf(
  el: HTMLElement | null,
  area: DOMRect,
  cols: number,
  rows: number,
  px: number,
): Rect | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  return {
    x0: cell(r.left - area.left, cols, px),
    y0: cell(r.top - area.top, rows, px),
    x1: cell(r.right - area.left - 1, cols, px),
    y1: cell(r.bottom - area.top - 1, rows, px),
  };
}

/**
 * Which cells are solid: the icon's rounded box and the words' letters,
 * drawn at full size and then reduced to cells (any inked pixel counts).
 * `letters` is the letters alone.
 */
function solidMask(
  area: DOMRect,
  cols: number,
  rows: number,
  px: number,
  icon: HTMLElement | null,
  words: HTMLElement | null,
): { solid: Uint8Array; letters: Uint8Array } {
  const width = cols * px;
  const height = rows * px;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { solid: new Uint8Array(cols * rows), letters: new Uint8Array(cols * rows) };
  ctx.fillStyle = "#000";

  // Each letter where the page laid it out, in the same font.
  for (const p of words?.querySelectorAll("p") ?? []) {
    const text = p.firstChild;
    if (!(text instanceof Text)) continue;
    const style = getComputedStyle(p);
    ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const metrics = ctx.measureText("Hg");
    const ascent = metrics.fontBoundingBoxAscent;
    const descent = metrics.fontBoundingBoxDescent;
    const range = document.createRange();
    const chars = text.data;
    for (let i = 0; i < chars.length; i++) {
      if (!chars[i]!.trim()) continue;
      range.setStart(text, i);
      range.setEnd(text, i + 1);
      const r = range.getBoundingClientRect();
      const baseline = r.top + (r.height - ascent - descent) / 2 + ascent;
      ctx.fillText(chars[i]!, r.left - area.left, baseline - area.top);
    }
  }
  const letters = toCells(ctx, cols, rows, px);

  if (icon) {
    const r = icon.getBoundingClientRect();
    const radius = Number.parseFloat(getComputedStyle(icon).borderTopLeftRadius) || 0;
    ctx.beginPath();
    ctx.roundRect(r.left - area.left, r.top - area.top, r.width, r.height, radius);
    ctx.fill();
  }
  return { solid: toCells(ctx, cols, rows, px), letters };
}

/** Reduces what's drawn to cells: a cell counts if any pixel in it is inked. */
function toCells(
  ctx: CanvasRenderingContext2D,
  cols: number,
  rows: number,
  px: number,
): Uint8Array {
  const width = cols * px;
  const data = ctx.getImageData(0, 0, width, rows * px).data;
  const mask = new Uint8Array(cols * rows);
  for (let cy = 0; cy < rows; cy++)
    for (let cx = 0; cx < cols; cx++) {
      let inked = false;
      for (let y = 0; y < px && !inked; y++)
        for (let x = 0; x < px && !inked; x++)
          inked = data[((cy * px + y) * width + cx * px + x) * 4 + 3]! > 110;
      if (inked) mask[cy * cols + cx] = 1;
    }
  return mask;
}

/**
 * Pixel art's chunky blocks: each `k` × `k` block of cells takes its most
 * common ink and its cells' average opacity, in place.
 */
function chunk(inks: Uint8Array, opacity: Uint8Array, cols: number, rows: number, k: number) {
  if (k <= 1) return;
  const blockInks: number[] = [];
  const blockOpacity: number[] = [];
  for (let by = 0; by < rows; by += k)
    for (let bx = 0; bx < cols; bx += k) {
      blockInks.length = 0;
      blockOpacity.length = 0;
      for (let y = by; y < Math.min(rows, by + k); y++)
        for (let x = bx; x < Math.min(cols, bx + k); x++) {
          blockInks.push(inks[y * cols + x]!);
          blockOpacity.push(opacity[y * cols + x]!);
        }
      const { ink: dominant, opacity: solid } = dominantInk(blockInks, blockOpacity);
      for (let y = by; y < Math.min(rows, by + k); y++)
        for (let x = bx; x < Math.min(cols, bx + k); x++) {
          inks[y * cols + x] = dominant;
          opacity[y * cols + x] = dominant ? solid : 255;
        }
    }
}

/** The index of the color in `colors` nearest `c`. */
function nearest(colors: readonly Rgb[], c: Rgb): number {
  let best = 0;
  let bestD = Infinity;
  colors.forEach((k, i) => {
    const d = (k[0] - c[0]) ** 2 + (k[1] - c[1]) ** 2 + (k[2] - c[2]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

/** A color from the color table (little-endian RGBA) as numbers. */
function rgbOf(c: number): Rgb {
  return [c & 255, (c >>> 8) & 255, (c >>> 16) & 255];
}
