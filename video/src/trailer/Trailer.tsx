/**
 * The main trailer (the owner's brief, 2026-11-22): the inbox, summaries,
 * the keyboard, Write with AI, sign-in codes and the command palette. Each
 * view arrives with one move on a downbeat and holds for the rest of its
 * bar (a bar and a half for the keys and for Write with AI); the opening
 * holds for two, the end card for three. The flip to light comes with the
 * track's full groove.
 *
 * The window is 2x pictures and loops of demo mode (made-up mail) from
 * video/capture.sh. Drawn here, over them: the selection moving and a row
 * leaving the list, and the summary writing in.
 */
import { Easing, Img, interpolate, staticFile } from "remotion";
import { clamp, closing, FULL, Keycaps, opening, view, WIN } from "../kit/TrailerKit";
import type { Shot, TrailerSpec } from "../kit/TrailerKit";
import { TrailerFrame } from "../kit/TrailerKit";
import { at, grid } from "./beats";

/** The 2x takes of the demo (video/capture.sh; video/public/rec/, not in git). */
const TAKE = {
  inbox: staticFile("rec/inbox-dark.png"),
  conversation: staticFile("rec/conversation-dark.png"),
  codes: staticFile("rec/codes-light.png"),
  palette: staticFile("rec/palette-light.mp4"),
  replyAi: staticFile("rec/reply-ai.mp4"),
};

const SHOTS: Shot[] = [
  { start: 0, theme: "dark", source: { still: TAKE.inbox }, name: "inbox" },
  { start: at(3), theme: "dark", source: { still: TAKE.conversation }, name: "summary" },
  { start: at(4), theme: "dark", source: { still: TAKE.inbox }, name: "keyboard" },
  // Reply opens at 1.77 s, the AI panel at 4.13 s, the request goes at
  // 6.5 s, the draft is in by 7.9 s. At 1.8x the cut lands on Reply, the
  // panel on the music's hit (bar 6), and the draft just before the groove.
  {
    start: at(5, 3),
    theme: "dark",
    source: { video: TAKE.replyAi, from: 1.72, rate: 1.8 },
    name: "write",
  },
  { start: at(7), theme: "light", source: { still: TAKE.codes }, name: "codes" },
  // ⌘K opens at 2.07 s and "arch" is typed from 3.57 s: at 1.8x the palette
  // opens on the downbeat and the letters land on eighth notes.
  {
    start: at(8),
    theme: "light",
    source: { video: TAKE.palette, from: 1.9, rate: 1.8 },
    name: "palette",
  },
];

const END = 9;

const MOVES = [
  // Bars 1–2, the end of the track's soft opening: the window rises in, lands, and holds.
  ...opening(grid, at(3)),
  // Bar 3, where the beats come in: one view per bar.
  ...view(
    grid,
    3,
    1,
    { fx: 1000, fy: 185, s: 1.7, rx: 12, ry: 12, rz: 0, x: 300, y: 120, z: 0 },
    { s: 2.0, rx: 6, ry: 6 },
    { s: 2.08, ry: 3 },
  ),
  ...view(
    grid,
    4,
    1.5,
    { fx: 600, fy: 280, s: 1.15, rx: 10, ry: 24, x: 380, y: 60 },
    { s: 1.35, ry: 12 },
    { s: 1.4, ry: 8 },
  ),
  // Halfway through bar 5, Reply; the AI panel opens on the track's hit (bar 6),
  // and the draft arrives during its hold.
  ...view(
    grid,
    5.5,
    1.5,
    { fx: 1040, fy: 590, s: 1.3, rx: 12, ry: -20, x: 300, y: 140 },
    { s: 1.5, rx: 6, ry: -10, y: 160 },
    { s: 1.56, ry: -7 },
  ),
  // Bar 7, the full groove, in light.
  ...view(
    grid,
    7,
    1,
    { fx: 1253, fy: 92, s: 1.6, rx: 12, ry: -18, x: 300, y: 80 },
    { s: 2.2, rx: 6, ry: -8 },
    { s: 2.28, ry: -5 },
  ),
  ...view(
    grid,
    8,
    1,
    { fx: 713, fy: 332, s: 1.2, rx: 12, ry: 18, x: 300, y: 0 },
    { s: 1.45, rx: 5, ry: 8 },
    { s: 1.5, ry: 6 },
  ),
  closing(grid, END),
];

/* -------------------------------------------------------------- the keys */

/** The list's rows in the inbox picture (window pixels). */
const LIST = { x: 234, y: 81, w: 1181, h: 731, row: 72 };
/** The keys pressed in the list, on the beat after a beat to look. */
const KEYS = [
  { at: at(4, 2), key: "K" },
  { at: at(4, 3), key: "K" },
  { at: at(4, 4), key: "J" },
  { at: at(5, 1), key: "E" },
];
/**
 * Measured in the inbox picture: the list's color behind the rows, the
 * selected row's highlight (its color minus the rows' on either side, per
 * channel), and the highlight drawn where the selection moves.
 */
const LIST_BACKGROUND = "linear-gradient(rgb(40 33 53), rgb(47 34 55))";
const HIGHLIGHT_LIFT = { r: 23, g: 24, b: 22 };
const SELECTION = "rgb(255 255 255 / 0.11)";
/** The row the picture has selected, the selected row after each key, and the row E archives. */
const BAKED_ROW = 2;
const SELECTED = [1, 0, 1, 1];
const ARCHIVED_ROW = 1;
const ARCHIVED_AT = KEYS[3]!.at;

/** The selection's place in the list (in rows), moving quickly to each new row. */
function selectionAt(frame: number): number {
  let slot = BAKED_ROW;
  KEYS.forEach((k, i) => {
    const p = interpolate(frame, [k.at, k.at + 7], [0, 1], {
      ...clamp,
      easing: Easing.out(Easing.cubic),
    });
    slot += (SELECTED[i]! - (i === 0 ? BAKED_ROW : SELECTED[i - 1]!)) * p;
  });
  return slot;
}

/**
 * The inbox while the keys are pressed: each row is a strip of the picture,
 * the selection moves over them, and the row archived slides out while those
 * below move up into its place. The picture has a row selected (BAKED_ROW),
 * so that row's highlight is lifted off (a filter taking the highlight's
 * color back out) once the selection leaves it.
 */
function KeyboardRows({ src, frame }: { src: string; frame: number }) {
  const rows = Array.from({ length: 10 }, (_, i) => i);
  const slide = interpolate(frame, [ARCHIVED_AT, ARCHIVED_AT + 12], [0, 1], {
    ...clamp,
    easing: Easing.in(Easing.cubic),
  });
  const gone = interpolate(frame, [ARCHIVED_AT + 6, ARCHIVED_AT + 18], [0, 1], {
    ...clamp,
    easing: Easing.out(Easing.cubic),
  });
  const unselect = interpolate(frame, [KEYS[0]!.at, KEYS[0]!.at + 5], [0, 1], clamp);
  return (
    <div
      style={{
        position: "absolute",
        left: LIST.x,
        top: LIST.y,
        width: LIST.w,
        height: LIST.h,
        overflow: "hidden",
        background: LIST_BACKGROUND,
      }}
    >
      <svg width={0} height={0} style={{ position: "absolute" }}>
        <filter id="unselect" colorInterpolationFilters="sRGB">
          <feComponentTransfer>
            <feFuncR type="linear" slope={1} intercept={-HIGHLIGHT_LIFT.r / 255} />
            <feFuncG type="linear" slope={1} intercept={-HIGHLIGHT_LIFT.g / 255} />
            <feFuncB type="linear" slope={1} intercept={-HIGHLIGHT_LIFT.b / 255} />
          </feComponentTransfer>
        </filter>
      </svg>
      {rows.map((i) => {
        const out = i === ARCHIVED_ROW ? slide : 0;
        if (out >= 1) return null;
        const lift = i > ARCHIVED_ROW ? gone : 0;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: 0,
              top: (i - lift) * LIST.row,
              width: LIST.w,
              height: LIST.row,
              overflow: "hidden",
              transform: `translateX(${-out * 1250}px)`,
              opacity: 1 - out * 0.6,
            }}
          >
            <Img
              src={src}
              style={{ ...FULL, left: -(WIN.x + LIST.x), top: -(WIN.y + LIST.y + i * LIST.row) }}
            />
            {i === BAKED_ROW && (
              <div
                style={{
                  position: "absolute",
                  left: 7,
                  top: 0,
                  width: LIST.w - 14,
                  height: 68,
                  borderRadius: 8,
                  overflow: "hidden",
                  opacity: unselect,
                }}
              >
                <Img
                  src={src}
                  style={{
                    ...FULL,
                    left: -(WIN.x + LIST.x + 7),
                    top: -(WIN.y + LIST.y + i * LIST.row),
                    filter: "url(#unselect)",
                  }}
                />
              </div>
            )}
          </div>
        );
      })}
      {unselect > 0 && (
        <div
          style={{
            position: "absolute",
            left: 7,
            top: selectionAt(frame) * LIST.row,
            width: LIST.w - 14,
            height: 68,
            borderRadius: 8,
            background: SELECTION,
            opacity: unselect,
          }}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------- the summary */

/**
 * The summary's three lines (window pixels: their tops, where their text
 * starts and how wide it runs) and the card's color behind each, written in
 * on eighth notes after the view lands.
 */
const SUMMARY_LINES = [165, 189, 212];
const SUMMARY_TEXT = { left: 672, width: 736, height: 22 };
const SUMMARY_CARD = ["rgb(61 52 80)", "rgb(62.5 52 80.5)", "rgb(64 52 81)"];

function SummaryWriting({ frame }: { frame: number }) {
  return (
    <>
      {SUMMARY_LINES.map((top, i) => {
        const start = at(3, 1.5 + i * 0.5);
        const p = interpolate(frame, [start, start + 16], [0, 1], {
          ...clamp,
          easing: Easing.out(Easing.quad),
        });
        if (p >= 1) return null;
        return (
          <div
            key={top}
            style={{
              position: "absolute",
              left: SUMMARY_TEXT.left + p * SUMMARY_TEXT.width,
              top,
              width: SUMMARY_TEXT.width * (1 - p),
              height: SUMMARY_TEXT.height,
              background: SUMMARY_CARD[i],
              // A soft leading edge, like text arriving.
              maskImage: "linear-gradient(90deg, transparent, black 40px)",
            }}
          />
        );
      })}
    </>
  );
}

/* --------------------------------------------------------------- the spec */

export const MAIN: TrailerSpec = {
  grid,
  shots: SHOTS,
  moves: MOVES,
  // Each comes in a beat after its view lands and leaves before the next.
  captions: [
    { from: at(1, 3), to: at(3), eyebrow: "Unified inbox", title: "One inbox for all your Gmail" },
    { from: at(3, 1.5), to: at(4), eyebrow: "Summaries", title: "The gist of a long conversation" },
    {
      from: at(4, 1.5),
      to: at(5, 3),
      eyebrow: "Keyboard first",
      title: "J and K to move, E to archive",
    },
    { from: at(5, 4), to: at(7), eyebrow: "Write with AI", title: "A first draft of your reply" },
    { from: at(7, 1.5), to: at(8), eyebrow: "Sign-in codes", title: "Copy the code in one click" },
    {
      from: at(8, 1.5),
      to: at(9),
      eyebrow: "Command palette",
      title: "Actions and places, from ⌘K",
    },
  ],
  flip: at(7),
  endBar: END,
  tagline: "All your Gmail accounts, in one calm inbox.",
  overlay: (shot, frame) => {
    if (shot.name === "keyboard" && "still" in shot.source)
      return <KeyboardRows src={shot.source.still} frame={frame} />;
    if (shot.name === "summary") return <SummaryWriting frame={frame} />;
    return null;
  },
  extras: (frame) => <Keycaps keys={KEYS} until={at(5, 3)} frame={frame} grid={grid} />,
};

export function Trailer({ music }: { music: string | null }) {
  return <TrailerFrame spec={MAIN} music={music} />;
}
