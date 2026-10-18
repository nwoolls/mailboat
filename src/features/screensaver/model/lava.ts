import { type FrameResult, ink, type Pointer, type Scene, type SceneSetup, SLOT } from "./scene";

/**
 * A lava lamp: slow blobs of wax rise and sink, merging and splitting
 * where they meet. They flow around the icon box and the words, and the
 * pointer pushes them aside. Drawn as a field with ordered dithering at
 * its edges, so it stays pixel art.
 */

type Blob = {
  /** Where across the lamp it tends to drift back to. */
  home: number;
  x: number;
  y: number;
  r: number;
  vx: number;
  vy: number;
  phase: number;
  rate: number;
};

const COUNT = 6;
/** A 4×4 ordered-dither matrix, for the soft edge between bands. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(
  (v) => (v / 16 - 0.5) * 0.35,
);

export class LavaScene implements Scene {
  readonly blobs: Blob[] = [];

  constructor(private readonly s: SceneSetup) {
    const { cols, rows, rng } = s;
    for (let i = 0; i < COUNT; i++)
      this.blobs.push({
        home: cols * ((i + 0.5) / COUNT),
        x: cols * (0.15 + rng() * 0.7),
        y: rows * (0.2 + rng() * 0.6),
        r: Math.min(cols, rows) * (0.07 + rng() * 0.05),
        vx: 0,
        vy: 0,
        phase: rng() * Math.PI * 2,
        rate: 0.05 + rng() * 0.05,
      });
  }

  frame(dt: number, pointer: Pointer): FrameResult {
    const { cols, rows, icon, words } = this.s;
    for (const b of this.blobs) {
      // Heat below, cool above: each blob bobs the height of the lamp.
      b.phase += b.rate * dt * Math.PI * 2;
      const wantY = rows * (0.5 - 0.42 * Math.sin(b.phase));
      const wantX = b.home + Math.sin(b.phase * 0.7 + b.r) * cols * 0.08;
      let ax = (wantX - b.x) * 0.05 - b.vx * 0.5;
      let ay = (wantY - b.y) * 0.08 - b.vy * 0.6;
      for (const box of [icon, words]) {
        if (!box) continue;
        // Nearest point of the box; push out if the blob reaches it.
        const nx = Math.max(box.x0, Math.min(b.x, box.x1));
        const ny = Math.max(box.y0, Math.min(b.y, box.y1));
        const dx = b.x - nx;
        const dy = b.y - ny;
        const d = Math.hypot(dx, dy);
        const reach = b.r + 3;
        if (d < reach) {
          const ux = d > 0.01 ? dx / d : b.x < (box.x0 + box.x1) / 2 ? -1 : 1;
          const uy = d > 0.01 ? dy / d : 0;
          ax += ux * (reach - d) * 14;
          ay += uy * (reach - d) * 14;
        }
      }
      if (pointer) {
        const dx = b.x - pointer.x;
        const dy = b.y - pointer.y;
        const d = Math.hypot(dx, dy);
        if (d < b.r + 12 && d > 0.01) {
          ax += (dx / d) * 40;
          ay += (dy / d) * 40;
        }
      }
      b.vx += ax * dt;
      b.vy += ay * dt;
      b.x = Math.max(b.r * 0.5, Math.min(cols - b.r * 0.5, b.x + b.vx * dt));
      b.y = Math.max(b.r * 0.5, Math.min(rows - b.r * 0.5, b.y + b.vy * dt));
    }
    return {};
  }

  /** The field at a cell: over 1 is inside the wax. */
  field(x: number, y: number): number {
    let f = 0;
    for (const b of this.blobs) {
      const dx = x - b.x;
      const dy = y - b.y;
      f += (b.r * b.r) / (dx * dx + dy * dy + 1);
    }
    return f;
  }

  draw(out: Uint8Array) {
    const { cols, rows } = this.s;
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        const f = this.field(x, y) + BAYER[(y % 4) * 4 + (x % 4)]!;
        out[y * cols + x] =
          f < 1
            ? 0
            : f < 1.25
              ? ink(SLOT.mid, 1)
              : f < 2.2
                ? ink(SLOT.accent, 1)
                : f < 4
                  ? ink(SLOT.accent, 2)
                  : ink(SLOT.accent, 3);
      }
  }
}
