import { useState } from "react";
import { forget, suggestions } from "../features/search/model/history";
import { rememberSearch, searchHistory } from "../features/search/ui/history";
import { ClearIcon, SearchIcon } from "../shared/ui/icons";

/** The search box's DOM id; `/` focuses it from anywhere. */
export const SEARCH_INPUT_ID = "mailboat-search";

/**
 * Search, centered in the title bar as in VS Code. It searches the view
 * picked in the sidebar (one account or all). Width shrinks with the window
 * so it never runs into the toolbar buttons.
 *
 * Focused, it offers recent searches below (those containing what's typed):
 * ↑/↓ and Return, or a click, pick one; Esc puts the list away; each can be
 * removed, or all cleared. Return saves the search typed.
 */
export function TitleSearch({
  value,
  onChange,
}: {
  value: string;
  onChange: (text: string) => void;
}) {
  // Tracked in state rather than with :focus-within, which WebKit doesn't
  // always restyle when the window goes to the background and back.
  const [focused, setFocused] = useState(false);
  const history = searchHistory.use();
  // Put away by Esc or a pick, until the text changes or focus returns.
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(-1);
  const offered = focused && !dismissed ? suggestions(history, value) : [];
  const change = (text: string) => {
    setDismissed(false);
    setActive(-1);
    onChange(text);
  };
  const pick = (text: string) => {
    onChange(text);
    rememberSearch(text);
    setDismissed(true);
    setActive(-1);
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (offered.length === 0) return;
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      // Through the list and back to what's typed (-1), round and round.
      const n = offered.length + 1;
      setActive((i) => ((i + 1 + step + n) % n) - 1);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const chosen = offered[active];
      if (chosen !== undefined) pick(chosen);
      else {
        rememberSearch(value);
        setDismissed(true);
      }
      return;
    }
    // The first Esc only puts the list away; the next leaves the box.
    if (e.key === "Escape" && offered.length > 0) {
      e.preventDefault();
      e.stopPropagation();
      setDismissed(true);
      setActive(-1);
    }
  };
  return (
    <div
      // z-30: the centring transform makes this its own layer, so without
      // it the panels below would draw over the recent-searches list.
      className={`absolute top-1/2 left-1/2 z-30 flex h-7 -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-md px-2.5 ring-1 transition-[background-color,box-shadow] duration-[120ms] [width:clamp(200px,calc(100vw-600px),440px)] ${
        focused
          ? "search-glow bg-selection ring-accent/50"
          : "bg-selection-subtle ring-stroke hover:bg-selection"
      }`}
    >
      <SearchIcon size={14} className="shrink-0 text-content/50" />
      <input
        id={SEARCH_INPUT_ID}
        type="text"
        role="searchbox"
        aria-label="Search mail"
        spellCheck={false}
        autoComplete="off"
        value={value}
        onChange={(e) => change(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => {
          setFocused(true);
          setDismissed(false);
          setActive(-1);
        }}
        onBlur={() => setFocused(false)}
        aria-expanded={offered.length > 0}
        aria-controls={HISTORY_ID}
        aria-activedescendant={active >= 0 ? `${HISTORY_ID}-${active}` : undefined}
        placeholder="Search mail"
        // The box shows focus with its border and glow; the field's own
        // focus outline would draw a second, inner box.
        className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-content/40 focus-visible:outline-none"
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear search"
          title="Clear search"
          onClick={() => {
            change("");
            document.getElementById(SEARCH_INPUT_ID)?.focus();
          }}
          className="-mr-1 flex h-5 w-5 shrink-0 items-center justify-center rounded text-content/50 hover:bg-selection hover:text-content"
        >
          <ClearIcon size={12} />
        </button>
      ) : (
        !focused && (
          <kbd className="shrink-0 rounded border border-stroke px-1.5 font-sans text-[11px] leading-4 text-content/45">
            /
          </kbd>
        )
      )}
      {offered.length > 0 && (
        <div
          // Clicks here keep the focus in the box.
          onMouseDown={(e) => e.preventDefault()}
          className="menu absolute inset-x-0 top-full z-50 mt-1.5 rounded-lg p-1 text-[13px]"
        >
          <div className="px-2 pt-1 pb-1 text-xs text-content/45">Recent searches</div>
          <ul id={HISTORY_ID} role="listbox" aria-label="Recent searches">
            {offered.map((text, i) => (
              <li
                key={text}
                id={`${HISTORY_ID}-${i}`}
                role="option"
                aria-selected={i === active}
                onClick={() => pick(text)}
                onMouseMove={() => setActive(i)}
                className={`group flex h-7 cursor-default items-center gap-2 rounded-md px-2 ${
                  i === active ? "bg-selection-strong" : ""
                }`}
              >
                <SearchIcon size={12} className="shrink-0 text-content/40" />
                <span className="min-w-0 flex-1 truncate">{text}</span>
                <button
                  type="button"
                  aria-label={`Remove “${text}”`}
                  title="Remove from recent searches"
                  onClick={(e) => {
                    e.stopPropagation();
                    searchHistory.set(forget(history, text));
                    setActive(-1);
                  }}
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-content/40 opacity-0 group-hover:opacity-100 group-aria-selected:opacity-100 hover:bg-selection hover:text-content"
                >
                  <ClearIcon size={10} />
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => searchHistory.set([])}
            className="mt-0.5 flex h-7 w-full items-center rounded-md px-2 text-left text-xs text-content/55 hover:bg-selection"
          >
            Clear recent searches
          </button>
        </div>
      )}
    </div>
  );
}

const HISTORY_ID = "mailboat-search-history";
