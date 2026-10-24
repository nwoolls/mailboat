import { Command } from "cmdk";
import { useEffect, useRef } from "react";
import { isRealMove } from "../../../shared/lib/pointer";
import type { IconProps } from "../../../shared/ui/icons";

/** One thing the palette can do. */
export type PaletteItem = {
  id: string;
  group: string;
  title: string;
  /** Faint text after the title (an account's address). */
  detail?: string | null;
  /** The key that does the same outside the palette. */
  shortcut?: string;
  icon?: (props: IconProps) => React.ReactNode;
  run: () => void;
};

/**
 * ⌘K: type to find an action or a place, ↑/↓ and Return to run it, Esc to
 * close (cmdk does the filtering and keys). A modal `<dialog>`, so it sits
 * above everything and keeps focus.
 *
 * cmdk picks the row under the pointer on every pointer move. WebKit sends
 * one without movement whenever the list scrolls under a still cursor, so
 * holding ↓ snapped the pick back to the row under the idle mouse each
 * time the list scrolled. Only real moves reach cmdk now.
 */
export function CommandPalette({ items, onClose }: { items: PaletteItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  // The chosen item's action, run once the palette has closed: while the
  // modal dialog is open everything outside it is inert, and closing it
  // hands focus back to where it was, so an action that moves focus (Search
  // mail focusing the search box) would otherwise be undone.
  const chosen = useRef<(() => void) | null>(null);
  useEffect(() => {
    const el = ref.current;
    el?.showModal();
    // Opening the dialog moves focus to the dialog itself (React's
    // autoFocus ran before it was open), so put it in the field after.
    input.current?.focus();
    return () => {
      el?.close();
      chosen.current?.();
    };
  }, []);
  const groups = [...new Set(items.map((i) => i.group))];

  return (
    <dialog
      ref={ref}
      aria-label="Command palette"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      // A click on the backdrop (outside the box) closes it.
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="dialog mx-auto mt-[12vh] w-[min(560px,90vw)] overflow-hidden rounded-xl p-0 text-[13px] text-content"
    >
      <Command label="Command palette" loop>
        <Command.Input
          ref={input}
          placeholder="Type a command or a place…"
          className="h-11 w-full border-b border-stroke bg-transparent px-4 outline-none placeholder:text-content/40"
        />
        <Command.List
          className="max-h-[min(420px,60vh)] overflow-y-auto p-1.5"
          onPointerMoveCapture={(e) => {
            const moved = isRealMove(pointer.current, e);
            pointer.current = { x: e.clientX, y: e.clientY };
            if (!moved) e.stopPropagation();
          }}
        >
          <Command.Empty className="px-3 py-2 text-content/50">Nothing matches.</Command.Empty>
          {groups.map((group) => (
            <Command.Group
              key={group}
              heading={group}
              className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-content/45"
            >
              {items
                .filter((i) => i.group === group)
                .map((item) => (
                  <Command.Item
                    key={item.id}
                    value={`${item.title} ${item.detail ?? ""} ${item.id}`}
                    onSelect={() => {
                      chosen.current = item.run;
                      onClose();
                    }}
                    className="flex h-8 cursor-default items-center gap-2.5 rounded-md px-2.5 data-[selected=true]:bg-selection-strong"
                  >
                    <span className="flex w-4 shrink-0 justify-center text-content/60">
                      {item.icon && <item.icon size={15} />}
                    </span>
                    <span className="truncate">{item.title}</span>
                    {item.detail && (
                      <span className="truncate text-xs text-content/45">{item.detail}</span>
                    )}
                    {item.shortcut && (
                      <kbd className="ml-auto shrink-0 font-sans text-xs text-content/45">
                        {item.shortcut}
                      </kbd>
                    )}
                  </Command.Item>
                ))}
            </Command.Group>
          ))}
        </Command.List>
      </Command>
    </dialog>
  );
}
