import { useEffect, useRef, useState } from "react";
import type { Address, Template, TemplateField } from "../../../platform/tauri/bindings";
import { accelLabel, primaryKey } from "../../../shared/lib/platform";
import { type FieldValue, type FieldValues, fieldsInOrder, fillSubject } from "../model/fields";

const KIND_LABELS: Record<TemplateField["kind"], string> = {
  text: "Text",
  longText: "Long text: one item per line",
  date: "Date",
  dateTime: "Date and time",
  choice: "Choice",
  auto: "Filled in for you",
};

const INPUT =
  "h-7 rounded-md bg-transparent px-2 ring-1 ring-stroke outline-none focus-visible:ring-2 focus-visible:ring-accent/70";

/**
 * Fill in: one row per field of a template, in the order they appear,
 * before it goes into the message. Tab moves between rows, ⌘↩ inserts,
 * Esc goes back without changing anything. A field left empty goes in
 * highlighted, to fill in in the message.
 */
export function FillInDialog({
  template,
  initial,
  people,
  onInsert,
  onCancel,
}: {
  template: Template;
  initial: FieldValues;
  /** Who the template adds to a new message ("" when it adds no one). */
  people: { to: Address[]; cc: Address[] } | null;
  onInsert: (values: FieldValues) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState(initial);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    el?.showModal();
    el?.querySelector<HTMLElement>("input, textarea, select, button[role=radio]")?.focus();
    return () => el?.close();
  }, []);
  const fields = fieldsInOrder(template);
  const set = (id: string, change: Partial<FieldValue>) =>
    setValues((v) => ({ ...v, [id]: { ...v[id]!, ...change } }));
  const subject = template.subject ? fillSubject(template.subject, template.fields, values) : "";
  const who = people && [...people.to, ...people.cc].map((a) => a.name || a.email).join(", ");

  return (
    <dialog
      ref={ref}
      aria-labelledby="fill-in-title"
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      onKeyDown={(e) => {
        // React passes keys up its own tree, portal or not: none reach the message.
        e.stopPropagation();
        if (e.key === "Enter" && primaryKey(e)) {
          e.preventDefault();
          onInsert(values);
        }
      }}
      className="dialog m-auto w-[38rem] max-w-[92vw] rounded-xl p-0 text-[13px] text-content"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onInsert(values);
        }}
      >
        <h2 id="fill-in-title" className="border-b border-stroke px-5 py-3 text-sm font-semibold">
          {template.name}
        </h2>
        <div className="grid max-h-[60vh] gap-3 overflow-y-auto px-5 py-4">
          {fields.map((f) => (
            <div key={f.id} className="grid grid-cols-[9rem_1fr] items-start gap-3">
              <div className="pt-1">
                <label htmlFor={`fill-${f.id}`} className="text-content/70">
                  {f.name}
                </label>
                <span id={`fill-${f.id}-kind`} className="block text-[11px] text-content/45">
                  {KIND_LABELS[f.kind]}
                </span>
              </div>
              <FieldInput field={f} value={values[f.id]!} onChange={(v) => set(f.id, v)} />
            </div>
          ))}
        </div>
        {subject && (
          <div className="mx-5 mb-4 rounded-lg bg-selection px-3 py-2">
            <div className="text-[11px] text-content/45">Subject</div>
            <div className="selectable">{subject}</div>
          </div>
        )}
        <div className="flex items-center gap-2 border-t border-stroke px-5 py-3">
          {who && (
            <span className="min-w-0 flex-1 truncate text-xs text-content/45" title={who}>
              To {who}
            </span>
          )}
          <span className={who ? "" : "flex-1"} />
          <button
            type="button"
            onClick={onCancel}
            className="h-7 rounded-md bg-selection px-3 hover:bg-selection-strong"
          >
            Cancel
          </button>
          <button
            type="submit"
            title={accelLabel("Cmd+Enter")}
            className="h-7 rounded-md bg-accent px-3 font-medium text-white hover:brightness-110"
          >
            Insert
          </button>
        </div>
      </form>
    </dialog>
  );
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: TemplateField;
  value: FieldValue;
  onChange: (v: Partial<FieldValue>) => void;
}) {
  const id = `fill-${field.id}`;
  const described = { "aria-describedby": `${id}-kind` };
  const dated = field.kind === "date" || field.kind === "dateTime" || field.auto === "today";
  if (dated)
    return (
      <div className="flex flex-wrap items-center gap-2">
        <input
          id={id}
          {...described}
          type="date"
          value={value.date}
          onChange={(e) => onChange({ date: e.target.value })}
          className={INPUT}
        />
        {field.kind === "dateTime" && (
          <input
            type="time"
            aria-label={`${field.name}: time`}
            value={value.start}
            onChange={(e) => onChange({ start: e.target.value })}
            className={INPUT}
          />
        )}
        {field.kind === "dateTime" && field.endTime && (
          <>
            <span className="text-content/45">to</span>
            <input
              type="time"
              aria-label={`${field.name}: end time`}
              value={value.end}
              onChange={(e) => onChange({ end: e.target.value })}
              className={INPUT}
            />
          </>
        )}
      </div>
    );
  if (field.kind === "longText")
    return (
      <textarea
        id={id}
        {...described}
        rows={4}
        value={value.text}
        onChange={(e) => onChange({ text: e.target.value })}
        className="min-h-20 rounded-md bg-transparent px-2 py-1.5 ring-1 ring-stroke outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
      />
    );
  if (field.kind === "choice")
    return (
      <select
        id={id}
        {...described}
        value={value.text}
        onChange={(e) => onChange({ text: e.target.value })}
        className={`${INPUT} justify-self-start`}
      >
        {field.choices.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    );
  return (
    <input
      id={id}
      {...described}
      type="text"
      value={value.text}
      placeholder="Left empty, it’s highlighted in the message"
      onChange={(e) => onChange({ text: e.target.value })}
      className={`${INPUT} placeholder:text-content/35`}
    />
  );
}
