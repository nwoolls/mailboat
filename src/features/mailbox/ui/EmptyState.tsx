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

/** What an empty list shows: an icon, a line of copy and a drifting glow. */
export function EmptyState({ state }: { state: EmptyStateModel }) {
  const Icon = ICONS[state.icon];
  return (
    <div className="relative flex flex-1 items-center justify-center overflow-hidden px-8">
      <div aria-hidden className="empty-glow" />
      <div className="empty-rise relative flex max-w-xs flex-col items-center text-center">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-selection-subtle text-content/80 ring-1 ring-stroke">
          <span className={state.icon === "caughtUp" ? "empty-nod" : undefined}>
            <Icon size={26} strokeWidth={1.5} />
          </span>
        </div>
        <p className="text-[15px] font-semibold">{state.title}</p>
        <p className="mt-1 text-content/60">{state.detail}</p>
      </div>
    </div>
  );
}
