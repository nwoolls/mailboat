/**
 * What every trailer shares: the app's window in 3D on a backdrop, a camera
 * moved on the music's beats, captions, one flip from dark to light, and an
 * end card where the icon draws itself. A trailer is a `TrailerSpec`: its
 * shots, camera moves and captions, placed with its music's grid.
 *
 * The window is a picture or a loop of demo mode (made-up mail) in the
 * feature gallery's 1600x900 layout, at 1x (docs/images/) or 2x
 * (video/capture.sh), cut out of that frame. The window's frame is
 * 1424x820 at 88,40 in it; its one-pixel outline makes the cut 1426x822 at
 * 87,39.
 */
import type { CSSProperties, ReactNode } from "react";
import {
  AbsoluteFill,
  Audio,
  Easing,
  Freeze,
  Img,
  interpolate,
  OffthreadVideo,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { CameraMotionBlur } from "@remotion/motion-blur";
import brand from "../../../brand.json";
import type { Grid } from "./grid";

export type Theme = "dark" | "light";

/** Where the window sits in each gallery picture and loop (1600x900), and its corner. */
export const WIN = { x: 87, y: 39, w: 1426, h: 822, radius: 17 };
export const CENTER = { x: WIN.w / 2, y: WIN.h / 2 };
/** A picture placed so its window fills the window's box. */
export const FULL: CSSProperties = {
  position: "absolute",
  left: -WIN.x,
  top: -WIN.y,
  width: 1600,
  height: 900,
  maxWidth: "none",
};
export const FONT = '-apple-system, "SF Pro Display", system-ui, sans-serif';
export const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** Pieces of a text, each with a key from where it starts in the text (words or letters can repeat). */
function keyed(pieces: string[], gap: number): { piece: string; key: string }[] {
  let at = 0;
  return pieces.map((piece) => {
    const key = `${at}:${piece}`;
    at += piece.length + gap;
    return { piece, key };
  });
}

export type Source = { still: string } | { video: string; from: number; rate?: number };
/** What the window shows, from which frame on, in which theme. */
export type Shot = { start: number; theme: Theme; source: Source; name: string };
/**
 * The camera, as where the window is and how it's turned. `fx`/`fy` is the
 * point of the window (in its own pixels) held at the middle of the screen,
 * moved by `x`/`y`; the window turns and zooms around that point.
 */
export type Pose = {
  fx: number;
  fy: number;
  s: number;
  rx: number;
  ry: number;
  rz: number;
  x: number;
  y: number;
  z: number;
};
/** `cut` jumps, `glide` eases in and out, `settle` springs in without passing the mark. */
export type Move = {
  at: number;
  dur?: number;
  ease: "cut" | "glide" | "settle";
  pose: Partial<Pose>;
};
/** A small label over a title; it comes in at `from` and has left by `to`. */
export type Caption = { from: number; to: number; eyebrow: string; title: string };

export type TrailerSpec = {
  grid: Grid;
  shots: Shot[];
  moves: Move[];
  captions: Caption[];
  /** The frame the light half starts to open; none for a trailer that stays dark. */
  flip?: number;
  /** The end card's first bar. */
  endBar: number;
  tagline: string;
  /** Drawn inside the window over its picture (rows moving, text writing in). */
  overlay?: (shot: Shot, frame: number) => ReactNode;
  /** Drawn over the scene (keycaps). */
  extras?: (frame: number, theme: Theme) => ReactNode;
};

/** The window rising in at a steep angle, before the first move. */
export const START: Pose = {
  fx: CENTER.x,
  fy: CENTER.y,
  s: 0.6,
  rx: 58,
  ry: -34,
  rz: 10,
  x: 280,
  y: 640,
  z: -500,
};

/** The opening: the window rises in over a bar, lands, and drifts until `until`. */
export function opening(grid: Grid, until: number, land: Partial<Pose> = {}): Move[] {
  return [
    { at: 0, ease: "cut", pose: START },
    {
      at: 0,
      dur: grid.beats(4),
      ease: "settle",
      pose: { s: 0.8, rx: 8, ry: -18, rz: 0, x: 300, y: 10, z: 0, ...land },
    },
    {
      at: grid.beats(4),
      dur: until - grid.beats(4),
      ease: "glide",
      pose: { s: 0.86, rx: 4, ry: -12 },
    },
  ];
}

/** Each view: a cut on its downbeat, a move in over a beat and a half, then a slow drift until the next. */
export function view(
  grid: Grid,
  bar: number,
  bars: number,
  cut: Partial<Pose>,
  land: Partial<Pose>,
  drift: Partial<Pose>,
): Move[] {
  return [
    { at: grid.at(bar), ease: "cut", pose: cut },
    { at: grid.at(bar), dur: grid.beats(1.5), ease: "settle", pose: land },
    { at: grid.at(bar, 2.5), dur: bars * grid.BAR - grid.beats(1.5), ease: "glide", pose: drift },
  ];
}

/** The closing: the window drifts away under the end card. */
export function closing(grid: Grid, endBar: number): Move {
  return {
    at: grid.at(endBar - 1, 4),
    dur: grid.beats(2),
    ease: "glide",
    pose: { s: 0.6, rx: 24, ry: 26, rz: -3, z: -600, y: -60 },
  };
}

function progress(t: number, move: Move, fps: number, grid: Grid): number {
  if (move.ease === "cut") return 1;
  if (move.ease === "glide")
    return interpolate(t, [0, move.dur ?? grid.beats(1)], [0, 1], {
      ...clamp,
      easing: Easing.inOut(Easing.sin),
    });
  return spring({
    frame: t,
    fps,
    config: { damping: 200, stiffness: 80, mass: 1 },
    durationInFrames: move.dur,
  });
}

function poseAt(spec: TrailerSpec, frame: number, fps: number): Pose {
  let from = START;
  let pose = START;
  for (const move of spec.moves) {
    if (frame < move.at) break;
    const to = { ...from, ...move.pose };
    const p = progress(frame - move.at, move, fps, spec.grid);
    pose = Object.fromEntries(
      Object.keys(to).map((k) => {
        const key = k as keyof Pose;
        return [key, from[key] + (to[key] - from[key]) * p];
      }),
    ) as Pose;
    from = to;
  }
  return pose;
}

function shotAt(spec: TrailerSpec, frame: number): Shot {
  let shot = spec.shots[0]!;
  for (const s of spec.shots) if (frame >= s.start) shot = s;
  return shot;
}

/* ------------------------------------------------------------- the window */

function Content({ shot, fps }: { shot: Shot; fps: number }) {
  if ("still" in shot.source) return <Img src={shot.source.still} style={FULL} />;
  return (
    <Sequence from={shot.start} layout="none">
      <OffthreadVideo
        src={shot.source.video}
        trimBefore={Math.round(shot.source.from * fps)}
        playbackRate={shot.source.rate ?? 1}
        muted
        style={FULL}
      />
    </Sequence>
  );
}

function Window({ spec, frame, pose }: { spec: TrailerSpec; frame: number; pose: Pose }) {
  const shot = shotAt(spec, frame);
  const dark = shot.theme === "dark";
  const style: CSSProperties = {
    position: "absolute",
    left: 960 - pose.fx,
    top: 540 - pose.fy,
    width: WIN.w,
    height: WIN.h,
    transformOrigin: `${pose.fx}px ${pose.fy}px`,
    transform: `translate3d(${pose.x}px, ${pose.y}px, ${pose.z}px) rotateX(${pose.rx}deg) rotateY(${pose.ry}deg) rotateZ(${pose.rz}deg) scale(${pose.s})`,
    borderRadius: WIN.radius,
    overflow: "hidden",
    boxShadow: dark
      ? "0 60px 140px rgb(0 0 0 / 0.65), 0 0 0 1px rgb(255 255 255 / 0.10)"
      : "0 60px 140px rgb(40 20 60 / 0.35), 0 0 0 1px rgb(0 0 0 / 0.08)",
  };
  // A sheen that slides across the glass as the window turns.
  const sheen = 50 + pose.ry * 2.2;
  return (
    <div style={style}>
      <Content shot={shot} fps={spec.grid.fps} />
      {spec.overlay?.(shot, frame)}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `linear-gradient(115deg, transparent ${sheen - 22}%, rgb(255 255 255 / ${dark ? 0.07 : 0.18}) ${sheen}%, transparent ${sheen + 22}%)`,
          pointerEvents: "none",
        }}
      />
    </div>
  );
}

/* --------------------------------------------------------------- backdrop */

function Backdrop({ theme, frame, duration }: { theme: Theme; frame: number; duration: number }) {
  const drift = interpolate(frame, [0, duration], [1.08, 1.2]);
  return (
    <AbsoluteFill
      style={{ background: theme === "dark" ? "#08070c" : "#eef0f4", overflow: "hidden" }}
    >
      <Img
        src={staticFile(theme === "dark" ? "sunset-blur.png" : "sonoma-blur.png")}
        style={{
          width: "100%",
          height: "100%",
          maxWidth: "none",
          objectFit: "cover",
          transform: `scale(${drift}) rotate(${(drift - 1) * 12}deg)`,
          filter:
            theme === "dark" ? "brightness(0.34) saturate(1.2)" : "brightness(1.02) saturate(0.9)",
        }}
      />
      <AbsoluteFill
        style={{
          background:
            theme === "dark"
              ? "radial-gradient(ellipse at 60% 45%, transparent 30%, rgb(4 3 8 / 0.85) 100%)"
              : "radial-gradient(ellipse at 60% 45%, transparent 35%, rgb(255 255 255 / 0.55) 100%)",
        }}
      />
    </AbsoluteFill>
  );
}

/* --------------------------------------------------------------- captions */

/** Words come in on sixteenth notes: rising, sharpening out of a blur. */
function CaptionText({
  caption,
  theme,
  frame,
  grid,
}: {
  caption: Caption;
  theme: Theme;
  frame: number;
  grid: Grid;
}) {
  const { fps } = useVideoConfig();
  const out = interpolate(
    frame,
    [caption.to - grid.beats(1), caption.to - grid.beats(0.25)],
    [0, 1],
    {
      ...clamp,
      easing: Easing.in(Easing.quad),
    },
  );
  const words = caption.title.split(" ");
  const ink = theme === "dark" ? "255 255 255" : "20 16 32";
  const eyebrowIn = spring({ frame: frame - caption.from, fps, config: { damping: 200 } });
  return (
    <div
      style={{
        position: "absolute",
        left: 120,
        top: 400,
        width: 660,
        fontFamily: FONT,
        opacity: 1 - out,
        transform: `translateY(${-out * 24}px)`,
        filter: `blur(${out * 10}px)`,
      }}
    >
      <div
        style={{
          fontSize: 26,
          fontWeight: 600,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: theme === "dark" ? "#6cb4ff" : "#0a6ad6",
          opacity: eyebrowIn,
          transform: `translateX(${(1 - eyebrowIn) * -24}px)`,
          marginBottom: 18,
        }}
      >
        {caption.eyebrow}
      </div>
      <div style={{ fontSize: 80, fontWeight: 700, lineHeight: 1.04, letterSpacing: "-0.035em" }}>
        {keyed(words, 1).map(({ piece: word, key }, i) => {
          const p = spring({
            frame: frame - caption.from - grid.beats(0.25) * (i + 1),
            fps,
            config: { damping: 22, stiffness: 120 },
          });
          return (
            <span
              key={key}
              style={{
                display: "inline-block",
                marginRight: "0.24em",
                opacity: Math.min(1, p),
                transform: `translateY(${(1 - p) * 36}px)`,
                filter: `blur(${Math.max(0, 1 - p) * 14}px)`,
                backgroundImage: `linear-gradient(180deg, rgb(${ink}) 40%, rgb(${ink} / 0.72))`,
                WebkitBackgroundClip: "text",
                color: "transparent",
              }}
            >
              {word}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function Captions({ spec, theme, frame }: { spec: TrailerSpec; theme: Theme; frame: number }) {
  const { grid, captions, endBar } = spec;
  const caption = captions.find((c) => frame >= c.from && frame < c.to);
  const first = captions[0]?.from ?? 0;
  // A soft shade behind the words, so they read over the window.
  const shade =
    interpolate(frame, [first - grid.beats(1), first], [0, 1], clamp) *
    interpolate(frame, [grid.at(endBar - 1, 4), grid.at(endBar)], [1, 0], clamp);
  return (
    <>
      <AbsoluteFill
        style={{
          opacity: shade,
          background:
            theme === "dark"
              ? "linear-gradient(90deg, rgb(6 5 10 / 0.92) 0%, rgb(6 5 10 / 0.8) 30%, rgb(6 5 10 / 0.35) 46%, transparent 60%)"
              : "linear-gradient(90deg, rgb(255 255 255 / 0.92) 0%, rgb(255 255 255 / 0.8) 30%, rgb(255 255 255 / 0.35) 46%, transparent 60%)",
        }}
      />
      {caption && <CaptionText caption={caption} theme={theme} frame={frame} grid={grid} />}
    </>
  );
}

/** Keys as they're pressed: a row of keycaps, the newest lit. Shown from the first key until `until`. */
export function Keycaps({
  keys,
  until,
  frame,
  grid,
}: {
  keys: { at: number; key: string }[];
  until: number;
  frame: number;
  grid: Grid;
}) {
  const { fps } = useVideoConfig();
  if (keys.length === 0 || frame < keys[0]!.at - 2 || frame >= until) return null;
  const exit = interpolate(frame, [until - grid.beats(1), until - grid.beats(0.25)], [1, 0], clamp);
  const newest = keys.filter((k) => k.at <= frame).length - 1;
  return (
    <div
      style={{ position: "absolute", left: 124, top: 640, display: "flex", gap: 18, opacity: exit }}
    >
      {keys.map((k, i) => {
        if (frame < k.at) return null;
        const enter = spring({ frame: frame - k.at, fps, config: { damping: 16, stiffness: 200 } });
        const down = interpolate(frame - k.at, [0, 3, 14], [0, 1, 0], clamp);
        const lit = i === newest ? 1 : 0.45;
        return (
          <div
            key={k.at}
            style={{
              width: 108,
              height: 108,
              borderRadius: 26,
              fontFamily: FONT,
              fontSize: 54,
              fontWeight: 600,
              display: "grid",
              placeItems: "center",
              color: "#f4f4f8",
              background:
                "linear-gradient(180deg, rgb(255 255 255 / 0.16), rgb(255 255 255 / 0.05))",
              border: "1px solid rgb(255 255 255 / 0.22)",
              boxShadow: `0 ${14 - down * 10}px ${36 - down * 20}px rgb(0 0 0 / 0.45), inset 0 1px 0 rgb(255 255 255 / 0.25), 0 0 ${down * 60}px rgb(80 160 255 / ${down * 0.7})`,
              transform: `translateY(${down * 8 + (1 - enter) * 20}px) scale(${0.7 + enter * 0.3 - down * 0.04})`,
              opacity: Math.min(1, enter) * lit,
            }}
          >
            {k.key}
          </div>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------- the scene */

function Scene({ spec, frame }: { spec: TrailerSpec; frame: number }) {
  const { fps } = useVideoConfig();
  const pose = poseAt(spec, frame, fps);
  const theme = shotAt(spec, frame).theme;
  return (
    <AbsoluteFill>
      <Backdrop theme={theme} frame={frame} duration={spec.grid.durationInFrames} />
      <AbsoluteFill style={{ perspective: 2200 }}>
        <Window spec={spec} frame={frame} pose={pose} />
      </AbsoluteFill>
      <Captions spec={spec} theme={theme} frame={frame} />
      {spec.extras?.(frame, theme)}
    </AbsoluteFill>
  );
}

/**
 * The flip: the light half opens in a circle from the middle of the screen
 * over a beat, while the dark half holds its last frame around it.
 */
function Flip({
  at: flip,
  grid,
  children,
}: {
  at?: number;
  grid: Grid;
  children: (frame: number) => ReactNode;
}) {
  const frame = useCurrentFrame();
  if (flip === undefined) return <>{children(frame)}</>;
  const p = interpolate(frame, [flip, flip + grid.beats(1)], [0, 1], {
    ...clamp,
    easing: Easing.inOut(Easing.cubic),
  });
  const radius = p * 1250;
  if (p <= 0 || p >= 1) return <>{children(frame)}</>;
  return (
    <>
      {/* Frozen as a whole: its camera, overlays and a playing loop all hold the same frame. */}
      <Freeze frame={flip - 1}>{children(flip - 1)}</Freeze>
      <AbsoluteFill style={{ clipPath: `circle(${radius}px at 960px 540px)` }}>
        {children(frame)}
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          // A ring of light on the circle's edge.
          background: `radial-gradient(circle at 960px 540px, transparent ${radius - 40}px, rgb(255 255 255 / 0.45) ${radius}px, transparent ${radius + 6}px)`,
          mixBlendMode: "screen",
        }}
      />
    </>
  );
}

function Movie({ spec }: { spec: TrailerSpec }) {
  const frame = useCurrentFrame();
  // Under the end card once it's opaque.
  if (frame > spec.grid.at(spec.endBar) + 2) return null;
  return (
    <Flip at={spec.flip} grid={spec.grid}>
      {(f) => <Scene spec={spec} frame={f} />}
    </Flip>
  );
}

/* --------------------------------------------------------------- end card */

const SMALL = `Free and open source, for Mac and Windows · get${brand.shortName}.app`;

function EndCard({ spec }: { spec: TrailerSpec }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { at } = spec.grid;
  const END = spec.endBar;
  const show = interpolate(frame, [at(END - 1, 4), at(END)], [0, 1], clamp);
  if (show <= 0) return null;
  const draw = interpolate(frame, [at(END), at(END, 3)], [0, 1], {
    ...clamp,
    easing: Easing.inOut(Easing.cubic),
  });
  const fill = interpolate(frame, [at(END, 2.5), at(END, 3)], [0, 1], clamp);
  const pop = (start: number) =>
    spring({ frame: frame - start, fps, config: { damping: 11, stiffness: 170 } });
  const nearSail = pop(at(END, 3));
  const farSail = pop(at(END, 3.5));
  const hull = pop(at(END, 4));
  const glow = interpolate(frame - at(END, 4), [0, 4, 40], [0, 1, 0.25], clamp);
  const letters = brand.name.split("");
  const reveal = (start: number) =>
    spring({ frame: frame - start, fps, config: { damping: 20, stiffness: 120 } });
  const tagline = reveal(at(END + 1, 3));
  const small = reveal(at(END + 2));
  return (
    <AbsoluteFill style={{ opacity: show, fontFamily: FONT, color: "#f4f4f8" }}>
      <AbsoluteFill
        style={{
          background: "radial-gradient(ellipse at 50% 42%, #191628 0%, #09080e 60%, #040306 100%)",
        }}
      />
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at 50% 36%, rgb(10 132 255 / ${0.28 * glow + 0.06 * fill}) 0%, transparent 30%)`,
        }}
      />
      <svg
        viewBox="0 0 1024 1024"
        width={260}
        height={260}
        style={{ position: "absolute", left: 830, top: 250, overflow: "visible" }}
      >
        <rect
          x={100}
          y={100}
          width={824}
          height={824}
          rx={186}
          fill="#0d0f14"
          fillOpacity={fill}
          stroke="#ffffff"
          strokeOpacity={0.9 - fill * 0.77}
          strokeWidth={6}
          pathLength={1}
          strokeDasharray={1}
          strokeDashoffset={1 - draw}
        />
        <g style={{ transformOrigin: "512px 590px", transform: `scale(${farSail})` }}>
          <path d="M 512 282 L 674 590 L 512 590 Z" fill="#064f99" />
        </g>
        <g style={{ transformOrigin: "512px 590px", transform: `scale(${nearSail})` }}>
          <path d="M 512 282 L 512 590 L 350 590 Z" fill="#086acc" />
        </g>
        <g
          style={{
            transform: `translateY(${(1 - hull) * 220}px)`,
            opacity: Math.min(1, hull * 1.5),
          }}
        >
          <path d="M 170 570 L 854 570 L 709 750 L 315 750 Z" fill="#0a84ff" />
        </g>
      </svg>
      <div
        style={{
          position: "absolute",
          top: 560,
          width: "100%",
          textAlign: "center",
          fontSize: 120,
          fontWeight: 700,
          letterSpacing: "-0.04em",
        }}
      >
        {keyed(letters, 0).map(({ piece: letter, key }, i) => {
          const p = reveal(at(END + 1) + i * 3);
          return (
            <span
              key={key}
              style={{
                display: "inline-block",
                opacity: Math.min(1, p),
                transform: `translateY(${(1 - p) * 50}px)`,
                filter: `blur(${Math.max(0, 1 - p) * 16}px)`,
              }}
            >
              {letter}
            </span>
          );
        })}
      </div>
      <div
        style={{
          position: "absolute",
          top: 720,
          width: "100%",
          textAlign: "center",
          fontSize: 44,
          fontWeight: 500,
          letterSpacing: "-0.015em",
          color: "rgb(244 244 248 / 0.86)",
          opacity: tagline,
          transform: `translateY(${(1 - tagline) * 24}px)`,
          filter: `blur(${(1 - tagline) * 8}px)`,
        }}
      >
        {spec.tagline}
      </div>
      <div
        style={{
          position: "absolute",
          top: 812,
          width: "100%",
          textAlign: "center",
          fontSize: 26,
          fontWeight: 500,
          letterSpacing: "0.01em",
          color: "rgb(244 244 248 / 0.5)",
          opacity: small,
        }}
      >
        {SMALL}
      </div>
    </AbsoluteFill>
  );
}

/* ---------------------------------------------------------------- trailer */

export function TrailerFrame({ spec, music }: { spec: TrailerSpec; music: string | null }) {
  const frame = useCurrentFrame();
  const { durationInFrames: duration, BAR, trackStart, fps, beats } = spec.grid;
  const fadeIn = interpolate(frame, [0, 24], [1, 0], { extrapolateRight: "clamp" });
  const fadeOut = interpolate(frame, [duration - beats(2), duration - 1], [0, 1], {
    extrapolateLeft: "clamp",
  });
  return (
    <AbsoluteFill style={{ background: "#040306" }}>
      <CameraMotionBlur shutterAngle={180} samples={6}>
        <Movie spec={spec} />
      </CameraMotionBlur>
      <EndCard spec={spec} />
      <AbsoluteFill style={{ background: "#040306", opacity: Math.max(fadeIn, fadeOut) }} />
      {music && (
        <Audio
          src={staticFile(music)}
          trimBefore={Math.round(trackStart * fps)}
          volume={(f) =>
            interpolate(f, [duration - BAR, duration - 1], [1, 0], { extrapolateLeft: "clamp" })
          }
        />
      )}
    </AbsoluteFill>
  );
}
