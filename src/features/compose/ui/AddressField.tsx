import { useId, useRef, useState } from "react";
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
        value={text}
        onChange={(e) => {
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
          commitText();
          setAnchor(null);
        }}
        className="h-7 min-w-[8rem] flex-1 bg-transparent outline-none focus-visible:outline-none"
      />
      {trailing}
      {open && (
        <ul
          id={listId}
          role="listbox"
          className="menu fixed z-50 max-h-72 overflow-y-auto rounded-lg p-1"
          style={{ left: anchor.left, top: anchor.top, width: Math.min(anchor.width, 420) }}
          // Keep focus in the box while clicking a suggestion.
          onMouseDown={(e) => e.preventDefault()}
        >
          {suggestions.map((s, i) => (
            <li
              key={s.email}
              role="option"
              aria-selected={i === current}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(s)}
              className={`flex cursor-default flex-col rounded-md px-2.5 py-1.5 ${
                i === current ? "bg-selection-strong" : ""
              }`}
            >
              <span className="truncate">{s.name ?? s.email}</span>
              {s.name && <span className="truncate text-xs text-content/50">{s.email}</span>}
            </li>
          ))}
        </ul>
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
