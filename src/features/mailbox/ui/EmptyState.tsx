import { useRef } from "react";
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
  const pull = useRef<HTMLDivElement>(null);

  // Writes the offset straight to CSS variables, so pointer moves don't
  // re-render; the CSS transition supplies the easing.
  const attract = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = pull.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const box = e.currentTarget.getBoundingClientRect();
    el.style.setProperty("--pull-x", `${(e.clientX - box.left - box.width / 2) * PULL}px`);
    el.style.setProperty("--pull-y", `${(e.clientY - box.top - box.height / 2) * PULL}px`);
    el.dataset.attracted = "true";
  };
  const release = () => {
    const el = pull.current;
    if (!el) return;
    el.style.setProperty("--pull-x", "0px");
    el.style.setProperty("--pull-y", "0px");
    el.dataset.attracted = "false";
  };

  return (
    <div
      className="relative flex flex-1 items-center justify-center overflow-hidden px-8"
      onPointerMove={attract}
      onPointerLeave={release}
    >
      <div ref={pull} aria-hidden className="empty-glow-pull">
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
