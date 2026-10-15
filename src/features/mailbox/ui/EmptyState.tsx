import { useEffect, useRef } from "react";
import {
  ArchiveIcon,
  DraftIcon,
  type IconProps,
  ImportantIcon,
  LabelIcon,
  SearchIcon,
  SentIcon,
  SpamIcon,
  StarIcon,
  ThumbsUpIcon,
  TrashIcon,
} from "../../../shared/ui/icons";
import type { EmptyIcon, EmptyState as EmptyStateModel } from "../model/emptyState";
import { approach, GLOW_FOLLOW_SECONDS, GLOW_RETURN_SECONDS } from "../model/glow";

const ICONS: Record<EmptyIcon, (props: IconProps) => React.ReactNode> = {
  caughtUp: ThumbsUpIcon,
  search: SearchIcon,
  star: StarIcon,
  important: ImportantIcon,
  sent: SentIcon,
  draft: DraftIcon,
  spam: SpamIcon,
  trash: TrashIcon,
  archive: ArchiveIcon,
  label: LabelIcon,
};

/** How far the glow is drawn towards the pointer (1 = right under it). */
const PULL = 0.85;

/**
 * What an empty list shows: an icon, a line of copy and a drifting glow.
 * With the pointer over the pane the glow is drawn towards it (still
 * drifting); when the pointer leaves it eases back to its usual path.
 */
export function EmptyState({ state }: { state: EmptyStateModel }) {
  const Icon = ICONS[state.icon];
  const { ref, attract, release } = useGlowPull();
  return (
    <div
      className="relative flex flex-1 items-center justify-center overflow-hidden px-8"
      onPointerMove={attract}
      onPointerLeave={release}
    >
      <div ref={ref} aria-hidden className="empty-glow-pull">
        <div className="empty-glow" />
      </div>
      <div className="empty-rise relative flex max-w-xs flex-col items-center text-center">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-selection-subtle text-content/80 ring-1 ring-stroke">
          <span className={state.icon === "caughtUp" ? "empty-nod" : undefined}>
            <Icon size={26} strokeWidth={1.5} />
          </span>
        </div>
        <p className="text-[15px] font-semibold">{state.title}</p>
        {state.detail && <p className="mt-1 text-content/60">{state.detail}</p>}
      </div>
    </div>
  );
}

/**
 * Moves the glow's wrapper towards a target once per animation frame and
 * stops when it arrives. Pointer moves only update the target, so there's
 * no React re-render and no restarted transition (which stuttered).
 */
function useGlowPull() {
  const ref = useRef<HTMLDivElement>(null);
  const motion = useRef({ x: 0, y: 0, tx: 0, ty: 0, attracted: false, frame: 0, last: 0 });

  useEffect(() => {
    const m = motion.current;
    return () => cancelAnimationFrame(m.frame);
  }, []);

  const tick = (now: number) => {
    const m = motion.current;
    const el = ref.current;
    if (!el) return;
    const dt = Math.min((now - m.last) / 1000, 0.1);
    m.last = now;
    const tau = m.attracted ? GLOW_FOLLOW_SECONDS : GLOW_RETURN_SECONDS;
    m.x = approach(m.x, m.tx, dt, tau);
    m.y = approach(m.y, m.ty, dt, tau);
    el.style.transform = `translate3d(${m.x}px, ${m.y}px, 0)`;
    const settled = Math.abs(m.tx - m.x) < 0.5 && Math.abs(m.ty - m.y) < 0.5;
    m.frame = settled ? 0 : requestAnimationFrame(tick);
  };

  const steer = (tx: number, ty: number, attracted: boolean) => {
    const m = motion.current;
    m.tx = tx;
    m.ty = ty;
    m.attracted = attracted;
    if (ref.current) ref.current.dataset.attracted = String(attracted);
    if (!m.frame) {
      m.last = performance.now();
      m.frame = requestAnimationFrame(tick);
    }
  };

  const attract = (e: React.PointerEvent<HTMLDivElement>) => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const box = e.currentTarget.getBoundingClientRect();
    steer(
      (e.clientX - box.left - box.width / 2) * PULL,
      (e.clientY - box.top - box.height / 2) * PULL,
      true,
    );
  };
  const release = () => steer(0, 0, false);

  return { ref, attract, release };
}
