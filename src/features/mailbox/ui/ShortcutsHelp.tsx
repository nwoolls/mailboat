import { useEffect, useRef } from "react";
import { SHORTCUTS } from "../model/shortcuts";

/** `?`: every keyboard shortcut, grouped. Esc or a click outside closes it. */
export function ShortcutsHelp({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    el?.showModal();
    return () => el?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby="shortcuts-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="dialog m-auto w-[min(640px,92vw)] rounded-xl p-5 text-[13px] text-content"
    >
      <h2 id="shortcuts-title" className="mb-4 text-sm font-semibold">
        Keyboard shortcuts
      </h2>
      <div className="grid grid-cols-2 gap-x-8 gap-y-5">
        {SHORTCUTS.map((group) => (
          <section key={group.group}>
            <h3 className="mb-1.5 text-xs text-content/45">{group.group}</h3>
            <dl className="space-y-1">
              {group.keys.map(([keys, what]) => (
                <div key={`${keys}:${what}`} className="flex items-baseline gap-3">
                  <dt className="w-20 shrink-0 font-medium text-content/80">{keys}</dt>
                  <dd className="text-content/65">{what}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </dialog>
  );
}
