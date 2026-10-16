import { useEffect, useId, useRef, useState } from "react";
import type { Address } from "../../../platform/tauri/bindings";
import { useContactSuggestions } from "../../../shared/lib/queries";
import {
  formatAddress,
  isValidEmail,
  parseAddresses,
  sameEmail,
  uniqueAddresses,
} from "../model/addresses";

type Anchor = { left: number; top: number; width: number };

/**
 * The matches under an address line. It sits in the browser's top layer
 * (a manual popover, like `Menu`), so no panel can clip it and no
 * transformed ancestor (the card's entrance animation) can move it: a
 * plain `position: fixed` list ended up off to the side, out of sight.
 */
function SuggestionList({
  id,
  anchor,
  suggestions,
  current,
  onHover,
  onPick,
}: {
  id: string;
  anchor: Anchor;
  suggestions: Address[];
  current: number;
  onHover: (index: number) => void;
  onPick: (a: Address) => void;
}) {
  const ref = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const el = ref.current;
    el?.showPopover();
    return () => {
      if (el?.matches(":popover-open")) el.hidePopover();
    };
  }, []);
  return (
    <ul
      ref={ref}
      id={id}
      popover="manual"
      role="listbox"
      className="menu fixed m-0 max-h-72 overflow-y-auto rounded-lg p-1 text-[13px] text-content"
      style={{ left: anchor.left, top: anchor.top, width: Math.min(anchor.width, 420) }}
      // Keep focus in the box while clicking a suggestion.
      onMouseDown={(e) => e.preventDefault()}
    >
      {suggestions.map((s, i) => (
        <li
          key={s.email}
          role="option"
          aria-selected={i === current}
          onMouseEnter={() => onHover(i)}
          onClick={() => onPick(s)}
          className={`flex cursor-default flex-col rounded-md px-2.5 py-1.5 ${
            i === current ? "bg-selection-strong" : ""
          }`}
        >
          <span className="truncate">{s.name ?? s.email}</span>
          {s.name && <span className="truncate text-xs text-content/50">{s.email}</span>}
        </li>
      ))}
    </ul>
  );
}

/**
 * A To/Cc/Bcc line: chosen people as chips, then a text box. Typing
 * suggests people from cached mail; ↑/↓ and Return or Tab pick one. A
 * comma, semicolon, Return or leaving the field turns typed text into
 * chips; Backspace in an empty box takes the last chip back for editing.
 */
export function AddressField({
  label,
  value,
  onChange,
  autoFocus,
  trailing,
}: {
  label: string;
  value: Address[];
  onChange: (next: Address[]) => void;
  autoFocus?: boolean;
  /** Shown at the end of the line (the Cc/Bcc toggles). */
  trailing?: React.ReactNode;
}) {
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);
  // Where the suggestion list sits (fixed, so scrolling panels can't clip
  // it). Measured in event handlers, not during render.
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const lineRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Set when Escape cancels typing, so the blur that follows (the app
  // blurs text boxes on Escape) doesn't turn the half-typed text into a chip.
  const cancelled = useRef(false);
  const listId = useId();

  const query = useContactSuggestions(anchor ? text : "");
  const suggestions = (query.data ?? []).filter(
    (s) => !value.some((v) => sameEmail(v.email, s.email)),
  );
  const open = anchor !== null && text.trim() !== "" && suggestions.length > 0;
  const current = Math.min(active, suggestions.length - 1);

  const measure = () => {
    const r = lineRef.current?.getBoundingClientRect();
    if (r) setAnchor({ left: r.left, top: r.bottom + 2, width: r.width });
  };
  const add = (list: Address[]) => {
    onChange(uniqueAddresses([...value, ...list]));
    setText("");
    setActive(0);
  };
  const commitText = () => {
    if (text.trim()) add(parseAddresses(text));
  };
  const pick = (a: Address) => {
    add([a]);
    inputRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((current + step + suggestions.length) % suggestions.length);
      return;
    }
    if ((e.key === "Enter" || e.key === "Tab") && open) {
      e.preventDefault();
      pick(suggestions[current]!);
      return;
    }
    if (e.key === "Enter" && text.trim()) {
      e.preventDefault();
      commitText();
      return;
    }
    if ((e.key === "," || e.key === ";") && text.trim()) {
      e.preventDefault();
      commitText();
      return;
    }
    if (e.key === "Backspace" && text === "" && value.length > 0) {
      e.preventDefault();
      const last = value.at(-1)!;
      onChange(value.slice(0, -1));
      setText(formatAddress(last));
      return;
    }
    if (e.key === "Escape" && open) {
      // Close the list only; the composer keeps focus.
      e.preventDefault();
      e.stopPropagation();
      setAnchor(null);
      return;
    }
    if (e.key === "Escape") {
      // Escape again: drop what was being typed (chips stay), then leave.
      cancelled.current = true;
      setText("");
    }
  };

  return (
    <div
      ref={lineRef}
      className="flex min-h-9 flex-wrap items-center gap-1 border-b border-stroke py-1"
      onClick={() => inputRef.current?.focus()}
    >
      <span className="w-12 shrink-0 text-content/45">{label}</span>
      {value.map((a) => (
        <Chip
          key={a.email.toLowerCase()}
          address={a}
          onRemove={() => onChange(value.filter((v) => v !== a))}
          onEdit={() => {
            onChange(value.filter((v) => v !== a));
            setText(formatAddress(a));
            inputRef.current?.focus();
          }}
        />
      ))}
      <input
        ref={inputRef}
        aria-label={label}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoFocus={autoFocus}
        // Addresses aren't words: macOS autocorrect and capitalisation
        // rewrote what was typed ("sam" became "Sam").
        autoCorrect="off"
        autoCapitalize="off"
        autoComplete="off"
        spellCheck={false}
        value={text}
        onChange={(e) => {
          cancelled.current = false;
          setText(e.target.value);
          setActive(0);
          measure();
        }}
        onFocus={measure}
        onKeyDown={onKeyDown}
        onPaste={(e) => {
          const pasted = e.clipboardData.getData("text");
          if (/[,;\n]/.test(pasted)) {
            e.preventDefault();
            add(parseAddresses(text + pasted));
          }
        }}
        onBlur={() => {
          if (!cancelled.current) commitText();
          cancelled.current = false;
          setAnchor(null);
        }}
        className="h-7 min-w-[8rem] flex-1 bg-transparent outline-none focus-visible:outline-none"
      />
      {trailing}
      {open && (
        <SuggestionList
          id={listId}
          anchor={anchor}
          suggestions={suggestions}
          current={current}
          onHover={setActive}
          onPick={pick}
        />
      )}
    </div>
  );
}

function Chip({
  address,
  onRemove,
  onEdit,
}: {
  address: Address;
  onRemove: () => void;
  onEdit: () => void;
}) {
  const valid = isValidEmail(address.email);
  return (
    <span
      title={valid ? formatAddress(address) : `“${address.email}” isn’t a valid email address`}
      className={`flex h-6 max-w-[16rem] items-center gap-0.5 rounded-md pr-0.5 pl-2 ${
        valid ? "bg-selection" : "bg-danger/15 text-danger"
      }`}
    >
      <button
        type="button"
        className="truncate"
        // Double-click edits, as in Mail.
        onDoubleClick={(e) => {
          e.stopPropagation();
          onEdit();
        }}
      >
        {address.name ?? address.email}
      </button>
      <button
        type="button"
        aria-label={`Remove ${address.email}`}
        className="rounded px-1 text-content/45 hover:bg-selection-strong hover:text-content"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
      >
        ✕
      </button>
    </span>
  );
}
