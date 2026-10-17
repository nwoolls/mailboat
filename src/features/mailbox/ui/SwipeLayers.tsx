import { useId } from "react";
import { ArchiveIcon, MarkUnreadIcon, TrashIcon, UnreadIcon } from "../../../shared/ui/icons";
import { SWIPE, type SwipePose, type SwipeSide, swipeLabel } from "../model/swipe";
import type { ThreadAction } from "../model/threadActions";

/** The row's corner radius (rounded-lg); the button shares it. */
const RADIUS = 8;

type Geometry = {
  pose: SwipePose;
  side: SwipeSide;
  /** The row's size. */
  width: number;
  height: number;
};

/**
 * Behind a swiped row: its plate and the button growing out of it, drawn
 * as one soft shape. A "goo" filter (blur, then a sharp alpha cut) makes
 * the two melt together while they overlap and pull apart with a neck
 * that thins and snaps as they separate. Drawn in the text colour at the
 * selection's strength, so it's the app's own quiet fill, not a colour.
 */
export function SwipeBack({
  pose,
  side,
  width,
  height,
  selected,
}: Geometry & { selected: boolean }) {
  const filter = useId();
  const left = side === "left";
  return (
    <svg
      aria-hidden
      width={width}
      height={height}
      className="pointer-events-none absolute inset-0 overflow-visible text-content"
      style={{ opacity: selected ? 0.12 : 0.08 }}
    >
      <defs>
        <filter
          id={filter}
          filterUnits="userSpaceOnUse"
          x={-width}
          y={-height}
          width={width * 3}
          height={height * 3}
        >
          <feGaussianBlur stdDeviation="5" />
          <feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -10" />
        </filter>
      </defs>
      <g filter={`url(#${filter})`} fill="currentColor">
        {pose.joined ? (
          // Not fully uncovered: row and button are one shape, so the row
          // just looks longer, with no corners between them.
          <rect
            x={left ? -pose.shift : 0}
            y={0}
            width={width + pose.shift}
            height={height}
            rx={RADIUS}
          />
        ) : (
          <>
            <rect
              x={left ? -pose.shift : pose.shift}
              y={0}
              width={width}
              height={height}
              rx={RADIUS}
            />
            {/* The button, its own shape now: the blur necks the join, then
                lets go, and the button springs back a little (re-keyed so
                the snap plays as it separates). */}
            <rect
              key={pose.separated ? "apart" : "necking"}
              className={pose.separated ? "swipe-snap" : undefined}
              style={{ transformOrigin: left ? "right center" : "left center" }}
              x={left ? width - SWIPE.capsule : 0}
              y={0}
              width={SWIPE.capsule}
              height={height}
              rx={RADIUS}
            />
          </>
        )}
      </g>
    </svg>
  );
}

/**
 * The button over the bud: icon in a ring that fills towards doing the
 * action, the word fading in as it breaks away. Armed, it takes a soft
 * accent wash and grows a touch. Clickable once the swipe rests open.
 */
export function SwipeButton({
  pose,
  side,
  height,
  action,
  open,
  onCommit,
}: Omit<Geometry, "width"> & { action: ThreadAction; open: boolean; onCommit: () => void }) {
  const r = 11;
  const around = 2 * Math.PI * r;
  return (
    <button
      type="button"
      data-swipe-button
      tabIndex={-1}
      aria-label={swipeLabel(action)}
      onClick={(e) => {
        e.stopPropagation();
        if (open) onCommit();
      }}
      // Only the uncovered part shows; what's inside keeps the button's
      // full width, so it's revealed rather than squeezed.
      className={`absolute overflow-hidden whitespace-nowrap ${
        open ? "pointer-events-auto cursor-pointer" : "pointer-events-none"
      }`}
      style={{
        top: 0,
        height,
        width: pose.budWidth,
        [side === "left" ? "right" : "left"]: 0,
      }}
    >
      <span
        key={pose.separated ? "apart" : "joined"}
        className={`absolute inset-y-0 flex items-center justify-center rounded-lg px-3 ${
          pose.separated ? "swipe-snap" : ""
        }`}
        style={{
          width: SWIPE.capsule,
          [side === "left" ? "right" : "left"]: 0,
          transformOrigin: side === "left" ? "right center" : "left center",
        }}
      >
        <span
          aria-hidden
          className="absolute inset-0 rounded-lg bg-accent/20 transition-[opacity,transform] duration-200 ease-[cubic-bezier(.3,1.6,.5,1)]"
          style={{ opacity: pose.armed ? 1 : 0, transform: `scale(${pose.armed ? 1 : 0.85})` }}
        />
        <span
          className={`relative flex items-center gap-1.5 transition-[color,transform] duration-200 ease-[cubic-bezier(.3,1.6,.5,1)] ${
            pose.armed ? "text-accent" : "text-content/70"
          }`}
          style={{ opacity: pose.label, transform: `scale(${pose.armed ? 1.06 : 1})` }}
        >
          <span className="relative flex h-6 w-6 items-center justify-center">
            <svg aria-hidden width={26} height={26} className="absolute -rotate-90">
              <circle
                cx={13}
                cy={13}
                r={r}
                fill="none"
                stroke="currentColor"
                strokeOpacity={0.15}
              />
              <circle
                cx={13}
                cy={13}
                r={r}
                fill="none"
                stroke="var(--color-accent)"
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeDasharray={`${around * pose.ring} ${around}`}
                opacity={pose.ring > 0 ? 1 : 0}
              />
            </svg>
            <ActionIcon action={action} />
          </span>
          <span className="text-xs font-medium">{swipeLabel(action)}</span>
        </span>
      </span>
    </button>
  );
}

function ActionIcon({ action }: { action: ThreadAction }) {
  if (action.kind === "archive") return <ArchiveIcon size={13} />;
  if (action.kind === "trash") return <TrashIcon size={13} />;
  return action.kind === "read" && action.read ? (
    <MarkUnreadIcon size={13} />
  ) : (
    <UnreadIcon size={13} />
  );
}
