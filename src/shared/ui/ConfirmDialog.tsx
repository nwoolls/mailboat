import { useEffect, useRef } from "react";

/**
 * A modal question with Cancel and a confirm button. Uses the browser's
 * `<dialog>`, which keeps focus inside and closes on Escape. Cancel gets
 * focus first, so pressing Return by accident never confirms.
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  danger,
  hideCancel,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  title: string;
  children: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
  /** Only the confirm button: for a notice, where there is nothing to cancel. */
  hideCancel?: boolean;
  /** The confirmed action is running: buttons wait. */
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const el = ref.current;
    el?.showModal();
    // Opening focuses the dialog itself (React's autoFocus ran before it
    // was open), so move focus to Cancel afterwards.
    (hideCancel ? confirm : cancel).current?.focus();
    return () => el?.close();
  }, [hideCancel]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="confirm-dialog-title"
      // Escape: ignore while busy, otherwise let the owner close it (a
      // notice with only a confirm button isn't closed that way).
      onCancel={(e) => {
        e.preventDefault();
        if (!busy && !hideCancel) onCancel();
      }}
      className="dialog m-auto w-[22rem] rounded-xl p-5 text-[13px] text-content"
    >
      <h2 id="confirm-dialog-title" className="mb-2 text-sm font-semibold">
        {title}
      </h2>
      <div className="selectable space-y-2 text-content/70">{children}</div>
      {error && <p className="selectable mt-3 text-xs text-danger">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        {!hideCancel && (
          <button
            ref={cancel}
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="h-7 rounded-md px-3 bg-selection hover:bg-selection-strong disabled:opacity-50"
          >
            Cancel
          </button>
        )}
        <button
          ref={confirm}
          type="button"
          disabled={busy}
          onClick={onConfirm}
          className={`h-7 rounded-md px-3 font-medium text-white disabled:opacity-60 ${
            danger ? "bg-danger hover:brightness-110" : "bg-accent hover:brightness-110"
          }`}
        >
          {busy ? "Working…" : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
