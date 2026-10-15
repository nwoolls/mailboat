import { useRef } from "react";
import { KEYBOARD_STEP } from "../model/panes";

type Props = {
  label: string;
  /** Width of the pane this splitter resizes (the one to its left). */
  width: number;
  onResize: (width: number) => void;
  onReset: () => void;
};

/**
 * Drag handle between two panes. Double-click resets; when focused, the
 * arrow keys nudge it. Like MonoCode's sidebar resizer, it captures the
 * pointer so the drag keeps tracking outside the handle.
 */
export function Splitter({ label, width, onResize, onReset }: Props) {
  const drag = useRef<{ x: number; width: number } | null>(null);

  const end = () => {
    drag.current = null;
    document.documentElement.classList.remove("resizing");
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      tabIndex={0}
      className="group relative z-10 w-2 shrink-0 cursor-col-resize outline-none"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, width };
        // Stops the email frame from swallowing the drag (see index.css).
        document.documentElement.classList.add("resizing");
      }}
      onPointerMove={(e) => {
        if (drag.current) onResize(drag.current.width + e.clientX - drag.current.x);
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          onResize(width + (e.key === "ArrowRight" ? KEYBOARD_STEP : -KEYBOARD_STEP));
        }
      }}
    >
      {/* Grab area reaches 4px past the gap on each side. */}
      <span className="absolute inset-y-0 -right-1 -left-1" />
      <span className="pointer-events-none absolute inset-y-2 left-1/2 w-0.5 -translate-x-1/2 rounded-full transition-colors duration-[120ms] group-hover:bg-accent/60 group-focus-visible:bg-accent/60 group-active:bg-accent" />
    </div>
  );
}
