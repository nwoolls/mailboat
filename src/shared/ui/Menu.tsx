import { useEffect, useRef } from "react";
import type { IconProps } from "./icons";

/**
 * Where a menu opens: below a point (the pointer, or a button's corner).
 * "end" lines the menu's right edge up with the point instead of its left.
 */
export type MenuAnchor = { x: number; y: number; align?: "start" | "end" };

/** An anchor just below a button, right edges aligned. */
export function anchorBelow(el: Element): MenuAnchor {
  const r = el.getBoundingClientRect();
  return { x: r.right, y: r.bottom + 4, align: "end" };
}

/**
 * A small pop-up menu. It uses the browser's popover, so clicking outside
 * or pressing Escape closes it, and it floats above panels that clip their
 * content. Arrow keys move between items.
 */
export function Menu({
  anchor,
  onClose,
  label,
  children,
}: {
  anchor: MenuAnchor;
  onClose: () => void;
  label: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.showPopover();
    // Sizes from offsetWidth/Height, which the pop-in scale doesn't affect.
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    let left = anchor.align === "end" ? anchor.x - width : anchor.x;
    // Keep it inside the window when opened near an edge.
    if (left + width > window.innerWidth - 8) left = anchor.x - width;
    el.style.left = `${Math.max(8, left)}px`;
    if (anchor.y + height > window.innerHeight - 8) el.style.top = `${anchor.y - height}px`;
    el.querySelector<HTMLElement>("[role=menuitem]:not(:disabled)")?.focus();
    return () => {
      if (el.matches(":popover-open")) el.hidePopover();
    };
  }, [anchor]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = [
      ...(ref.current?.querySelectorAll<HTMLElement>("[role=menuitem]:not(:disabled)") ?? []),
    ];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "ArrowDown" ? at + 1 : at - 1;
    items[(next + items.length) % items.length]?.focus();
  };

  return (
    <div
      ref={ref}
      popover="auto"
      role="menu"
      aria-label={label}
      onToggle={(e) => {
        if (e.newState === "closed") onClose();
      }}
      onKeyDown={onKeyDown}
      className="menu fixed m-0 min-w-52 rounded-lg p-1 text-[13px] font-normal text-content"
      style={{ inset: "auto", left: anchor.x, top: anchor.y }}
    >
      {children}
    </div>
  );
}

export function MenuItem({
  icon: Icon,
  children,
  onSelect,
  danger,
  disabled,
}: {
  icon: (props: IconProps) => React.ReactNode;
  children: React.ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onSelect}
      className={`flex h-7 w-full items-center gap-2 rounded-md px-2 text-left outline-none focus-visible:bg-selection-strong enabled:hover:bg-selection-strong disabled:opacity-40 ${
        danger ? "text-danger" : ""
      }`}
    >
      <Icon size={15} className={danger ? "" : "text-content/60"} />
      {children}
    </button>
  );
}

/** Non-interactive text at the top of a menu (e.g. whose menu it is). */
export function MenuHeader({ children }: { children: React.ReactNode }) {
  return <div className="px-2 pt-1 pb-1.5 text-xs text-content/55">{children}</div>;
}

export function MenuSeparator() {
  return <div role="separator" className="mx-1 my-1 h-px bg-stroke" />;
}
