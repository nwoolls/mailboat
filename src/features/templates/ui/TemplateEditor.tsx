import { type Editor, EditorContent, Node, useEditor } from "@tiptap/react";
import type { EditorView } from "@tiptap/pm/view";
import { StarterKit } from "@tiptap/starter-kit";
import { useEffect, useRef, useState } from "react";
import type {
  Address,
  AutoValue,
  DayDefault,
  FieldKind,
  Template,
  TemplateField,
} from "../../../platform/tauri/bindings";
import { accelLabel, primaryKey } from "../../../shared/lib/platform";
import { useIdentities, useSaveTemplate } from "../../../shared/lib/queries";
import { showToast } from "../../../shared/lib/toast";
import type { AddressLine } from "../../compose/model/addresses";
import { AddressField } from "../../compose/ui/AddressField";
import { EditorBody, FormatBar, useRichEditor } from "../../compose/ui/RichEditor";
import { type DateFormat, formatsFor, oneLine, tidyName } from "../model/fields";
import {
  type FieldAttrs,
  fieldPositions,
  insertField,
  selectedField,
  TemplateFieldNode,
  updateFieldEverywhere,
} from "./fieldNode";

const KINDS: { kind: FieldKind; label: string; hint: string }[] = [
  { kind: "text", label: "Text", hint: "One line" },
  { kind: "longText", label: "Long text", hint: "One item per line" },
  { kind: "date", label: "Date", hint: "A day" },
  { kind: "dateTime", label: "Date and time", hint: "A day and a time" },
  { kind: "choice", label: "Choice", hint: "One of a list" },
  { kind: "auto", label: "Filled in for you", hint: "A first name, or today" },
];

const AUTOS: { value: AutoValue; label: string }[] = [
  { value: "recipientFirstName", label: "The recipient’s first name" },
  { value: "myFirstName", label: "Your first name" },
  { value: "today", label: "Today’s date" },
];

const DAYS: { value: DayDefault | null; label: string }[] = [
  { value: null, label: "Today" },
  { value: "tomorrow", label: "Tomorrow" },
  { value: "monday", label: "Next Monday" },
  { value: "tuesday", label: "Next Tuesday" },
  { value: "wednesday", label: "Next Wednesday" },
  { value: "thursday", label: "Next Thursday" },
  { value: "friday", label: "Next Friday" },
  { value: "saturday", label: "Next Saturday" },
  { value: "sunday", label: "Next Sunday" },
];

/** How each date format reads, with an example (a made-up day). */
export const FORMAT_LABELS: Record<DateFormat, string> = {
  long: "Long date: Monday, January 11, 2027",
  short: "Short date: Jan 11, 2027",
  monthYear: "Month and year: January 2027",
  longTime: "Long date and time: Monday, January 11, 2027 at 9:00 PM",
  time: "Time: 9:00 PM",
};

const INPUT =
  "h-7 rounded-md bg-transparent px-2 ring-1 ring-stroke outline-none focus-visible:ring-2 focus-visible:ring-accent/70";

/** A field dialog's controls fill its width (a long option can't widen it). */
const FIELD_INPUT = `${INPUT} w-full min-w-0`;

/** The subject's document: one paragraph, never more. */
const OneLine = Node.create({ name: "doc", topNode: true, content: "paragraph" });

/** The subject's editor: one line of text and fields. */
function useSubjectEditor(
  html: string,
  onKey: (view: EditorView, event: KeyboardEvent) => boolean,
) {
  return useEditor({
    extensions: [
      OneLine,
      StarterKit.configure({
        document: false,
        blockquote: false,
        bold: false,
        bulletList: false,
        code: false,
        codeBlock: false,
        dropcursor: false,
        gapcursor: false,
        hardBreak: false,
        heading: false,
        horizontalRule: false,
        italic: false,
        link: false,
        listItem: false,
        listKeymap: false,
        orderedList: false,
        strike: false,
        trailingNode: false,
        underline: false,
      }),
      TemplateFieldNode,
    ],
    // One line, as the editor holds no more (a subject saved otherwise
    // would lose its other paragraphs).
    content: oneLine(html),
    editorProps: {
      attributes: {
        class: "outline-none py-1.5",
        "aria-label": "Subject",
        role: "textbox",
        "aria-multiline": "false",
      },
      // One line: Return does nothing (⌘↩ saves, through the dialog), but
      // on a selected field it opens its settings.
      handleKeyDown: (view, event) => onKey(view, event) || event.key === "Enter",
      // A pasted line break or paragraph becomes a space, so words don't run
      // together on the one line.
      transformPastedText: (text) => text.replace(/\s*[\r\n]+\s*/g, " "),
      transformPastedHTML: (pasted) => oneLine(pasted),
    },
  });
}

let nextField = 0;
function newFieldId(): string {
  nextField += 1;
  return `f${Date.now().toString(36)}${nextField}`;
}

/** A field being added at the cursor, or one placed in the text being changed. */
type FieldEdit =
  | { mode: "add"; editor: Editor }
  | { mode: "edit"; editor: Editor; pos: number; attrs: FieldAttrs };

/**
 * A template's editor: name, an optional From and people, then the subject
 * and the text in the composer's own editor, with Add field. A click on a
 * field changes it. ⌘↩ saves.
 */
export function TemplateEditor({
  template,
  onClose,
}: {
  template: Template | null;
  onClose: () => void;
}) {
  const identities = useIdentities().data ?? [];
  const save = useSaveTemplate();
  const [name, setName] = useState(template?.name ?? "");
  const [from, setFrom] = useState(template?.from ?? "");
  const [people, setPeople] = useState<Record<AddressLine, Address[]>>({
    to: template?.to ?? [],
    cc: template?.cc ?? [],
    bcc: template?.bcc ?? [],
  });
  const [showCc, setShowCc] = useState((template?.cc.length ?? 0) > 0);
  const [showBcc, setShowBcc] = useState((template?.bcc.length ?? 0) > 0);
  const [fields, setFields] = useState<TemplateField[]>(template?.fields ?? []);
  const [fieldEdit, setFieldEdit] = useState<FieldEdit | null>(null);
  const [dragOver, setDragOver] = useState<AddressLine | null>(null);
  // Return on a field selected from the keyboard opens its settings, as a
  // click does. The editors are made once, so they reach the handler
  // through a ref that follows each render.
  const fieldKey = useRef<(view: EditorView, event: KeyboardEvent) => boolean>(() => false);
  const subject = useSubjectEditor(template?.subject ?? "", (v, e) => fieldKey.current(v, e));
  const body = useRichEditor(template?.body ?? "", () => {}, {
    onKey: (v, e) => fieldKey.current(v, e),
  });
  useEffect(() => {
    fieldKey.current = (view, event) => {
      if (event.key !== "Enter" || primaryKey(event)) return false;
      const editor = [subject, body].find((e) => e?.view === view);
      const at = editor ? selectedField(editor) : null;
      if (!editor || !at) return false;
      setFieldEdit({ mode: "edit", editor, pos: at.pos, attrs: at.attrs });
      return true;
    };
  });
  // Where Add field puts a field: the last of the two that had the cursor.
  const lastFocused = useRef<"subject" | "body">("body");
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    el?.showModal();
    el?.querySelector<HTMLInputElement>("#template-name")?.focus();
    return () => el?.close();
  }, []);

  const placed = () => {
    const ids = new Set<string>();
    for (const ed of [subject, body])
      if (ed) for (const p of fieldPositions(ed)) ids.add(p.attrs.field);
    return ids;
  };
  const submit = () => {
    if (!subject || !body) return;
    const ids = placed();
    save.mutate(
      {
        id: template?.id ?? null,
        input: {
          name,
          from: from || null,
          ...people,
          subject: subject.isEmpty ? "" : subject.getHTML(),
          body: body.isEmpty ? "" : body.getHTML(),
          // A field taken out of the text goes with its last copy.
          fields: fields.filter((f) => ids.has(f.id)),
        },
      },
      {
        onSuccess: () => {
          onClose();
          showToast({ message: template ? "Template saved" : "Template added" });
        },
      },
    );
  };
  const onFieldClick = (editor: Editor | null) => (e: React.MouseEvent) => {
    const el = e.target instanceof Element ? e.target.closest(".template-field") : null;
    if (!editor || !el) return;
    const at = fieldPositions(editor).find((p) => editor.view.nodeDOM(p.pos) === el);
    if (at) setFieldEdit({ mode: "edit", editor, pos: at.pos, attrs: at.attrs });
  };
  const lineProps = (line: AddressLine) => ({
    line,
    value: people[line],
    onChange: (next: Address[]) => setPeople((p) => ({ ...p, [line]: next })),
    dropTarget: dragOver === line,
    onDragOver: setDragOver,
    onMove: (address: Address, to: AddressLine) =>
      setPeople((p) => ({
        ...p,
        [line]: p[line].filter((a) => a !== address),
        [to]: [...p[to], address],
      })),
  });

  return (
    <dialog
      ref={ref}
      aria-labelledby="template-editor-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!save.isPending && !fieldEdit) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && primaryKey(e) && !save.isPending && !fieldEdit) {
          e.preventDefault();
          submit();
        }
      }}
      className="dialog template-fields m-auto w-[44rem] max-w-[94vw] rounded-xl p-5 text-[13px] text-content"
    >
      <h2 id="template-editor-title" className="mb-3 text-sm font-semibold">
        {template ? "Edit template" : "New template"}
      </h2>
      <div className="rounded-lg px-3 ring-1 ring-stroke">
        <div className="flex h-9 items-center gap-2 border-b border-stroke">
          <label htmlFor="template-name" className="w-14 shrink-0 text-content/45">
            Name
          </label>
          <input
            id="template-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="min-w-0 flex-1 bg-transparent font-medium outline-none"
          />
        </div>
        <div className="flex h-9 items-center gap-2 border-b border-stroke">
          <label htmlFor="template-from" className="w-14 shrink-0 text-content/45">
            From
          </label>
          <select
            id="template-from"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="min-w-0 flex-1 truncate bg-transparent py-1 outline-none"
          >
            <option value="">The message’s own (optional)</option>
            {identities.map((i) => (
              <option key={`${i.accountId}:${i.email}`} value={i.email}>
                {i.name ? `${i.name} <${i.email}>` : i.email}
              </option>
            ))}
            {from && !identities.some((i) => i.email.toLowerCase() === from.toLowerCase()) && (
              <option value={from}>{from} (no longer one of your addresses)</option>
            )}
          </select>
        </div>
        <AddressField
          label="To"
          {...lineProps("to")}
          trailing={
            <span className="ml-auto flex shrink-0 items-center">
              {!showCc && (
                <button
                  type="button"
                  className="rounded px-1.5 py-0.5 text-content/50 hover:bg-selection hover:text-content"
                  onClick={() => setShowCc(true)}
                >
                  Cc
                </button>
              )}
              {!showBcc && (
                <button
                  type="button"
                  className="rounded px-1.5 py-0.5 text-content/50 hover:bg-selection hover:text-content"
                  onClick={() => setShowBcc(true)}
                >
                  Bcc
                </button>
              )}
            </span>
          }
        />
        {showCc && <AddressField label="Cc" {...lineProps("cc")} />}
        {showBcc && <AddressField label="Bcc" {...lineProps("bcc")} />}
        <div
          className="flex items-center gap-2"
          onFocus={() => (lastFocused.current = "subject")}
          onClick={onFieldClick(subject)}
        >
          <span className="w-14 shrink-0 text-content/45">Subject</span>
          <EditorContent editor={subject} className="min-w-0 flex-1" />
        </div>
      </div>
      <div className="mt-3 rounded-lg ring-1 ring-stroke">
        <div className="flex items-center border-b border-stroke py-1 pr-2">
          <div className="min-w-0 flex-1">
            <FormatBar editor={body} />
          </div>
          <button
            type="button"
            onClick={() => {
              const editor = lastFocused.current === "subject" ? subject : body;
              if (editor) setFieldEdit({ mode: "add", editor });
            }}
            className="h-7 shrink-0 rounded-md px-2.5 text-accent hover:bg-selection"
          >
            Add field
          </button>
        </div>
        <div
          className="flex max-h-[45vh] min-h-40 flex-col overflow-y-auto"
          onFocus={() => (lastFocused.current = "body")}
          onClick={onFieldClick(body)}
        >
          <EditorBody
            editor={body}
            className="flex flex-1 flex-col [&>.ProseMirror]:flex-1 [&>.ProseMirror]:px-3"
          />
        </div>
      </div>
      <p className="mt-2 text-xs text-content/50">
        Fields are filled in each time the template is used. Click one to change it. The message
        adds the signature, as usual.
      </p>
      {save.error && <p className="selectable mt-3 text-xs text-danger">{save.error.message}</p>}
      <div className="mt-4 flex items-center gap-2">
        <span className="flex-1" />
        <button
          type="button"
          disabled={save.isPending}
          onClick={onClose}
          className="h-7 rounded-md bg-selection px-3 hover:bg-selection-strong disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          title={accelLabel("Cmd+Enter")}
          disabled={save.isPending}
          onClick={submit}
          className="h-7 rounded-md bg-accent px-3 font-medium text-white hover:brightness-110 disabled:opacity-50"
        >
          {save.isPending ? "Saving…" : "Save"}
        </button>
      </div>
      {fieldEdit && (
        <FieldDialog
          edit={fieldEdit}
          fields={fields}
          onDone={(field, format) => {
            const { editor } = fieldEdit;
            setFields((list) =>
              list.some((f) => f.id === field.id)
                ? list.map((f) => (f.id === field.id ? field : f))
                : [...list, field],
            );
            // A new name shows on every copy, in the subject and the text.
            for (const ed of [subject, body])
              if (ed) updateFieldEverywhere(ed, field.id, { label: field.name });
            if (fieldEdit.mode === "add")
              insertField(editor, { field: field.id, format, label: field.name });
            else {
              editor.view.dispatch(
                editor.state.tr.setNodeMarkup(fieldEdit.pos, undefined, {
                  ...fieldEdit.attrs,
                  label: field.name,
                  format,
                }),
              );
              editor.commands.focus();
            }
            setFieldEdit(null);
          }}
          onRemove={(id) => {
            for (const ed of [subject, body]) if (ed) updateFieldEverywhere(ed, id, null);
            setFields((list) => list.filter((f) => f.id !== id));
            setFieldEdit(null);
          }}
          onCancel={() => {
            fieldEdit.editor.commands.focus();
            setFieldEdit(null);
          }}
        />
      )}
    </dialog>
  );
}

/**
 * Adding a field (a new one, or one the template already has, in another
 * place) or changing one. Its kind and settings belong to the field
 * everywhere; how a date is written belongs to this place.
 */
function FieldDialog({
  edit,
  fields,
  onDone,
  onRemove,
  onCancel,
}: {
  edit: FieldEdit;
  fields: TemplateField[];
  onDone: (field: TemplateField, format: string | null) => void;
  onRemove: (id: string) => void;
  onCancel: () => void;
}) {
  const existing = edit.mode === "edit" ? fields.find((f) => f.id === edit.attrs.field) : undefined;
  const blank: TemplateField = {
    id: newFieldId(),
    name: "",
    kind: "text",
    choices: [],
    auto: null,
    defaultDay: null,
    endTime: false,
  };
  const [field, setField] = useState<TemplateField>(
    existing ??
      (edit.mode === "edit" ? { ...blank, id: edit.attrs.field, name: edit.attrs.label } : blank),
  );
  const [format, setFormat] = useState<string | null>(
    edit.mode === "edit" ? edit.attrs.format : null,
  );
  const [choices, setChoices] = useState(field.choices.join("\n"));
  const [problem, setProblem] = useState<string | null>(null);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    el?.showModal();
    el?.querySelector<HTMLElement>("select, input")?.focus();
    return () => el?.close();
  }, []);
  const reusing = edit.mode === "add" && fields.some((f) => f.id === field.id);
  const formats = formatsFor(field.kind, field.auto);
  const shownFormat = formats.includes(format as DateFormat) ? format : (formats[0] ?? null);
  const set = (change: Partial<TemplateField>) => setField((f) => ({ ...f, ...change }));

  const done = () => {
    const name = tidyName(field.name);
    const list = choices
      .split("\n")
      .map((c) => c.trim())
      .filter(Boolean);
    if (!name) return setProblem("Give the field a name.");
    if (fields.some((f) => f.id !== field.id && f.name.trim().toLowerCase() === name.toLowerCase()))
      return setProblem(
        `There’s already a field called “${name}”. Pick it from the list to use it again.`,
      );
    if (field.kind === "choice" && list.length === 0) return setProblem("Add at least one choice.");
    onDone(
      {
        ...field,
        name,
        choices: field.kind === "choice" ? list : [],
        auto: field.kind === "auto" ? (field.auto ?? "recipientFirstName") : null,
      },
      shownFormat,
    );
  };
  const label = "grid min-w-0 gap-1";
  const caption = "text-[11px] text-content/50";

  return (
    <dialog
      ref={ref}
      aria-labelledby="field-dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && primaryKey(e)) {
          e.preventDefault();
          e.stopPropagation();
          done();
        }
      }}
      className="dialog m-auto w-[24rem] max-w-[92vw] overflow-hidden rounded-xl p-4 text-[13px] text-content"
    >
      <form
        className="grid min-w-0 gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          done();
        }}
      >
        <h3 id="field-dialog-title" className="text-sm font-semibold">
          {edit.mode === "add" ? "Add field" : "Field"}
        </h3>
        {edit.mode === "add" && fields.length > 0 && (
          <label className={label}>
            <span className={caption}>Field</span>
            <select
              value={reusing ? field.id : ""}
              onChange={(e) => {
                const f = fields.find((x) => x.id === e.target.value);
                const next = f ?? { ...blank };
                setField(next);
                setChoices(next.choices.join("\n"));
                setFormat(null);
              }}
              className={FIELD_INPUT}
            >
              <option value="">A new field</option>
              {fields.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}, again
                </option>
              ))}
            </select>
          </label>
        )}
        {!reusing && (
          <>
            <label className={label}>
              <span className={caption}>Name</span>
              <input
                value={field.name}
                onChange={(e) => set({ name: e.target.value })}
                placeholder="Window"
                className={`${FIELD_INPUT} placeholder:text-content/35`}
              />
            </label>
            <label className={label}>
              <span className={caption}>Kind</span>
              <select
                value={field.kind}
                onChange={(e) => set({ kind: e.target.value as FieldKind })}
                className={FIELD_INPUT}
              >
                {KINDS.map((k) => (
                  <option key={k.kind} value={k.kind}>
                    {k.label}: {k.hint}
                  </option>
                ))}
              </select>
            </label>
            {field.kind === "choice" && (
              <label className={label}>
                <span className={caption}>Choices, one per line</span>
                <textarea
                  rows={3}
                  value={choices}
                  onChange={(e) => setChoices(e.target.value)}
                  className="rounded-md bg-transparent px-2 py-1 ring-1 ring-stroke outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
                />
              </label>
            )}
            {field.kind === "auto" && (
              <label className={label}>
                <span className={caption}>Filled in with</span>
                <select
                  value={field.auto ?? "recipientFirstName"}
                  onChange={(e) => set({ auto: e.target.value as AutoValue })}
                  className={FIELD_INPUT}
                >
                  {AUTOS.map((a) => (
                    <option key={a.value} value={a.value}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {(field.kind === "date" || field.kind === "dateTime") && (
              <label className={label}>
                <span className={caption}>Starts on</span>
                <select
                  value={field.defaultDay ?? ""}
                  onChange={(e) =>
                    set({ defaultDay: (e.target.value || null) as DayDefault | null })
                  }
                  className={FIELD_INPUT}
                >
                  {DAYS.map((d) => (
                    <option key={d.label} value={d.value ?? ""}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {field.kind === "dateTime" && (
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={field.endTime}
                  onChange={(e) => set({ endTime: e.target.checked })}
                />
                With an end time
              </label>
            )}
          </>
        )}
        {formats.length > 0 && (
          <label className={label}>
            <span className={caption}>Written here as</span>
            <select
              value={shownFormat ?? ""}
              onChange={(e) => setFormat(e.target.value)}
              className={FIELD_INPUT}
            >
              {formats.map((f) => (
                <option key={f} value={f}>
                  {FORMAT_LABELS[f]}
                </option>
              ))}
            </select>
          </label>
        )}
        {problem && <p className="text-xs text-danger">{problem}</p>}
        <div className="flex items-center gap-2">
          {edit.mode === "edit" && (
            <button
              type="button"
              onClick={() => onRemove(field.id)}
              className="h-7 rounded-md px-2.5 text-danger hover:bg-danger/10"
            >
              Remove everywhere
            </button>
          )}
          <span className="flex-1" />
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
            {edit.mode === "add" ? "Add" : "Done"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
