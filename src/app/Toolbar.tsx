import { useLayoutEffect, useRef, useState } from "react";
import { readButtonShowsUnread } from "../features/mailbox/model/readButton";
import type { MarkRead } from "../features/mailbox/model/viewingPrefs";
import type { CommandId } from "../features/commands/model/commands";
import {
  OVERFLOW_ORDER,
  type SearchPlacement,
  toolbarLayout,
} from "../features/layout/model/titleSearch";
import type { ThreadAction } from "../features/mailbox/model/threadActions";
import {
  ArchiveIcon,
  ComposeIcon,
  type IconProps,
  LabelIcon,
  MarkReadIcon,
  MarkUnreadIcon,
  MoreIcon,
  MoveToInboxIcon,
  ReaderToggleIcon,
  RestoreIcon,
  SidebarToggleIcon,
  SpamIcon,
  StarIcon,
  TrashIcon,
} from "../shared/ui/icons";
import { TitleSearch } from "./TitleSearch";
import { accelLabel, IS_MAC } from "../shared/lib/platform";

/** Room for the macOS traffic lights at the left of the toolbar (Windows
 * keeps its window buttons in its own title bar). */
const TRAFFIC_LIGHTS_WIDTH = IS_MAC ? 80 : 8;

/** The Label button, which `l` also opens the picker under. */
export const LABEL_BUTTON_ID = "toolbar-label";
/** The More button: where the label picker opens once Labels has moved into it. */
export const MORE_BUTTON_ID = "toolbar-more";

/** What a toggling button would do now, for the chosen conversations. */
type Toggle = { action: ThreadAction; run: () => void } | null;

export type ToolbarActions = {
  archive: Toggle;
  trash: Toggle;
  spam: Toggle;
  read: Toggle;
  star: Toggle;
  /** Opens (or closes) the label picker under the button. */
  label: ((button: HTMLElement) => void) | null;
  /** Opens (or closes) the More menu under the button. */
  more: ((button: HTMLElement) => void) | null;
};

type Props = {
  search: string;
  onSearch: (text: string) => void;
  /** Mail actions for the chosen conversations; null when nothing is chosen. */
  actions: ToolbarActions;
  sidebarOpen: boolean;
  /** A sync problem to flag on the sidebar toggle while the sidebar is hidden. */
  syncAttention: "warn" | "error" | null;
  readerOpen: boolean;
  /** A conversation is open: the reader can show. */
  hasSelection: boolean;
  /** How many conversations the actions apply to (named in tooltips if several). */
  count: number;
  /**
   * The commands' names (`features/commands`), so tooltips say what the
   * menu bar, right-click menu and ⌘K say.
   */
  names: Partial<Record<CommandId, string>>;
  onToggleSidebar: () => void;
  /** The pointer went onto (true) or off (false) the sidebar button. */
  onSidebarHover?: (inside: boolean) => void;
  onToggleReader: () => void;
  /** Writing needs an account to write from. */
  canCompose: boolean;
  onCompose: () => void;
  /**
   * Which conversations the actions apply to, so a change in their star or
   * read state (not a change of conversations) plays the buttons' motion.
   */
  targetKey: string;
  /**
   * The one conversation shown was unread when opened, and hasn't been
   * marked read or unread by hand since (`readButtonShowsUnread`).
   */
  opening: boolean;
  /** Settings → Viewing: when an opened conversation is marked read. */
  markRead: MarkRead;
  /** Whether the reader's button shows (not when the panes take turns). */
  showReaderToggle: boolean;
  /** How many buttons have moved into the More menu (`OVERFLOW_ORDER`). */
  overflow: number;
  /** The toolbar measured that a different number must move. */
  onOverflow: (count: number) => void;
};

/**
 * Window title bar, Tern-style: drags the window and holds mail actions on
 * the right. Buttons that toggle (archive, trash, read, star) show what
 * they'd do now: archived mail offers "Move to Inbox", Trash "Restore".
 */
export function Toolbar({
  search,
  onSearch,
  actions,
  sidebarOpen,
  syncAttention,
  readerOpen,
  hasSelection,
  count,
  names,
  onToggleSidebar,
  onSidebarHover,
  onToggleReader,
  canCompose,
  onCompose,
  showReaderToggle,
  overflow,
  onOverflow,
  targetKey,
  opening,
  markRead,
}: Props) {
  const barRef = useRef<HTMLElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const placement = useSearchPlacement(barRef, leftRef, rightRef, overflow, onOverflow);
  const moved = new Set<string>(OVERFLOW_ORDER.slice(0, overflow));
  const many = count > 1 ? ` ${count} conversations` : "";
  const archive = actions.archive?.action;
  const trash = actions.trash?.action;
  const star = actions.star?.action;
  const moveToInbox = archive?.kind === "archive" && !archive.archived;
  const restore = trash?.kind === "trash" && !trash.trashed;
  const unstar = star?.kind === "star" && !star.starred;
  const starTurns = useChanges(targetKey, star ? unstar : undefined);
  const read = actions.read?.action;
  const showsUnread = readButtonShowsUnread({
    marksUnread: read?.kind === "read" && !read.read,
    opening,
    markRead,
  });
  // Once the bar has been measured, buttons coming back from the More menu
  // fade in (not the ones there when the window opens).
  const settled = placement !== null;
  return (
    <header
      ref={barRef}
      data-tauri-drag-region
      className="relative flex h-10 shrink-0 items-center gap-0.5 pr-2"
      style={{ paddingLeft: TRAFFIC_LIGHTS_WIDTH }}
    >
      <div ref={leftRef} data-toolbar-start className="flex">
        <ToolButton
          icon={SidebarToggleIcon}
          label={names.sidebar ?? ""}
          shortcut={accelLabel("Ctrl+Cmd+S")}
          onClick={onToggleSidebar}
          onHover={onSidebarHover}
          pressed={sidebarOpen}
          dot={sidebarOpen ? null : syncAttention}
        />
      </div>
      <div data-tauri-drag-region className="flex-1 self-stretch" />
      <TitleSearch value={search} onChange={onSearch} placement={placement} />
      {/* Conversation actions dim with nothing chosen. */}
      <div ref={rightRef} data-toolbar-end className="flex items-center gap-0.5">
        <ToolButton
          icon={moveToInbox ? MoveToInboxIcon : ArchiveIcon}
          label={(names.archive ?? "") + many}
          shortcut="e"
          onClick={actions.archive?.run}
          disabled={!actions.archive}
        />
        {!moved.has("trash") && (
          <ToolButton
            overflowId="trash"
            appear={settled}
            icon={restore ? RestoreIcon : TrashIcon}
            label={(names.trash ?? "") + many}
            shortcut="#"
            onClick={actions.trash?.run}
            disabled={!actions.trash}
          />
        )}
        {!moved.has("spam") && (
          <ToolButton
            overflowId="spam"
            appear={settled}
            icon={SpamIcon}
            label={(names.spam ?? "") + many}
            shortcut="!"
            onClick={actions.spam?.run}
            disabled={!actions.spam}
          />
        )}
        {!moved.has("read") && (
          <ToolButton
            overflowId="read"
            appear={settled}
            // Open for Mark as read, closed for Mark as unread; closed from
            // the start for a conversation opening is about to mark read.
            icon={showsUnread ? MarkUnreadIcon : MarkReadIcon}
            label={(names.read ?? "") + many}
            shortcut="u"
            onClick={actions.read?.run}
            disabled={!actions.read}
          />
        )}
        {!moved.has("star") && (
          <ToolButton
            overflowId="star"
            appear={settled}
            icon={StarIcon}
            // Starring spins the star as it lights up; unstarring turns it back.
            motion={{ kind: starTurns.to ? "spin" : "spin-back", count: starTurns.count }}
            label={(names.star ?? "") + many}
            shortcut="s"
            onClick={actions.star?.run}
            disabled={!actions.star}
            // Every chosen conversation is starred: the star lights up.
            pressed={unstar}
            tone={unstar ? "text-warn" : undefined}
          />
        )}
        {!moved.has("labels") && (
          <ToolButton
            overflowId="labels"
            appear={settled}
            id={LABEL_BUTTON_ID}
            icon={LabelIcon}
            label={(names.labels ?? "") + many}
            shortcut="l"
            onClick={actions.label ?? undefined}
            disabled={!actions.label}
          />
        )}
        <ToolButton
          id={MORE_BUTTON_ID}
          icon={MoreIcon}
          label="More"
          onClick={actions.more ?? undefined}
          disabled={!actions.more}
        />
        <span className="mx-1.5 h-4 w-px bg-stroke" />
        <ToolButton
          icon={ComposeIcon}
          label={names.new ?? ""}
          shortcut="c"
          onClick={onCompose}
          disabled={!canCompose}
        />
        {showReaderToggle && (
          <>
            <span className="mx-1.5 h-4 w-px bg-stroke" />
            <ToolButton
              icon={ReaderToggleIcon}
              label={!hasSelection ? "Reader opens with a conversation" : (names.reader ?? "")}
              shortcut={accelLabel("Ctrl+Cmd+R")}
              onClick={onToggleReader}
              disabled={!hasSelection}
              pressed={readerOpen}
            />
          </>
        )}
      </div>
    </header>
  );
}

function ToolButton({
  id,
  icon: Icon,
  label,
  shortcut,
  onClick,
  disabled,
  pressed,
  tone,
  dot,
  onHover,
  motion,
  overflowId,
  appear,
}: {
  id?: string;
  /** One of `OVERFLOW_ORDER`: it can move into the More menu. */
  overflowId?: string;
  /** Fade in on appearing (a button back from the More menu). */
  appear?: boolean;
  icon: (props: IconProps) => React.ReactNode;
  label: string;
  shortcut?: string;
  onClick?: (button: HTMLElement) => void;
  disabled?: boolean;
  /** For toggles: whether the thing it controls is showing. */
  pressed?: boolean;
  /** Text colour class for the icon (e.g. a lit star). */
  tone?: string;
  /** Small status dot in the corner (e.g. a sync problem behind a hidden panel). */
  dot?: "warn" | "error" | null;
  /** The pointer went onto (true) or off (false) the button. */
  onHover?: (inside: boolean) => void;
  /**
   * A motion played on the icon each time `count` goes up while the button
   * is showing: a button coming back from the More menu doesn't play the
   * last one again.
   */
  motion?: { kind: "spin" | "spin-back"; count: number };
}) {
  // The motion's count when this button appeared, which it doesn't play;
  // and whether it fades in, decided as it appears.
  const [shownAt] = useState(motion?.count ?? 0);
  const [fadeIn] = useState(appear ?? false);
  const soon = !onClick && !disabled;
  const title = [label, shortcut && `(${shortcut})`, soon && "· coming soon"]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      id={id}
      type="button"
      title={title}
      aria-label={label}
      aria-pressed={pressed}
      onClick={(e) => onClick?.(e.currentTarget)}
      onPointerEnter={onHover && (() => onHover(true))}
      onPointerLeave={onHover && (() => onHover(false))}
      disabled={disabled}
      data-overflow={overflowId}
      className={`relative flex h-7 w-7 items-center justify-center rounded-md transition-colors duration-[120ms] hover:bg-selection hover:text-content disabled:opacity-35 disabled:hover:bg-transparent ${
        tone ?? "text-content/70"
      } ${fadeIn ? "tool-appear" : ""}`}
    >
      {motion ? (
        // Keyed by the count, so each change plays the motion afresh.
        <span
          key={motion.count}
          className={motion.count !== shownAt ? `flex icon-${motion.kind}` : "flex"}
        >
          <Icon />
        </span>
      ) : (
        <Icon />
      )}
      {dot && (
        <span
          className={`absolute top-1 right-1 h-1.5 w-1.5 rounded-full ${
            dot === "error" ? "bg-danger" : "bg-warn"
          }`}
        />
      )}
    </button>
  );
}

/** What each of the buttons that can move takes in the bar: 28px and its gap. */
const OVERFLOW_BUTTON_WIDTH = 30;

/**
 * Where the search box goes (`searchPlacement`), and how many buttons must
 * move into the More menu for it to keep its narrowest (`overflowCount`),
 * measured from the bar and the button groups on either side, again
 * whenever any of them resizes (the window, or a button coming or going).
 * Null until first measured.
 */
function useSearchPlacement(
  bar: React.RefObject<HTMLElement | null>,
  left: React.RefObject<HTMLElement | null>,
  right: React.RefObject<HTMLElement | null>,
  overflow: number,
  onOverflow: (count: number) => void,
): SearchPlacement | null {
  const [placement, setPlacement] = useState<SearchPlacement | null>(null);
  // Read by the observer, which outlives a render.
  const latest = useRef({ overflow, onOverflow });
  useLayoutEffect(() => {
    latest.current = { overflow, onOverflow };
  });
  useLayoutEffect(() => {
    const [b, l, r] = [bar.current, left.current, right.current];
    if (!b || !l || !r) return;
    const measure = () => {
      const now = latest.current;
      const { overflow: count, placement: next } = toolbarLayout({
        bar: b.clientWidth,
        leftEnd: l.offsetLeft + l.offsetWidth,
        rightStart: r.offsetLeft,
        rightWidth: r.offsetWidth,
        shown: OVERFLOW_ORDER.length - now.overflow,
        perButton: OVERFLOW_BUTTON_WIDTH,
      });
      // Placed for the buttons that will show, in the same frame as they
      // move, so the box never sits over one on its way out.
      setPlacement((was) =>
        was && was.left === next.left && was.width === next.width ? was : next,
      );
      if (count !== now.overflow) {
        if (count > now.overflow) fadeOut(b, r, OVERFLOW_ORDER.slice(now.overflow, count));
        now.onOverflow(count);
      }
    };
    const observer = new ResizeObserver(measure);
    for (const el of [b, l, r]) observer.observe(el);
    return () => observer.disconnect();
  }, [bar, left, right]);
  return placement;
}

/**
 * How many times `value` has changed while `key` stayed the same (a star or
 * read state flipped on the same conversations, not a different set chosen,
 * or nothing chosen: `undefined`), and what it changed to last, so the
 * motion keeps its direction when the conversations change afterwards.
 * Worked out during render.
 */
function useChanges(key: string, value: boolean | undefined): { count: number; to: boolean } {
  const [seen, setSeen] = useState({ key, value, count: 0, to: false });
  if (seen.key !== key || seen.value !== value) {
    const flipped = seen.key === key && seen.value !== undefined && value !== undefined;
    setSeen({
      key,
      value,
      count: flipped ? seen.count + 1 : seen.count,
      to: flipped ? value : seen.to,
    });
  }
  return { count: seen.count, to: seen.to };
}

/**
 * Buttons about to move into the More menu fade out where they were (owner:
 * they shouldn't just vanish). The buttons themselves leave the bar at once,
 * so the bar's measuring stays right; a copy of each, out of the layout and
 * not clickable, fades out in their place and is then removed.
 */
function fadeOut(bar: HTMLElement, group: HTMLElement, ids: readonly string[]) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  for (const id of ids) {
    const button = group.querySelector<HTMLElement>(`[data-overflow="${id}"]`);
    if (!button) continue;
    const ghost = button.cloneNode(true) as HTMLElement;
    ghost.removeAttribute("id");
    ghost.removeAttribute("data-overflow");
    ghost.setAttribute("aria-hidden", "true");
    ghost.setAttribute("inert", "");
    ghost.classList.add("tool-leave");
    ghost.style.position = "absolute";
    ghost.style.left = `${group.offsetLeft + button.offsetLeft}px`;
    ghost.style.top = `${group.offsetTop + button.offsetTop}px`;
    ghost.style.pointerEvents = "none";
    ghost.addEventListener("animationend", () => ghost.remove(), { once: true });
    bar.appendChild(ghost);
  }
}
