import type { Editor } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import type { Identity, Template } from "../../../platform/tauri/bindings";
import { accelLabel, primaryKey } from "../../../shared/lib/platform";
import { useSaveTemplate, useTemplateAction, useTemplates } from "../../../shared/lib/queries";
import { showToast } from "../../../shared/lib/toast";
import { TemplateIcon } from "../../../shared/ui/icons";
import { type Draft, textToHtml } from "../../compose/model/draft";
import { templateIdentity, withTemplateFields } from "../model/apply";
import {
  emptySubjectFields,
  type FieldValues,
  fillBody,
  fillSubject,
  startingValues,
  withoutFieldMarks,
} from "../model/fields";
import { FillInDialog } from "./FillInDialog";
import { focusWhereItWas, insertHtmlAtCursor } from "./fieldNode";
import { openTemplateSettings, TemplatePicker } from "./TemplatePicker";

/**
 * The composer's Templates button (and ⇧⌘T): the list to pick from, Fill
 * in for a template with fields, then the template's text at the cursor as
 * one undo step. In a new message it also fills From, the people and the
 * subject where they're empty; a reply only gets the text. The signature
 * and the quote sit outside the text, so they're never touched.
 */
export function ComposerTemplates({
  editor,
  draft,
  identities,
  open,
  onOpenChange,
  onChange,
  disabled,
  className = "",
}: {
  className?: string;
  editor: Editor | null;
  draft: Draft;
  identities: Identity[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (change: (d: Draft) => Draft) => void;
  disabled?: boolean;
}) {
  const templates = useTemplates().data;
  const used = useTemplateAction();
  const [filling, setFilling] = useState<{ template: Template; initial: FieldValues } | null>(null);
  const [savingAs, setSavingAs] = useState(false);

  // Fill in closes first (at once), so the text can take focus: nothing
  // outside a modal dialog can while it's open.
  const closeFillIn = () => flushSync(() => setFilling(null));
  const insert = (t: Template, values: FieldValues) => {
    closeFillIn();
    if (!editor || editor.isDestroyed) return;
    const body = fillBody(t.body, t.fields, values);
    const subject = t.subject ? fillSubject(t.subject, t.fields, values) : "";
    const waiting = t.subject ? emptySubjectFields(t.subject, t.fields, values) : [];
    // From, people and subject first: putting the text in counts as writing,
    // after which From no longer changes.
    onChange((d) => {
      const next = withTemplateFields(d, t, identities, subject);
      // Only when the subject is the template's (one already there is kept).
      return next.subject === subject && subject ? { ...next, waitingInSubject: waiting } : next;
    });
    if (body.trim()) insertHtmlAtCursor(editor, body);
    else focusWhereItWas(editor);
    used.mutate({ id: t.id, action: "used" });
  };
  const pick = (t: Template) => {
    onOpenChange(false);
    if (t.fields.length === 0) return insert(t, {});
    // What the message will have once the template is in: its people if
    // it has none, and its From if nothing is written yet, which "your
    // first name" is taken from.
    const to = draft.kind === "new" && draft.to.length === 0 ? t.to : draft.to;
    const identity = templateIdentity(draft, t, identities);
    const from = identity ? { name: identity.name, email: identity.email } : draft.from;
    setFilling({
      template: t,
      initial: startingValues(t.fields, { to, from, now: new Date() }),
    });
  };

  // A new message started from a template in ⌘K: put it in once both the
  // editor and the list are ready.
  const pending = draft.pendingTemplate;
  const started = useRef(false);
  useEffect(() => {
    if (pending === undefined || !editor || !templates || started.current) return;
    started.current = true;
    onChange((d) => ({ ...d, pendingTemplate: undefined }));
    const t = templates.find((x) => x.id === pending);
    if (t) pick(t);
    else showToast({ tone: "error", message: "That template no longer exists." });
    // `pick` reads the draft as it is now, which is what's wanted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, editor, templates]);

  const written = draft.text.trim() !== "" || draft.subject.trim() !== "";
  return (
    <span className={`relative flex ${className}`}>
      <button
        type="button"
        aria-label="Templates"
        aria-haspopup="dialog"
        aria-expanded={open}
        title={`Templates (${accelLabel("Shift+Cmd+T")})`}
        disabled={disabled}
        onClick={() => onOpenChange(!open)}
        className={`flex h-7 w-7 items-center justify-center rounded-md hover:bg-selection hover:text-content disabled:opacity-35 ${
          open ? "bg-selection text-accent" : "text-content/60"
        }`}
      >
        <TemplateIcon />
      </button>
      {open && (
        <TemplatePicker
          templates={templates ?? []}
          canSaveAs={written}
          onPick={pick}
          onSaveAs={() => {
            onOpenChange(false);
            setSavingAs(true);
          }}
          onClose={() => {
            onOpenChange(false);
            if (editor) focusWhereItWas(editor);
          }}
        />
      )}
      {/* In the page's body, not inside the message's own form: a form
          can't hold another, and its keys mustn't send the message. */}
      {filling &&
        createPortal(
          <FillInDialog
            template={filling.template}
            initial={filling.initial}
            people={
              draft.kind === "new" && filling.template.to.length + filling.template.cc.length > 0
                ? {
                    to: draft.to.length ? draft.to : filling.template.to,
                    cc: draft.cc.length ? draft.cc : filling.template.cc,
                  }
                : null
            }
            onInsert={(values) => insert(filling.template, values)}
            onCancel={() => {
              closeFillIn();
              if (editor) focusWhereItWas(editor);
            }}
          />,
          document.body,
        )}
      {savingAs &&
        createPortal(
          <SaveAsTemplateDialog
            draft={draft}
            onClose={() => {
              flushSync(() => setSavingAs(false));
              if (editor) focusWhereItWas(editor);
            }}
          />,
          document.body,
        )}
    </span>
  );
}

/**
 * Save as template: what's written (and the subject and people, if
 * ticked) as a new template. "Save and edit" opens it in Settings, for
 * adding fields. The signature, a reply's quote and attachments are never
 * part of it.
 */
function SaveAsTemplateDialog({ draft, onClose }: { draft: Draft; onClose: () => void }) {
  const [name, setName] = useState(draft.subject.trim());
  const hasSubject = draft.kind === "new" && draft.subject.trim() !== "";
  const hasPeople =
    draft.kind === "new" && draft.to.length + draft.cc.length + draft.bcc.length > 0;
  const [keepSubject, setKeepSubject] = useState(hasSubject);
  const [keepPeople, setKeepPeople] = useState(false);
  const save = useSaveTemplate();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    el?.showModal();
    el?.querySelector("input")?.select();
    return () => el?.close();
  }, []);
  const submit = (thenEdit: boolean) =>
    save.mutate(
      {
        id: null,
        input: {
          name,
          from: keepPeople ? draft.from.email : null,
          to: keepPeople ? draft.to : [],
          cc: keepPeople ? draft.cc : [],
          bcc: keepPeople ? draft.bcc : [],
          subject: keepSubject ? textToHtml(draft.subject) : "",
          body: withoutFieldMarks(draft.html),
          fields: [],
        },
      },
      {
        onSuccess: (t) => {
          onClose();
          showToast({ message: `Saved as the template “${t.name}”` });
          if (thenEdit) openTemplateSettings({ edit: t.id });
        },
      },
    );
  const check = "flex items-center gap-2";
  return (
    <dialog
      ref={ref}
      aria-labelledby="save-template-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!save.isPending) onClose();
      }}
      onKeyDown={(e) => {
        // React passes keys up its own tree, portal or not: none reach the message.
        e.stopPropagation();
        if (e.key === "Enter" && primaryKey(e) && !save.isPending) {
          e.preventDefault();
          submit(false);
        }
      }}
      className="dialog m-auto w-[26rem] max-w-[92vw] rounded-xl p-5 text-[13px] text-content"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          // React passes a submit up its own tree, through the portal, to
          // the message's form, whose submit sends.
          e.stopPropagation();
          submit(false);
        }}
      >
        <h2 id="save-template-title" className="mb-3 text-sm font-semibold">
          Save as template
        </h2>
        <label className="grid gap-1">
          <span className="text-content/70">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-7 rounded-md bg-transparent px-2 ring-1 ring-stroke outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
          />
        </label>
        {(hasSubject || hasPeople) && (
          <div className="mt-3 grid gap-1.5">
            {hasSubject && (
              <label className={check}>
                <input
                  type="checkbox"
                  checked={keepSubject}
                  onChange={(e) => setKeepSubject(e.target.checked)}
                />
                Keep the subject
              </label>
            )}
            {hasPeople && (
              <label className={check}>
                <input
                  type="checkbox"
                  checked={keepPeople}
                  onChange={(e) => setKeepPeople(e.target.checked)}
                />
                Keep From and the people it’s to
              </label>
            )}
          </div>
        )}
        <p className="mt-3 text-xs text-content/50">
          The signature and attachments aren’t kept. Add fields to fill in each time in Settings →
          Templates.
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
            disabled={save.isPending}
            onClick={() => submit(true)}
            className="h-7 rounded-md bg-selection px-3 hover:bg-selection-strong disabled:opacity-50"
          >
            Save and edit
          </button>
          <button
            type="submit"
            title={accelLabel("Cmd+Enter")}
            disabled={save.isPending}
            className="h-7 rounded-md bg-accent px-3 font-medium text-white hover:brightness-110 disabled:opacity-50"
          >
            {save.isPending ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
