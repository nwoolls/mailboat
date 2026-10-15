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

/**
 * What an empty list shows: an icon, a line of copy and a drifting glow.
 * With the pointer over the pane the glow is drawn towards it (still
 * drifting); when the pointer leaves it eases back to its usual path.
 */
export function EmptyState({ state }: { state: EmptyStateModel }) {
  const Icon = ICONS[state.icon];
  const { ref, glowRef, attract, release } = useGlowPull();
  return (
    <div
      className="relative flex flex-1 items-center justify-center overflow-hidden px-8"
      onPointerMove={attract}
      onPointerLeave={release}
    >
      <div ref={ref} aria-hidden className="empty-glow-pull">
        <div ref={glowRef} className="empty-glow" />
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
 * Moves the glow's wrapper once per animation frame. While the pointer is
 * over the pane the target is the pointer minus the glow's current drift,
 * so the glow centres on the cursor (its gentle size change carries on);
 * once the pointer leaves the target is zero and it glides back onto its
 * usual drifting path, then the loop stops. Pointer moves only update the
 * target, so there's no React re-render and no restarted transition.
 */
function useGlowPull() {
  const ref = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const motion = useRef({ x: 0, y: 0, cx: 0, cy: 0, attracted: false, frame: 0, last: 0 });

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
    let tx = 0;
    let ty = 0;
    if (m.attracted) {
      const drift = driftOffset(glowRef.current);
      tx = m.cx - drift.x;
      ty = m.cy - drift.y;
    }
    const tau = m.attracted ? GLOW_FOLLOW_SECONDS : GLOW_RETURN_SECONDS;
    m.x = approach(m.x, tx, dt, tau);
    m.y = approach(m.y, ty, dt, tau);
    el.style.transform = `translate3d(${m.x}px, ${m.y}px, 0)`;
    // While attracted the drift keeps moving, so keep following.
    const settled = !m.attracted && Math.abs(m.x) < 0.5 && Math.abs(m.y) < 0.5;
    m.frame = settled ? 0 : requestAnimationFrame(tick);
  };

  const run = () => {
    const m = motion.current;
    if (!m.frame) {
      m.last = performance.now();
      m.frame = requestAnimationFrame(tick);
    }
  };

  const attract = (e: React.PointerEvent<HTMLDivElement>) => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const m = motion.current;
    const box = e.currentTarget.getBoundingClientRect();
    m.cx = e.clientX - box.left - box.width / 2;
    m.cy = e.clientY - box.top - box.height / 2;
    m.attracted = true;
    if (ref.current) ref.current.dataset.attracted = "true";
    run();
  };
  const release = () => {
    motion.current.attracted = false;
    if (ref.current) ref.current.dataset.attracted = "false";
    run();
  };

  return { ref, glowRef, attract, release };
}

/** Where the drift animation has the glow right now, from its centre. */
function driftOffset(glow: HTMLElement | null): { x: number; y: number } {
  if (!glow) return { x: 0, y: 0 };
  const transform = getComputedStyle(glow).transform;
  if (!transform || transform === "none") return { x: 0, y: 0 };
  const m = new DOMMatrixReadOnly(transform);
  return { x: m.m41, y: m.m42 };
}
