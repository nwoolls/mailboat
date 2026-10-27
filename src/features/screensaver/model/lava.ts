import {
  blend,
  type FrameResult,
  ink,
  type Pointer,
  type Scene,
  type SceneSetup,
  SLOT,
} from "./scene";

/**
 * A lava lamp: slow blobs of wax rise and sink, merging and splitting
 * where they meet. They flow around the icon box and the words, and the
 * pointer pushes them aside.
 *
 * Drawn on 2px cells (see the catalog) as rounded wax: the field's slope
 * gives each cell a surface facing, lit from the upper left, so the wax
 * is darker underneath with a soft highlight, and a faint warm glow
 * around it fades into the background. A fine ordered dither hides the
 * steps between shades, so it keeps a pixel-art grain.
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
/** A 4×4 ordered-dither matrix, -0.5 to 0.5, to hide steps between shades. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => v / 16 - 0.5);
/** Where the light comes from: up and to the left, and towards the viewer. */
const LIGHT = (() => {
  const [x, y, z] = [-0.55, -0.65, 0.9];
  const l = Math.hypot(x, y, z);
  return { x: x / l, y: y / l, z: z / l };
})();

export class LavaScene implements Scene {
  readonly blobs: Blob[] = [];
  /** Scratch for the field, one value per cell. */
  private fieldMap = new Float32Array(0);

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
        const reach = b.r + 4.5;
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
        if (d < b.r + 18 && d > 0.01) {
          ax += (dx / d) * 60;
          ay += (dy / d) * 60;
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

  draw(out: Uint8Array, opacity: Uint8Array) {
    const { cols, rows } = this.s;
    if (this.fieldMap.length !== cols * rows) this.fieldMap = new Float32Array(cols * rows);
    const f = this.fieldMap;
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) f[y * cols + x] = this.field(x, y);
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        const v = f[i]!;
        const dither = BAYER[(y % 4) * 4 + (x % 4)]!;
        if (v < 1) {
          // The lamp's warm glow just outside the wax.
          const g = (v - 0.55) / 0.45;
          if (g <= 0) {
            out[i] = 0;
            continue;
          }
          out[i] = ink(SLOT.accent);
          opacity[i] = Math.round(g * g * 0.28 * 255);
          continue;
        }
        // The surface's height: 0 at the wax's edge, levelling off smoothly
        // towards 1 inside (a hard cap left flat discs in each blob). Its
        // slope tilts the facing away from the viewer towards the edges.
        const h = (xx: number, yy: number) => {
          const at =
            f[Math.min(rows - 1, Math.max(0, yy)) * cols + Math.min(cols - 1, Math.max(0, xx))]!;
          return Math.sqrt(Math.max(0, 1 - 1 / Math.max(at, 0.5)));
        };
        const nx = -(h(x + 1, y) - h(x - 1, y)) * 6;
        const ny = -(h(x, y + 1) - h(x, y - 1)) * 6;
        const nz = 1;
        const len = Math.hypot(nx, ny, nz);
        const lit = (nx * LIGHT.x + ny * LIGHT.y + nz * LIGHT.z) / len;
        // A thin, darker rim where the wax meets the glow.
        if (v < 1.12) {
          out[i] = blend(SLOT.accent, SLOT.dark, 0.4);
          continue;
        }
        const t = lit + dither * 0.08;
        out[i] =
          t > 0.55
            ? blend(SLOT.accent, SLOT.bright, Math.min(0.7, (t - 0.55) * 1.6))
            : blend(SLOT.accent, SLOT.dark, Math.min(0.6, (0.55 - t) * 0.75));
      }
  }
}
