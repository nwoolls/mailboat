/**
 * Swipe to archive, up close (the owner's brief, 2026-11-21): the row slides
 * and the button grows out of it as one shape, necks and snaps apart, joins
 * and parts again, then the ring fills until the button lights up.
 *
 * Drawn with the app's own SwipeBack and SwipeButton, posed by its own
 * swipePose(): only the finger is scripted (TRAVEL), so the clip can't drift
 * from what the app does. The rows are made-up demo mail.
 */
import type { CSSProperties } from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  Img,
} from "remotion";
import "../../src/styles/index.css";
import "./video.css";
import { SwipeBack, SwipeButton } from "../../src/features/mailbox/ui/SwipeLayers";
import { swipePose } from "../../src/features/mailbox/model/swipe";
import { DEFAULT_LIST_PREFS, rowStep } from "../../src/features/mailbox/model/listPrefs";
import { AiIcon, AttachmentIcon, StarIcon } from "../../src/shared/ui/icons";

/** The snap and the light-up, slowed this many times. */
const SLOW = 4;
const SNAP_SECONDS = 0.32;
const WASH_SECONDS = 0.2;

/**
 * The finger's travel (px) at each second; eased between. Reference points
 * from swipe.ts: the shapes split at about 116, separate at 120, the ring
 * starts at 143 and the button arms at 195.
 */
const TRAVEL: [number, number][] = [
  [0, 0],
  [1.2, 0],
  [4.2, 112], // the row slides, the button grows out of it as one shape
  [6.2, 126], // slowly through the neck: it thins, lets go, springs
  [7.4, 126],
  [8.6, 108], // back: they join again
  [9.6, 108],
  [10.8, 128], // and part again
  [11.6, 128],
  [15.4, 200], // the ring fills, and the button lights up
];
export const DURATION_SECONDS = 18;

function travelAt(t: number): number {
  for (let i = 1; i < TRAVEL.length; i++) {
    const [t1, d1] = TRAVEL[i]!;
    const [t0, d0] = TRAVEL[i - 1]!;
    if (t <= t1) {
      return interpolate(t, [t0, t1], [d0, d1], {
        easing: Easing.inOut(Easing.cubic),
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
    }
  }
  return TRAVEL[TRAVEL.length - 1]![1];
}

/** Seconds since `test` last became true (Infinity if it isn't now). */
function since(t: number, fps: number, test: (d: number) => boolean): number {
  if (!test(travelAt(t))) return Number.POSITIVE_INFINITY;
  let f = Math.round(t * fps);
  while (f > 0 && test(travelAt((f - 1) / fps))) f--;
  return t - f / fps;
}

const isSeparated = (d: number) => swipePose(d).separated;
const isArmed = (d: number) => swipePose(d).armed;

type Row = {
  sender: string;
  count?: number;
  time: string;
  subject: string;
  line: string;
  unread?: boolean;
  starred?: boolean;
  attachment?: boolean;
  color: string;
  code?: string;
};

const BLUE = "#5b8def";
const ORANGE = "#e07b53";
const ROWS: Row[] = [
  {
    sender: "Harbor Bank",
    time: "5:08 PM",
    subject: "Your Harbor Bank sign-in code",
    line: "Sign-in code",
    unread: true,
    color: BLUE,
    code: "482913",
  },
  {
    sender: "Jordan Park",
    time: "4:43 PM",
    subject: "Lunch?",
    line: "Jordan asks if you're up for noodles at 12:30.",
    unread: true,
    color: ORANGE,
  },
  {
    sender: "Maya",
    count: 5,
    time: "4:28 PM",
    subject: "Lisbon in May?",
    line: "Maya found cheap flights the week of 16 May and wants to book the Alfama apartment by Friday.",
    unread: true,
    starred: true,
    attachment: true,
    color: BLUE,
  },
  {
    sender: "Trellis",
    time: "4:18 PM",
    subject: 'Ben moved "Menu cards" to Done',
    line: 'Ben moved "Menu cards" to Done on the Fernhill board.',
    color: ORANGE,
  },
  {
    sender: "Lena",
    count: 3,
    time: "4:08 PM",
    subject: "Fernhill rebrand: round 2 feedback",
    line: "Lena's team picked direction B; she'd like the leaf as a stamp for the paper bags too.",
    unread: true,
    starred: true,
    attachment: true,
    color: ORANGE,
  },
  {
    sender: "Priya Raman",
    time: "3:08 PM",
    subject: "Invitation: Quarterly planning",
    line: "Priya invites you to quarterly planning tomorrow, 10–11:30, at the studio.",
    unread: true,
    attachment: true,
    color: ORANGE,
  },
  {
    sender: "Ana Rivera",
    time: "2:08 PM",
    subject: "Sunday dinner",
    line: "Mom asks if you can come to Sunday dinner at 6 and bring dessert.",
    unread: true,
    color: BLUE,
  },
];
/** The row that is swiped. */
const SWIPED = 2;

const PANEL = { x: 560, y: 150, width: 800, height: 780 };
const ICON_COLUMN = 18;

function RowContent({ row }: { row: Row }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <div className="relative flex items-center gap-2" style={{ paddingLeft: ICON_COLUMN }}>
        {row.unread && (
          <span className="absolute top-1/2 -left-3.5 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-accent" />
        )}
        <span
          className="absolute top-1/2 left-0.5 h-2 w-2 -translate-y-1/2 rounded-full"
          style={{ border: `1.5px solid color-mix(in srgb, ${row.color} 75%, transparent)` }}
        />
        <span className="truncate">
          <span
            className={row.unread ? "font-semibold text-content" : "font-medium text-content/75"}
          >
            {row.sender}
          </span>
          {row.count && (
            <>
              <span className="text-content/60">, </span>
              <span className="font-medium text-content/75">me</span>
              <span className="ml-1.5 text-xs font-normal text-content/45">{row.count}</span>
            </>
          )}
        </span>
        <span className="ml-auto shrink-0 text-xs text-content/40">{row.time}</span>
      </div>
      <div
        className={`relative flex min-w-0 items-center ${row.unread ? "font-semibold text-content" : "font-medium text-content/70"}`}
        style={{ paddingLeft: ICON_COLUMN }}
      >
        {row.attachment && (
          <AttachmentIcon
            size={11}
            strokeWidth={2}
            className="absolute top-1/2 -left-4 -translate-y-1/2 text-content/35"
          />
        )}
        {row.starred && (
          <StarIcon
            size={12}
            strokeWidth={2}
            className="absolute top-1/2 left-0 -translate-y-1/2 text-warn"
          />
        )}
        <span className="truncate">{row.subject}</span>
        {row.code && (
          <span className="ml-2 shrink-0 rounded bg-accent/15 px-1.5 font-mono text-[11px] text-accent">
            {row.code}
          </span>
        )}
      </div>
      <div
        className="relative truncate text-xs font-medium text-content/40"
        style={{ paddingLeft: ICON_COLUMN }}
      >
        <AiIcon
          size={10}
          strokeWidth={2}
          className="absolute top-1/2 left-px -translate-y-1/2 text-accent/70"
        />
        {row.line}
      </div>
    </div>
  );
}

export function SwipeArchive() {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const t = frame / fps;
  const d = travelAt(t);
  const pose = swipePose(d);

  const snap = Math.min(since(t, fps, isSeparated) / SLOW, SNAP_SECONDS);
  const wash = Math.min(since(t, fps, isArmed) / SLOW, WASH_SECONDS);

  const step = rowStep(DEFAULT_LIST_PREFS);
  const rowHeight = step - 4;
  const rowWidth = PANEL.width - 16;
  const top = (i: number) => 44 + i * step;

  // The camera: from the whole list to the end of the swiped row, where
  // the button comes out. `focus` is a point on the stage, kept centered.
  const zoom = interpolate(t, [0.3, 3.6], [1.05, 2.6], {
    easing: Easing.inOut(Easing.cubic),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const toward = interpolate(t, [0.3, 3.6], [0, 1], {
    easing: Easing.inOut(Easing.cubic),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const target = { x: PANEL.x + 8 + rowWidth - 270, y: PANEL.y + top(SWIPED) + rowHeight / 2 };
  const start = { x: PANEL.x + PANEL.width / 2, y: PANEL.y + PANEL.height / 2 };
  const focus = {
    x: start.x + (target.x - start.x) * toward,
    y: start.y + (target.y - start.y) * toward,
  };
  const fade = interpolate(
    frame,
    [0, 12, durationInFrames - 30, durationInFrames - 1],
    [0, 1, 1, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );

  const clock = {
    "--snap": Number.isFinite(snap) ? snap : SNAP_SECONDS,
    "--wash": Number.isFinite(wash) ? wash : 0,
    "--wash-to": pose.armed ? 1 : 0,
  } as CSSProperties;

  return (
    <AbsoluteFill className="clip overflow-hidden bg-black" style={{ ...clock, opacity: fade }}>
      <div
        className="absolute inset-0 origin-top-left"
        style={{
          transform: `translate(${960 - focus.x * zoom}px, ${540 - focus.y * zoom}px) scale(${zoom})`,
        }}
      >
        <Img
          src={staticFile("sunset.png")}
          className="absolute inset-0 h-full w-full object-cover"
        />
        {/* The window: the macOS blur behind it, which the app's glass tints. */}
        <div
          className="absolute overflow-hidden rounded-[14px]"
          style={{
            left: PANEL.x - 220,
            top: PANEL.y - 60,
            width: PANEL.width + 260,
            height: PANEL.height + 100,
            boxShadow: "0 30px 80px rgb(0 0 0 / 0.45)",
          }}
        >
          <Img
            src={staticFile("sunset-blur.png")}
            className="absolute"
            style={{
              left: -(PANEL.x - 220),
              top: -(PANEL.y - 60),
              width: 1920,
              height: 1080,
              maxWidth: "none",
            }}
          />
          <div className="absolute inset-0 bg-black/20" />
          <div className="absolute inset-0 bg-glass-sidebar" />
        </div>
        <div
          className="absolute rounded-xl bg-glass-panel text-sm text-content"
          style={{ left: PANEL.x, top: PANEL.y, width: PANEL.width, height: PANEL.height }}
        >
          <div className="px-4 pt-3 text-sm font-semibold">Inbox</div>
          {ROWS.map((row, i) => {
            const swiped = i === SWIPED;
            return (
              <div key={row.subject}>
                {swiped && (
                  <div
                    className="absolute inset-x-0 mx-2"
                    style={{ top: top(i), height: rowHeight }}
                  >
                    <SwipeBack
                      pose={pose}
                      side="left"
                      width={rowWidth}
                      height={rowHeight}
                      selected={false}
                    />
                  </div>
                )}
                <div
                  className="absolute inset-x-0 mx-2 flex flex-col justify-center gap-0.5 rounded-lg pr-3 pl-6"
                  style={{
                    top: top(i),
                    height: rowHeight,
                    transform: swiped ? `translateX(${-pose.shift}px)` : undefined,
                  }}
                >
                  <RowContent row={row} />
                </div>
                {swiped && (
                  <div
                    className="absolute inset-x-0 mx-2"
                    style={{ top: top(i), height: rowHeight }}
                  >
                    <SwipeButton
                      pose={pose}
                      side="left"
                      height={rowHeight}
                      action={{ kind: "archive", archived: true }}
                      open={false}
                      onCommit={() => {}}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
}
