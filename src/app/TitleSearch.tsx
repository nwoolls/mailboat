import { useState } from "react";
import { ClearIcon, SearchIcon } from "../shared/ui/icons";

/** The search box's DOM id; `/` focuses it from anywhere. */
export const SEARCH_INPUT_ID = "mailboat-search";

/**
 * Search, centered in the title bar as in VS Code. It searches the view
 * picked in the sidebar (one account or all). Width shrinks with the window
 * so it never runs into the toolbar buttons.
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
  return (
    <div
      className={`absolute top-1/2 left-1/2 flex h-7 -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-md px-2.5 ring-1 transition-[background-color,box-shadow] duration-[120ms] [width:clamp(200px,calc(100vw-600px),440px)] ${
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
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
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
            onChange("");
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
    </div>
  );
}
