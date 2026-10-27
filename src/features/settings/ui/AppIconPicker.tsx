import { BUILT_IN_ICON, iconLabel } from "../model/appIcon";

// The same SVGs the Dock pictures are rendered from, as previews.
const PREVIEWS = import.meta.glob<string>("../../../../design/icon/choices/*.svg", {
  query: "?url",
  import: "default",
  eager: true,
});

/** The picture of an app icon choice, as a URL. */
export function previewFor(choice: string): string | undefined {
  return Object.entries(PREVIEWS).find(([path]) => path.endsWith(`/${choice}.svg`))?.[1];
}

/** A grid of the app icon choices, the shown one outlined. */
export function AppIconPicker({
  choices,
  value,
  onChange,
  disabled = false,
}: {
  choices: string[];
  value: string;
  onChange: (choice: string) => void;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label="App icon" className="flex flex-wrap gap-1.5 pt-3">
      {choices.map((choice) => {
        const chosen = choice === value;
        const label = iconLabel(choice) + (choice === BUILT_IN_ICON ? " (built in)" : "");
        return (
          <button
            key={choice}
            type="button"
            role="radio"
            aria-checked={chosen}
            aria-label={label}
            title={label}
            disabled={disabled}
            onClick={() => onChange(choice)}
            className={`rounded-xl p-1 transition-colors duration-[120ms] disabled:opacity-40 ${
              chosen ? "bg-selection-strong ring-2 ring-accent" : "hover:bg-selection"
            }`}
          >
            <img src={previewFor(choice)} alt="" draggable={false} className="size-11" />
          </button>
        );
      })}
    </div>
  );
}
