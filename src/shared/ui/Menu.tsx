import { useEffect, useRef } from "react";
import { nextMenuIndex } from "../lib/menuNavigation";
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
 * A small pop-up menu. It sits in the browser's top layer (a manual
 * popover), so it floats above panels that clip their content. It closes
 * on Escape, on a press that starts outside it, or when the window loses
 * focus. As in macOS menus, nothing is highlighted until the pointer or
 * an arrow key picks an item.
 *
 * The browser's own "auto" popover closing wasn't used: it judges the
 * whole click, so a right-click that opened the menu closed it again
 * when the button came up.
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
  // The latest onClose, so the listeners below don't re-subscribe each render.
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

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
    // The menu itself takes focus, so keys reach it without highlighting
    // an item.
    el.focus();

    const onPointerDown = (e: PointerEvent) => {
      if (!(e.target instanceof Node && el.contains(e.target))) close.current();
    };
    const onBlur = () => close.current();
    // Listeners start after this press, so the press that opened the menu
    // can't close it.
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("blur", onBlur);
      if (el.matches(":popover-open")) el.hidePopover();
    };
  }, [anchor]);

  const items = () => [
    ...(ref.current?.querySelectorAll<HTMLElement>("[role=menuitem]:not(:disabled)") ?? []),
  ];
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLElement);
    list[nextMenuIndex(at, list.length, e.key)]?.focus();
  };

  return (
    <div
      ref={ref}
      popover="manual"
      role="menu"
      tabIndex={-1}
      aria-label={label}
      onKeyDown={onKeyDown}
      // The pointer moves the highlight, so it and the keyboard never
      // highlight two different items.
      onPointerMove={(e) => {
        const item = (e.target as Element).closest<HTMLElement>("[role=menuitem]:not(:disabled)");
        if (item && item !== document.activeElement) item.focus();
      }}
      onPointerLeave={() => ref.current?.focus()}
      className="menu fixed m-0 min-w-52 rounded-lg p-1 text-[13px] font-normal text-content outline-none"
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
  hint,
}: {
  icon: (props: IconProps) => React.ReactNode;
  children: React.ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** The key that does the same, shown faintly at the right. */
  hint?: string;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onSelect}
      className={`flex h-7 w-full items-center gap-2 rounded-md px-2 text-left outline-none focus:bg-selection-strong disabled:opacity-40 ${
        danger ? "text-danger" : ""
      }`}
    >
      <Icon size={15} className={danger ? "" : "text-content/60"} />
      {children}
      {hint && <kbd className="ml-auto pl-4 font-sans text-xs text-content/40">{hint}</kbd>}
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
