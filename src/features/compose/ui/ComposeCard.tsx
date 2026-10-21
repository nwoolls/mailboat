import { useRef, useState } from "react";
import type { Account, Identity } from "../../../platform/tauri/bindings";
import { ClearIcon, MinimizeIcon } from "../../../shared/ui/icons";
import { canSwitchKind, editorKey, hasChanges } from "../model/draft";
import type { ComposeEntry } from "../model/composeState";
import { ComposeForm, type ReplyKind } from "./ComposeForm";
import { useAssistantOpen } from "../../ai/ui/assistantOpen";
import { assistantLayout, cardSize, nearestSpot, type Point, spotPosition } from "../model/snap";
import { usePresence } from "../../../shared/ui/usePresence";

/** The card's spring (`.compose-snap` in index.css), which the assistant
 * panel opens and closes with. */
const ASSISTANT_SPRING_MS = 420;
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
  onSwitch,
}: {
  entry: ComposeEntry;
  identities: Identity[];
  accounts: Account[];
  onSend: () => void;
  /** Turns a reply into another kind, keeping its text (as inline). */
  onSwitch: (id: number, kind: ReplyKind) => void;
}) {
  const { draft } = entry;
  const account = accounts.find((a) => a.id === draft.accountId);
  const viewport = useViewport();
  // The writing assistant (⌘J) opens beside the form, widening the card.
  // Kept per message, so it's still open after minimising and restoring.
  const [assistant, setAssistant] = useAssistantOpen(draft);
  // Drawn while it closes too, so it collapses rather than vanishing.
  const assistantShown = usePresence(assistant, ASSISTANT_SPRING_MS);
  // Positions are the form's: it rests at its spot (or follows the pointer)
  // and the assistant opens beside it without moving it.
  const size = cardSize(viewport);
  const rest = spotPosition(useCardSpot(), viewport, size);
  // Where it is while being dragged (null: resting at its spot).
  const [dragAt, setDragAt] = useState<Point | null>(null);
  const drag = useRef<{ grab: Point; last: Point; lastTime: number; velocity: Point } | null>(null);
  const at = dragAt ?? rest;
  const layout = assistantLayout(at, size, viewport, assistant);
  // Opening or closing the assistant nudges the whole card the way it's
  // growing or shrinking and lets it settle: the bounce, on either side.
  // (Derived during render; the parity retriggers the animation.)
  const [seenAssistant, setSeenAssistant] = useState(assistant);
  const [nudge, setNudge] = useState<{ dir: "left" | "right"; n: number } | null>(null);
  if (assistant !== seenAssistant) {
    setSeenAssistant(assistant);
    // Growing on the left or shrinking from the right moves it left.
    const dir = assistant === (layout.side === "left") ? "left" : "right";
    setNudge({ dir, n: (nudge?.n ?? 0) + 1 });
  }

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
      } ${nudge ? `assistant-moving nudge-${nudge.dir}-${nudge.n % 2}` : ""}`}
      onAnimationEnd={(e) => {
        if (e.target === e.currentTarget && e.animationName.startsWith("nudge-")) setNudge(null);
      }}
      style={{
        left: layout.left,
        top: at.y,
        width: layout.width,
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
        // Reply / Reply all / Forward, as inline; not for new mail.
        onSwitchKind={canSwitchKind(draft) ? (kind) => onSwitch(draft.id, kind) : undefined}
        assistant={{
          open: assistant,
          shown: assistantShown,
          side: layout.side,
          formWidth: size.width,
          onToggle: setAssistant,
        }}
      />
    </section>
  );
}
