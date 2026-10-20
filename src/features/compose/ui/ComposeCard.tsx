import { useRef, useState } from "react";
import type { Account, Identity } from "../../../platform/tauri/bindings";
import { ClearIcon, MinimizeIcon } from "../../../shared/ui/icons";
import { editorKey, hasChanges } from "../model/draft";
import type { ComposeEntry } from "../model/composeState";
import { ComposeForm } from "./ComposeForm";
import { useAssistantOpen } from "../../ai/ui/assistantOpen";
import { cardSize, nearestSpot, type Point, spotPosition } from "../model/snap";
import {
  closeDraft,
  closeKeepingDraft,
  minimizeCard,
  setCardSpot,
  updateDraft,
  useCardSpot,
  useViewport,
} from "./useCompose";

/**
 * A new message, in a card floating over the lower right of the window
 * (about Gmail's size). It never blocks the app: the list and reader stay
 * usable beside it. Esc or the – button minimises it to a tab along the
 * bottom (nothing is lost). Dragged by its header, it springs on release
 * to the nearest corner or side middle, like iOS picture-in-picture.
 */
export function ComposeCard({
  entry,
  identities,
  accounts,
  onSend,
}: {
  entry: ComposeEntry;
  identities: Identity[];
  accounts: Account[];
  onSend: () => void;
}) {
  const { draft } = entry;
  const account = accounts.find((a) => a.id === draft.accountId);
  const viewport = useViewport();
  // The writing assistant (⌘J) opens beside the form, widening the card.
  // Kept per message, so it's still open after minimising and restoring.
  const [assistant, setAssistant] = useAssistantOpen(draft);
  const size = cardSize(viewport, assistant);
  const rest = spotPosition(useCardSpot(), viewport, size);
  // Where it is while being dragged (null: resting at its spot).
  const [dragAt, setDragAt] = useState<Point | null>(null);
  const drag = useRef<{ grab: Point; last: Point; lastTime: number; velocity: Point } | null>(null);
  const at = dragAt ?? rest;

  const onPointerDown = (e: React.PointerEvent) => {
    // Buttons in the header still click.
    if (e.button !== 0 || (e.target as Element).closest("button")) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = {
      grab: { x: e.clientX - at.x, y: e.clientY - at.y },
      last: { x: e.clientX, y: e.clientY },
      lastTime: e.timeStamp,
      velocity: { x: 0, y: 0 },
    };
    setDragAt(at);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dt = (e.timeStamp - d.lastTime) / 1000;
    if (dt > 0) d.velocity = { x: (e.clientX - d.last.x) / dt, y: (e.clientY - d.last.y) / dt };
    d.last = { x: e.clientX, y: e.clientY };
    d.lastTime = e.timeStamp;
    setDragAt({ x: e.clientX - d.grab.x, y: e.clientY - d.grab.y });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    // A pause before letting go means no flick.
    const velocity = e.timeStamp - d.lastTime > 80 ? { x: 0, y: 0 } : d.velocity;
    setCardSpot(nearestSpot(dragAt ?? at, velocity, viewport, size));
    setDragAt(null);
  };

  return (
    <section
      aria-label={draft.kind === "new" ? "New message" : "Reply"}
      className={`compose-card compose-snap fixed z-40 flex flex-col overflow-hidden rounded-xl ${
        dragAt ? "dragging" : ""
      }`}
      style={{
        left: at.x,
        top: at.y,
        width: size.width,
        height: size.height,
        // The From account's colour along the top edge.
        borderTop: `2px solid ${account?.color ?? "transparent"}`,
      }}
      onKeyDown={(e) => {
        // Esc minimises, never discards. Fields that use Esc first (the
        // suggestion list) stop it before it gets here.
        // (A dialog inside, like Discard's, handles its own Escape.)
        if (e.key === "Escape" && !(e.target as Element).closest("dialog")) {
          e.preventDefault();
          e.stopPropagation();
          minimizeCard(draft.id);
        }
      }}
    >
      <header
        className="flex h-9 shrink-0 cursor-grab touch-none items-center gap-2 pr-1.5 pl-4 select-none active:cursor-grabbing"
        title="Drag to move"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <h2 className="min-w-0 flex-1 truncate text-[13px] font-semibold">
          {draft.subject.trim() || "New message"}
        </h2>
        <button
          type="button"
          aria-label="Minimise"
          title="Minimise (Esc)"
          className="flex h-7 w-7 items-center justify-center rounded-md text-content/60 hover:bg-selection hover:text-content"
          onClick={() => minimizeCard(draft.id)}
        >
          <MinimizeIcon />
        </button>
        <button
          type="button"
          aria-label="Close"
          title={hasChanges(draft) ? "Close (kept in Drafts)" : "Close"}
          disabled={entry.sending}
          className="flex h-7 w-7 items-center justify-center rounded-md text-content/60 hover:bg-selection hover:text-content"
          onClick={() => closeKeepingDraft(draft.id)}
        >
          <ClearIcon />
        </button>
      </header>
      <ComposeForm
        key={editorKey(draft)}
        entry={entry}
        identities={identities}
        accounts={accounts}
        onChange={(change) => updateDraft(draft.id, change)}
        onSend={onSend}
        onDiscard={() => closeDraft(draft.id)}
        assistant={{ open: assistant, onToggle: setAssistant }}
      />
    </section>
  );
}
