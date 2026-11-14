import { useEffect, useRef, useState } from "react";
import type { ToyboxStyle } from "../../emptyToys/model/style";
import type { SceneId } from "../model/catalog";
import type { PaletteId } from "../model/palettes";
import { ScreensaverCanvas } from "./ScreensaverCanvas";

/** A preview's frame: a miniature of the empty list's card. */
const FRAME =
  "panel pointer-events-none relative block aspect-[16/10] w-full overflow-hidden rounded-md";

/**
 * Random's picture: four small squares in the palette's colors, as if four
 * scenes, with a question mark over them.
 */
export function RandomPreview({ colors }: { colors: readonly string[] }) {
  return (
    <span aria-hidden className={FRAME}>
      <span className="absolute inset-3 grid grid-cols-2 gap-1 opacity-70">
        {colors.slice(0, 4).map((c) => (
          <span key={c} className="rounded-sm" style={{ background: c }} />
        ))}
      </span>
      <span className="relative flex h-full items-center justify-center text-[18px] font-semibold text-white drop-shadow">
        ?
      </span>
    </span>
  );
}

/**
 * When a still picture stops, in seconds: a moment that shows the scene
 * (the sand has poured some, a few rockets have burst).
 */
const STILL_AT: Partial<Record<SceneId, number>> = {
  sandscape: 8,
  fireworks: 6,
  life: 2.5,
  rain: 7,
  fireflies: 3.3,
};

/**
 * A small preview of a screensaver for Settings: the real scene, with no
 * icon or words in it (a miniature of them in every tile only got in the
 * way; owner, 2026-11-13). Live while `live`, else a still picture that
 * plays a moment out of sight and shows that frame, so only the chosen
 * scene moves (owner, 2026-11-13: "maybe just live for the selected one").
 */

/**
 * The size a preview is drawn at: about a list card's, so each scene is a
 * true miniature (drawn at a tile's size, its characters and pixels stayed
 * full size, only a dozen fit across, and fish and jellies were a few
 * characters while flocks and stars crowded in; owner, 2026-11-13).
 */
const DRAWN_W = 720;
const DRAWN_H = 450;

export function ScenePreview({
  sceneId,
  palette,
  style,
  live,
}: {
  sceneId: SceneId;
  palette: PaletteId;
  style: ToyboxStyle;
  live: boolean;
}) {
  const frameRef = useRef<HTMLSpanElement>(null);
  const areaRef = useRef<HTMLSpanElement>(null);
  // No icon or words: the scene plays the whole tile.
  const iconRef = useRef<HTMLElement>(null);
  const wordsRef = useRef<HTMLElement>(null);
  const [shrink, setShrink] = useState(0);
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const fit = () => setShrink(frame.clientWidth / DRAWN_W);
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);
  return (
    <span
      ref={frameRef}
      aria-hidden
      className="pointer-events-none relative block aspect-[16/10] w-full overflow-hidden rounded-md"
    >
      {shrink > 0 && (
        <span
          className="panel absolute top-0 left-0 block"
          style={{
            width: DRAWN_W,
            height: DRAWN_H,
            transform: `scale(${shrink})`,
            transformOrigin: "0 0",
          }}
        >
          <span ref={areaRef} className="absolute inset-0" />
          <ScreensaverCanvas
            sceneId={sceneId}
            palette={palette}
            style={style}
            areaRef={areaRef}
            iconRef={iconRef}
            wordsRef={wordsRef}
            closing={false}
            onNod={() => {}}
            still={!live}
            stillAt={STILL_AT[sceneId] ?? 1.5}
            shrink={shrink}
          />
        </span>
      )}
    </span>
  );
}
