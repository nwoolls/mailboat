import { useEffect } from "react";

export type ToastData = {
  /** New for every toast, so the timer and entrance restart. */
  id: number;
  message: string;
  tone?: "error";
  action?: { label: string; run: () => void };
};

/** How long a toast stays up. */
const TOAST_MS = 6000;

/**
 * One line at the bottom of the window after an action, with an optional
 * button (Undo). Replaced by the next toast; fades after a few seconds.
 * Announced to screen readers as a status update.
 */
export function Toast({ toast, onDismiss }: { toast: ToastData | null; onDismiss: () => void }) {
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(onDismiss, TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toast, onDismiss]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-5 z-50 flex justify-center"
    >
      {toast && (
        <div
          key={toast.id}
          className={`toast pointer-events-auto flex max-w-[min(560px,90vw)] items-center gap-3 rounded-lg py-2 pr-2 pl-3.5 text-[13px] ${
            toast.tone === "error" ? "text-danger" : "text-content"
          }`}
        >
          <span className="selectable min-w-0 truncate">{toast.message}</span>
          {toast.action && (
            <button
              type="button"
              className="shrink-0 rounded-md px-2 py-0.5 font-medium text-accent hover:bg-selection"
              onClick={() => {
                toast.action!.run();
                onDismiss();
              }}
            >
              {toast.action.label}
            </button>
          )}
          <button
            type="button"
            aria-label="Dismiss"
            className="shrink-0 rounded-md px-1.5 py-0.5 text-content/45 hover:bg-selection hover:text-content"
            onClick={onDismiss}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
