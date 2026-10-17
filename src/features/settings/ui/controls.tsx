import { CheckIcon } from "../../../shared/ui/icons";

/**
 * The Settings page's building blocks, after MonoCode's `SettingsView`:
 * a group is a titled, rounded card of rows; each row is a title, a line
 * saying what it does, and its control on the right.
 */

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="flex items-end gap-4 pb-6">
      <div className="min-w-0 flex-1">
        <h1 className="text-lg font-semibold text-content">{title}</h1>
        <p className="mt-1 text-[13px] text-content/50">{description}</p>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}

export function Group({
  title,
  description,
  action,
  children,
}: {
  title: React.ReactNode;
  description?: string;
  /** A button beside the title (e.g. "Restore defaults"). */
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="pt-8 first:pt-0">
      <div className="flex items-end gap-4 pb-2.5">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-[13px] font-semibold text-content">
            {title}
          </h2>
          {description && (
            <p className="mt-1 text-[12px] leading-relaxed text-content/45">{description}</p>
          )}
        </div>
        {action && <div className="shrink-0 pb-0.5">{action}</div>}
      </div>
      <div className="overflow-hidden rounded-xl border border-content/10 bg-content/[0.03]">
        {children}
      </div>
    </section>
  );
}

export function Row({
  label,
  description,
  children,
}: {
  label: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-6 border-b border-content/5 px-4 py-3.5 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-content">{label}</div>
        {description && (
          <div className="mt-1 text-[12px] leading-relaxed text-content/45">{description}</div>
        )}
      </div>
      {children !== undefined && (
        <div className="flex max-w-[60%] min-w-0 shrink-0 flex-wrap items-center justify-end gap-2">
          {children}
        </div>
      )}
    </div>
  );
}

export function Toggle({
  label,
  on,
  onChange,
  disabled = false,
}: {
  label: string;
  on: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-[120ms] disabled:cursor-not-allowed disabled:opacity-40 ${
        on ? "bg-accent" : "bg-content/20"
      }`}
    >
      <span
        className={`absolute top-0.5 size-4 rounded-full bg-white shadow-sm transition-[left] duration-[120ms] ${
          on ? "left-4.5" : "left-0.5"
        }`}
      />
    </button>
  );
}

export function Button({
  children,
  onClick,
  danger = false,
  disabled = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md border border-content/10 px-2.5 py-1 text-[12px] transition-colors duration-[120ms] disabled:opacity-40 ${
        danger
          ? "text-danger hover:border-danger/40 hover:bg-danger/10"
          : "text-content/75 hover:bg-selection hover:text-content"
      }`}
    >
      {children}
    </button>
  );
}

export function Slider({
  label,
  value,
  display,
  min,
  max,
  onChange,
  onReset,
}: {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  onChange: (value: number) => void;
  /** Double-click puts it back to the default, like the splitters. */
  onReset: () => void;
}) {
  return (
    <div className="flex w-60 max-w-full items-center gap-3">
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        aria-label={label}
        className="settings-slider min-w-0 flex-1"
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={onReset}
      />
      <span className="w-14 shrink-0 text-right text-[12px] text-content/70 tabular-nums">
        {display}
      </span>
    </div>
  );
}

/** A row of choices, one chosen (as MonoCode's). */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-grid shrink-0 gap-0.5 rounded-md border border-content/10 p-0.5 text-[12px]"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          disabled={disabled}
          onClick={() => onChange(option.value)}
          className={`min-w-0 rounded-[5px] px-2.5 py-1 transition-colors duration-[120ms] disabled:opacity-40 ${
            value === option.value
              ? "bg-selection-strong text-content"
              : "text-content/55 hover:text-content"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Round colour choices, the chosen one ticked (account and accent colours). */
export function Swatches<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string; color: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1.5">
      {options.map((o) => {
        const chosen = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={chosen}
            aria-label={o.label}
            title={o.label}
            onClick={() => onChange(o.value)}
            className={`flex size-5 items-center justify-center rounded-full text-white transition-shadow duration-[120ms] ${
              chosen ? "ring-2 ring-content/60 ring-offset-1 ring-offset-transparent" : ""
            }`}
            style={{ background: o.color }}
          >
            {chosen && <CheckIcon size={12} strokeWidth={2.5} />}
          </button>
        );
      })}
    </div>
  );
}
