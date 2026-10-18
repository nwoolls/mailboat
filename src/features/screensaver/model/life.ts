import { type FrameResult, ink, type Pointer, type Scene, type SceneSetup, SLOT } from "./scene";

/**
 * Conway's Game of Life, seeded from the words: the letters dissolve into
 * living pixels that spread over the card, the pointer seeds new life
 * where it moves, and after a while (or once life dies down) it fades
 * and the words come back, with a nod. Then it starts again.
 */

type Phase = "living" | "fading" | "resting";

const GENERATIONS_PER_SECOND = 9;
const LIVING_SECONDS = 40;
const FADE_SECONDS = 1.5;
const REST_SECONDS = 6;

export class LifeScene implements Scene {
  private alive: Uint8Array;
  private next: Uint8Array;
  /** Generations each cell has lived, capped. */
  private readonly age: Uint8Array;
  /** Frames of afterglow left on cells that just died. */
  private readonly ghost: Uint8Array;
  phase: Phase = "living";
  private clock = 0;
  private owed = 0;
  private last: Pointer = null;

  constructor(private readonly s: SceneSetup) {
    const n = s.cols * s.rows;
    this.alive = new Uint8Array(n);
    this.next = new Uint8Array(n);
    this.age = new Uint8Array(n);
    this.ghost = new Uint8Array(n);
    this.seed();
  }

  /** The letters come alive, with a sprinkle so they don't just freeze. */
  private seed() {
    const { s } = this;
    this.alive.set(s.letters);
    if (s.words)
      for (let y = s.words.y0 - 2; y <= s.words.y1 + 2; y++)
        for (let x = s.words.x0; x <= s.words.x1; x++) if (s.rng() < 0.12) this.set(x, y);
    this.age.fill(0);
  }

  private set(x: number, y: number) {
    const { cols, rows } = this.s;
    if (x >= 0 && x < cols && y >= 0 && y < rows) this.alive[y * cols + x] = 1;
  }

  get population(): number {
    let n = 0;
    for (const v of this.alive) n += v;
    return n;
  }

  frame(dt: number, pointer: Pointer): FrameResult {
    this.clock += dt;
    if (this.phase === "resting") {
      if (this.clock < REST_SECONDS) return {};
      this.phase = "living";
      this.clock = 0;
      this.seed();
      return { hideWords: true };
    }
    if (this.phase === "fading") {
      // Cull at random until nothing's left.
      const keep = Math.max(0, 1 - this.clock / FADE_SECONDS);
      for (let i = 0; i < this.alive.length; i++)
        if (this.alive[i] && this.s.rng() > keep) {
          this.alive[i] = 0;
          this.ghost[i] = 6;
        }
      this.decayGhosts();
      if (this.clock < FADE_SECONDS) return {};
      this.alive.fill(0);
      this.phase = "resting";
      this.clock = 0;
      return {};
    }
    if (pointer && this.last && Math.hypot(pointer.x - this.last.x, pointer.y - this.last.y) > 1)
      for (let k = 0; k < 6; k++)
        this.set(
          Math.round(pointer.x + (this.s.rng() - 0.5) * 6),
          Math.round(pointer.y + (this.s.rng() - 0.5) * 6),
        );
    this.last = pointer;
    this.owed += dt * GENERATIONS_PER_SECOND;
    while (this.owed >= 1) {
      this.owed--;
      this.generation();
    }
    this.decayGhosts();
    if (this.clock > LIVING_SECONDS || (this.clock > 5 && this.population < 12)) {
      this.phase = "fading";
      this.clock = 0;
      // The words return as life fades, and the icon nods them back.
      return { hideWords: false, nod: true };
    }
    return { hideWords: true };
  }

  private generation() {
    const { cols, rows } = this.s;
    const { alive, next, age, ghost } = this;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= rows) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if ((dx || dy) && xx >= 0 && xx < cols) n += alive[yy * cols + xx]!;
          }
        }
        const i = y * cols + x;
        const live = alive[i] ? n === 2 || n === 3 : n === 3;
        next[i] = live ? 1 : 0;
        if (live) age[i] = alive[i] ? Math.min(255, age[i]! + 1) : 0;
        else if (alive[i]) ghost[i] = 6;
      }
    }
    this.alive = next;
    this.next = alive;
  }

  private decayGhosts() {
    for (let i = 0; i < this.ghost.length; i++) if (this.ghost[i]) this.ghost[i]!--;
  }

  draw(out: Uint8Array) {
    const { alive, age, ghost } = this;
    for (let i = 0; i < out.length; i++) {
      if (alive[i]) {
        const a = age[i]!;
        out[i] =
          a < 2
            ? ink(SLOT.accent, 3)
            : a < 8
              ? ink(SLOT.bright)
              : a < 30
                ? ink(SLOT.light)
                : ink(SLOT.mid);
      } else out[i] = ghost[i] ? ink(SLOT.dark, 0) : 0;
    }
  }
}
