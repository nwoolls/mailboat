import { useEffect, useRef, useState } from "react";
import type { Label, ThreadSummary } from "../../../platform/tauri/bindings";
import { nextMenuIndex } from "../../../shared/lib/menuNavigation";
import type { MenuAnchor } from "../../../shared/ui/Menu";
import { filterLabels, newLabelName, pickerName } from "../model/labelPicker";
import { labelState } from "../model/threadActions";

/**
 * Adds and removes user labels (`l`). Type to filter; ↑/↓ and Enter, or
 * click, toggle a label straight away. A tick means every chosen
 * conversation has the label, a dash that only some do. User labels belong
 * to one account, so a choice spanning accounts gets a note instead.
 *
 * Positioned and dismissed like `Menu` (a manual popover in the top layer),
 * but it keeps focus in its search field.
 */
export function LabelPicker({
  anchor,
  labels,
  targets,
  onToggle,
  onCreate,
  onClose,
}: {
  anchor: MenuAnchor;
  /** The user labels of the conversations' account. */
  labels: Label[];
  targets: Pick<ThreadSummary, "accountId" | "labelIds">[];
  onToggle: (label: Label) => void;
  /** Creates a label in the conversations' account (and applies it). */
  onCreate: (name: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  const [text, setText] = useState("");
  const [at, setAt] = useState(-1);
  const accounts = new Set(targets.map((t) => t.accountId));
  const spansAccounts = accounts.size > 1;
  const shown = spansAccounts ? [] : filterLabels(labels, text);
  const highlighted = shown[Math.min(at, shown.length - 1)];
  // Typing a name no label has offers to create it, as Gmail does.
  const fresh = spansAccounts ? null : newLabelName(labels, text);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.showPopover();
    const width = el.offsetWidth;
    let left = anchor.align === "end" ? anchor.x - width : anchor.x;
    if (left + width > window.innerWidth - 8) left = anchor.x - width;
    el.style.left = `${Math.max(8, left)}px`;
    const onPointerDown = (e: PointerEvent) => {
      if (!(e.target instanceof Node && el.contains(e.target))) close.current();
    };
    const onBlur = () => close.current();
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("blur", onBlur);
      if (el.matches(":popover-open")) el.hidePopover();
    };
  }, [anchor]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setAt(nextMenuIndex(highlighted ? shown.indexOf(highlighted) : -1, shown.length, e.key));
    } else if (e.key === "Enter") {
      e.preventDefault();
      // With one match, Enter picks it without arrowing to it first.
      const pick = highlighted ?? (shown.length === 1 ? shown[0] : undefined);
      if (pick) onToggle(pick);
      else if (fresh) onCreate(fresh);
    }
  };

  return (
    <div
      ref={ref}
      popover="manual"
      role="dialog"
      aria-label="Labels"
      onKeyDown={onKeyDown}
      className="menu fixed m-0 flex max-h-[min(420px,70vh)] w-64 flex-col rounded-lg p-1 text-[13px] font-normal text-content outline-none"
      style={{ inset: "auto", left: anchor.x, top: anchor.y }}
    >
      {spansAccounts ? (
        <p className="px-2 py-1.5 text-xs text-content/60">
          Labels belong to one account. Choose conversations from a single account to label them.
        </p>
      ) : (
        <>
          <input
            // Focus goes straight to the field so typing filters at once.
            autoFocus
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setAt(-1);
            }}
            placeholder="Filter labels"
            aria-label="Filter labels"
            aria-controls="label-picker-list"
            className="mb-1 h-7 rounded-md bg-selection-subtle px-2 outline-none placeholder:text-content/40"
          />
          <div id="label-picker-list" role="listbox" className="min-h-0 overflow-y-auto">
            {shown.length === 0 && !fresh && (
              <p className="px-2 py-1.5 text-xs text-content/50">
                {labels.length === 0 ? "This account has no labels yet." : "No matching labels."}
              </p>
            )}
            {shown.map((label) => {
              const state = labelState(targets, label);
              return (
                <button
                  key={label.id}
                  type="button"
                  role="option"
                  aria-selected={label === highlighted}
                  aria-checked={state === "all" ? true : state === "some" ? "mixed" : false}
                  onClick={() => onToggle(label)}
                  onPointerMove={() => setAt(shown.indexOf(label))}
                  className={`flex h-7 w-full items-center gap-2 rounded-md px-2 text-left ${
                    label === highlighted ? "bg-selection-strong" : ""
                  }`}
                >
                  <span aria-hidden className="w-3.5 shrink-0 text-center text-accent">
                    {state === "all" ? "✓" : state === "some" ? "–" : ""}
                  </span>
                  <span
                    aria-hidden
                    className="h-2 w-2 shrink-0 rounded-full ring-1 ring-stroke"
                    style={{ background: label.colorBg ?? "transparent" }}
                  />
                  <span className="truncate">{pickerName(label)}</span>
                </button>
              );
            })}
            {fresh && (
              <button
                type="button"
                onClick={() => onCreate(fresh)}
                className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-accent hover:bg-selection-strong"
              >
                <span aria-hidden className="w-3.5 shrink-0 text-center">
                  +
                </span>
                <span className="truncate">Create “{fresh}”</span>
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
