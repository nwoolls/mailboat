import { describe, expect, it } from "vitest";
import { bodyWidth, KoiScene } from "./koi";
import { seeded, testSetup } from "./scene";

describe("KoiScene", () => {
  it("swims all over the pond, not mostly in the middle", () => {
    // About the reader's size, with the icon and words in the middle.
    const cols = 460;
    const rows = 260;
    const scene = new KoiScene(testSetup(cols, rows, seeded(5)));
    // How often a koi's head is in the middle ninth of the pond: a third of
    // the width and a third of the height, where the icon and words are.
    let inMiddle = 0;
    let samples = 0;
    for (let i = 0; i < 60 * 600; i++) {
      scene.frame(1 / 60, null);
      if (i % 30) continue;
      for (const f of scene.fish) {
        const { x, y } = f.spine[0]!;
        samples++;
        if (Math.abs(x - cols / 2) < cols / 6 && Math.abs(y - rows / 2) < rows / 6) inMiddle++;
      }
    }
    // Spread evenly would be 1/9 (11%); the koi visiting the letters adds
    // some. Before the fix they were there about 70% of the time.
    expect(inMiddle / samples).toBeLessThan(0.3);
  });

  it("sends one koi at a time to nibble the letters", () => {
    const scene = new KoiScene(testSetup(460, 260, seeded(2)));
    let visits = 0;
    let wasVisiting = false;
    for (let i = 0; i < 60 * 600; i++) {
      scene.frame(1 / 60, null);
      const visiting = scene.fish.filter((f) => f.target || f.nibble > 0).length;
      expect(visiting).toBeLessThanOrEqual(1);
      if (visiting && !wasVisiting) visits++;
      wasVisiting = visiting > 0;
    }
    // They still come to nibble, often.
    expect(visits).toBeGreaterThan(10);
  });

  it("draws each koi as a solid shape with fins, patches and shading", () => {
    const cols = 460;
    const rows = 260;
    const scene = new KoiScene(testSetup(cols, rows, seeded(3)));
    for (let i = 0; i < 60; i++) scene.frame(1 / 60, null);
    const out = new Uint8Array(cols * rows);
    scene.draw(out, new Uint8Array(out.length).fill(255));
    const inked = out.filter((v) => v > 0).length;
    // Five koi of roughly 48 x 13 cells, plus fins and tails: thousands of
    // cells, not the few hundred dots of the old pixel koi.
    expect(inked).toBeGreaterThan(5 * 300);
    // Several slots (body, patches, fins) in several shades.
    expect(new Set(out).size).toBeGreaterThan(8);
  });

  it("is round at the nose, widest a quarter back and thin at the tail", () => {
    expect(bodyWidth(0)).toBeGreaterThan(0.2);
    expect(bodyWidth(0)).toBeLessThan(0.5);
    expect(bodyWidth(0.28)).toBe(1);
    expect(bodyWidth(1)).toBeCloseTo(0.2);
  });

  it("lets the pond show through deeper koi, and draws them under shallower ones", () => {
    const cols = 460;
    const rows = 260;
    const scene = new KoiScene(testSetup(cols, rows, seeded(4)));
    const [deep, shallow] = [scene.fish[0]!, scene.fish[1]!];
    // Put both in the same place, one at the bottom, one at the surface.
    shallow.spine.forEach((p, k) => Object.assign(p, deep.spine[k]));
    deep.depth = 1;
    shallow.depth = 0;
    for (const f of scene.fish.slice(2))
      f.spine.forEach((p) => Object.assign(p, { x: -500, y: -500 }));
    const out = new Uint8Array(cols * rows);
    const opacity = new Uint8Array(cols * rows).fill(255);
    scene.draw(out, opacity);
    const body = deep.spine[3]!;
    const i = Math.round(body.y) * cols + Math.round(body.x);
    // The shallow koi covers the deep one, and is solid.
    expect(opacity[i]).toBe(255);
    shallow.spine.forEach((p) => Object.assign(p, { x: -500, y: -500 }));
    opacity.fill(255);
    scene.draw(out, opacity);
    expect(out[i]).toBeGreaterThan(0);
    expect(opacity[i]).toBeLessThan(110);
  });

  it("keeps its koi the same size in cells of its usual size, however zoomed", () => {
    // A pond small enough that the koi are sized down to fit it.
    const usual = new KoiScene(testSetup(240, 160, () => 0.5));
    // Drawn at twice the scale: half as many cells, each twice as big.
    const zoomed = new KoiScene({ ...testSetup(120, 80, () => 0.5), zoom: 2 });
    expect(usual.fish[0]!.size).toBeLessThan(0.9);
    expect(zoomed.fish.map((f) => f.size)).toEqual(usual.fish.map((f) => f.size));
  });

  it("ripples its tail and fins even while the koi is held still", () => {
    const scene = new KoiScene(testSetup(300, 200, seeded(3)));
    const f = scene.fish[0]!;
    const draw = () => {
      const out = new Uint8Array(300 * 200);
      scene.draw(out, new Uint8Array(300 * 200), { ripples: false, koi: true });
      return out;
    };
    const before = draw();
    // The same pose, a moment later in its wave and its flap.
    f.wave += 0.8;
    f.flap += 0.8;
    const after = draw();
    let changed = 0;
    for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) changed++;
    expect(changed).toBeGreaterThan(20);
  });

  it("eases its tail after a turn rather than flicking it", () => {
    const scene = new KoiScene(testSetup(300, 200, seeded(3)));
    const f = scene.fish[0]!;
    for (let i = 0; i < 60; i++) scene.frame(1 / 60, null);
    // A sharp turn: the head swings round at once.
    f.heading += 1.2;
    const steps: number[] = [];
    for (let i = 0; i < 20; i++) {
      scene.frame(1 / 60, null);
      steps.push(Math.abs(f.tailBend));
    }
    // It follows a little each frame, never jumping.
    for (let i = 1; i < steps.length; i++)
      expect(Math.abs(steps[i]! - steps[i - 1]!)).toBeLessThan(0.03);
  });
});
