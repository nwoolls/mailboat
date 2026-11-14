import { describe, expect, it } from "vitest";
import {
  bodyAt,
  buildScene,
  driftClouds,
  type Material,
  paletteFor,
  resizeScene,
  sceneAt,
  type SceneState,
  SKY_SCENE_DEFAULTS as T,
  skyIsDark,
} from "./skyScene";

const COLS = 150;
const ROWS = 120;
const scene = buildScene(COLS, ROWS, T);

function stateAt(hour: number): SceneState {
  return { hour, phase: 0.5, seconds: 0, lookX: 0, lookY: 0, body: bodyAt(scene, hour, T) };
}

function count(hour: number) {
  const s = stateAt(hour);
  const p = paletteFor(hour);
  const seen = new Map<Material, number>();
  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < COLS; x++) {
      const m = sceneAt(scene, x + 0.5, y + 0.5, s, p, T).material;
      seen.set(m, (seen.get(m) ?? 0) + 1);
    }
  return seen;
}

describe("the sky scene", () => {
  it("lays out the same each time for the same size", () => {
    const again = buildScene(COLS, ROWS, T);
    expect([...again.mountain]).toEqual([...scene.mountain]);
    expect(again.clouds.map((c) => c.x)).toEqual(scene.clouds.map((c) => c.x));
  });

  it("puts sky above, then mountains, hills and grass below", () => {
    const s = stateAt(12);
    const p = paletteFor(12);
    const down = (y: number) => sceneAt(scene, 75.5, y, s, p, T).material;
    expect(["sky", "cloud", "sun"]).toContain(down(2));
    expect(down(ROWS - 1)).toBe("grass");
    // Somewhere between, mountains and hills.
    const column = Array.from({ length: ROWS }, (_, y) => down(y + 0.5));
    expect(column).toContain("mountain");
    expect(column.indexOf("mountain")).toBeLessThan(column.indexOf("grass"));
  });

  it("shows the sun by day and the moon and stars at night", () => {
    const noon = count(12);
    expect(noon.get("sun")).toBeGreaterThan(0);
    expect(noon.get("star") ?? 0).toBe(0);
    const night = count(23);
    expect(night.get("moon")).toBeGreaterThan(0);
    expect(night.get("star")).toBeGreaterThan(0);
    expect(night.get("sun") ?? 0).toBe(0);
  });

  it("has clouds and flowers in their season", () => {
    expect(count(12).get("cloud")).toBeGreaterThan(0);
    expect(count(23).get("flower")).toBeGreaterThan(0);
    expect(count(12).get("flower") ?? 0).toBe(0);
  });

  it("shades mountain faces two ways, lit and shaded", () => {
    const s = stateAt(12);
    const p = paletteFor(12);
    const colors = new Set<string>();
    for (let x = 0; x < COLS; x++) {
      const c = sceneAt(scene, x + 0.5, ROWS * (T.mountainsAt - 0.02), s, p, T);
      if (c.material === "mountain") colors.add(c.color.join());
    }
    expect(colors.size).toBeGreaterThanOrEqual(2);
  });
});

describe("the text over the sky", () => {
  it("is dark by day, and turns light at dusk, before night has fully come", () => {
    expect(skyIsDark(paletteFor(13))).toBe(false);
    // Dusk: night is only beginning, but the sky behind the words is dark.
    expect(paletteFor(19).night).toBeLessThan(0.5);
    expect(skyIsDark(paletteFor(19))).toBe(true);
    expect(skyIsDark(paletteFor(23))).toBe(true);
  });
});

describe("resizing the sky", () => {
  it("keeps the land and stars where they were, adding more at the right", () => {
    const small = buildScene(120, 80, T);
    const wide = buildScene(160, 80, T);
    for (let x = 0; x < 120; x++) {
      expect(wide.mountain[x]).toBeCloseTo(small.mountain[x]!, 5);
      expect(wide.hill[x]).toBeCloseTo(small.hill[x]!, 5);
    }
    for (let y = 0; y < 80; y++)
      for (let x = 0; x < 120; x++)
        expect(wide.starSeed[y * 160 + x]).toBe(small.starSeed[y * 120 + x]);
  });

  it("carries the same clouds on, at the same share of the way across", () => {
    const old = buildScene(120, 80, T);
    driftClouds(old, 30);
    const cloud = old.clouds[0]!;
    const share = (cloud.x + cloud.w) / (120 + cloud.w * 2);
    const scene = resizeScene(old, 180, 80, T);
    expect(scene.clouds[0]).toBe(cloud);
    expect((cloud.x + cloud.w) / (180 + cloud.w * 2)).toBeCloseTo(share, 6);
  });

  it("drifts clouds on and round past the edge", () => {
    const scene = buildScene(120, 80, T);
    const cloud = scene.clouds[0]!;
    const x = cloud.x;
    driftClouds(scene, 1);
    expect(cloud.x).toBeCloseTo(x + cloud.speed, 6);
    driftClouds(scene, (120 + cloud.w * 2) / cloud.speed);
    expect(cloud.x).toBeCloseTo(x + cloud.speed, 3);
  });
});
