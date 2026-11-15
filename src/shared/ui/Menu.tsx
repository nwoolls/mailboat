import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { nextMenuIndex } from "../lib/menuNavigation";
import { ChevronIcon, type IconProps } from "./icons";

/** A menu's items, plain or checkable, that can be highlighted. */
const ITEM = ":is([role=menuitem],[role=menuitemradio],[role=menuitemcheckbox]):not(:disabled)";

/**
 * A menu's own items: those whose nearest menu is `menu`, so a submenu's
 * items (inside it in the page) aren't counted as the parent's.
 */
function ownItems(menu: HTMLElement | null): HTMLElement[] {
  if (!menu) return [];
  return [...menu.querySelectorAll<HTMLElement>(ITEM)].filter(
    (item) => item.closest("[role=menu]") === menu,
  );
}

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

  const items = () => ownItems(ref.current);
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
        const item = (e.target as Element).closest<HTMLElement>(ITEM);
        if (item && item !== document.activeElement) item.focus();
      }}
      onPointerLeave={() => ref.current?.focus()}
      // Capped, so a long item ("Block <a very long address>") is cut off
      // with "…" rather than stretching the menu across the window.
      className="menu fixed m-0 max-w-80 min-w-52 rounded-lg p-1 text-[13px] font-normal text-content outline-none"
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
  checkable,
  checked,
}: {
  icon: (props: IconProps) => React.ReactNode;
  children: React.ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** The key that does the same, shown faintly at the right. */
  hint?: string;
  /**
   * One of several choices ("radio") or an on/off switch ("checkbox"), so
   * assistive technology hears whether it's `checked`, not only a ✓ icon.
   */
  checkable?: "radio" | "checkbox";
  checked?: boolean;
}) {
  return (
    <button
      type="button"
      role={checkable ? `menuitem${checkable}` : "menuitem"}
      aria-checked={checkable ? (checked ?? false) : undefined}
      disabled={disabled}
      onClick={onSelect}
      className={`flex h-7 w-full items-center gap-2 rounded-md px-2 text-left outline-none focus:bg-selection-strong disabled:opacity-40 ${
        danger ? "text-danger" : ""
      }`}
    >
      <Icon size={15} className={`shrink-0 ${danger ? "" : "text-content/60"}`} />
      {/* Cut off with "…" when too long; the whole text shows on hover. */}
      <span
        className="min-w-0 truncate"
        title={typeof children === "string" ? children : undefined}
      >
        {children}
      </span>
      {hint && (
        <kbd className="ml-auto shrink-0 pl-4 font-sans text-xs text-content/40">{hint}</kbd>
      )}
    </button>
  );
}

/** Non-interactive text at the top of a menu (e.g. whose menu it is). */
export function MenuHeader({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="truncate px-2 pt-1 pb-1.5 text-xs text-content/55"
      title={typeof children === "string" ? children : undefined}
    >
      {children}
    </div>
  );
}

export function MenuSeparator() {
  return <div role="separator" className="mx-1 my-1 h-px bg-stroke" />;
}

/**
 * An item that opens a submenu beside it, as in macOS menus: on hover (after
 * a moment), a click, or →. ← or Escape closes just the submenu and returns
 * to the item; picking something in it closes every menu (the caller's
 * `onSelect` does). Another item of the parent menu highlighted closes it,
 * after a moment, so the pointer can cross other items on its way to a
 * far corner of the submenu. The submenu sits inside the parent menu in
 * the page, so the parent's closing on an outside press, and its keys,
 * leave it alone.
 */
export function MenuSubmenu({
  icon: Icon,
  title,
  label,
  children,
}: {
  icon: (props: IconProps) => React.ReactNode;
  /** The item's text. */
  title: string;
  /** The submenu's accessible name. */
  label: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const item = useRef<HTMLButtonElement>(null);
  const sub = useRef<HTMLDivElement>(null);
  const hover = useRef(0);
  const leaving = useRef(0);
  // Focus goes into the submenu on opening by keyboard (or click).
  const focusFirst = useRef(false);
  useEffect(
    () => () => {
      window.clearTimeout(hover.current);
      window.clearTimeout(leaving.current);
    },
    [],
  );

  useLayoutEffect(() => {
    const el = sub.current;
    const at = item.current;
    if (!open || !el || !at) return;
    el.showPopover();
    const r = at.getBoundingClientRect();
    // Beside the item, overlapping the parent's edge a little so the
    // pointer never crosses a gap; on the left if there's no room.
    let left = r.right - 4;
    if (left + el.offsetWidth > window.innerWidth - 8) left = r.left - el.offsetWidth + 4;
    let top = r.top - 5;
    if (top + el.offsetHeight > window.innerHeight - 8)
      top = window.innerHeight - 8 - el.offsetHeight;
    el.style.left = `${Math.max(8, left)}px`;
    el.style.top = `${Math.max(8, top)}px`;
    // Opened by hover, focus stays on the item.
    if (focusFirst.current) ownItems(el)[0]?.focus();
    focusFirst.current = false;
    return () => {
      if (el.matches(":popover-open")) el.hidePopover();
    };
  }, [open]);

  // While open: another item of the parent highlighted (by the pointer or
  // the keys, wherever focus was) closes it after a moment; coming back to
  // this item or into the submenu meanwhile keeps it.
  useEffect(() => {
    const parent = item.current?.closest<HTMLElement>("[role=menu]");
    if (!open || !parent) return;
    const onFocusIn = (e: FocusEvent) => {
      const to = e.target as HTMLElement;
      window.clearTimeout(leaving.current);
      if (to === item.current || sub.current?.contains(to)) return;
      if (to.closest("[role=menu]") !== parent || !to.matches(ITEM)) return;
      leaving.current = window.setTimeout(() => setOpen(false), 250);
    };
    parent.addEventListener("focusin", onFocusIn);
    return () => {
      parent.removeEventListener("focusin", onFocusIn);
      window.clearTimeout(leaving.current);
    };
  }, [open]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) item.current?.focus();
  };
  // Into the submenu by keyboard: its first item, opening it if need be.
  const enter = () => {
    if (open) ownItems(sub.current)[0]?.focus();
    else {
      focusFirst.current = true;
      setOpen(true);
    }
  };

  return (
    <>
      <button
        ref={item}
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={enter}
        onPointerEnter={() => {
          window.clearTimeout(hover.current);
          hover.current = window.setTimeout(() => setOpen(true), 150);
        }}
        onPointerLeave={() => window.clearTimeout(hover.current)}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" || e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            enter();
          } else if (e.key === "Escape" && open) {
            // Only the submenu, as from inside it.
            e.preventDefault();
            e.stopPropagation();
            close(true);
          }
        }}
        className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left outline-none focus:bg-selection-strong aria-expanded:bg-selection-strong"
      >
        <Icon size={15} className="shrink-0 text-content/60" />
        <span className="min-w-0 truncate">{title}</span>
        <ChevronIcon size={13} className="ml-auto shrink-0 text-content/45" />
      </button>
      {open && (
        <div
          ref={sub}
          popover="manual"
          role="menu"
          tabIndex={-1}
          aria-label={label}
          onKeyDown={(e) => {
            // Its own keys: never also the parent's.
            e.stopPropagation();
            if (e.key === "Escape" || e.key === "ArrowLeft") {
              e.preventDefault();
              close(true);
              return;
            }
            if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
            e.preventDefault();
            const list = ownItems(sub.current);
            const at = list.indexOf(document.activeElement as HTMLElement);
            list[nextMenuIndex(at, list.length, e.key)]?.focus();
          }}
          onPointerMove={(e) => {
            e.stopPropagation();
            const hit = (e.target as Element).closest<HTMLElement>(ITEM);
            if (hit && hit !== document.activeElement) hit.focus();
          }}
          className="menu fixed m-0 max-w-80 min-w-44 rounded-lg p-1 text-[13px] font-normal text-content outline-none"
          style={{ inset: "auto" }}
        >
          {children}
        </div>
      )}
    </>
  );
}
