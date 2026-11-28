import { type Editor, EditorContent } from "@tiptap/react";
import { useEffect } from "react";
import { oneLine } from "../../templates/model/fields";
import { hasFields, useOneLineEditor } from "../../templates/ui/oneLineEditor";
import type { Draft } from "../model/draft";

/** Plain text as one line of HTML, for the editor to load. */
function lineHtml(text: string): string {
  const p = document.createElement("p");
  p.textContent = text;
  return p.outerHTML;
}

/**
 * A new message's subject line: one line of plain text, which can also
 * hold a template's field left empty (highlighted, asked about at Send,
 * replaced by typing over it), as the message's text can. `subject` stays
 * the plain text, which is what's sent and what everything else reads;
 * `subjectHtml` is kept beside it only while a field is in it. Return
 * sends, as Return in a text box of the form did.
 */
export function useSubjectLine(
  draft: Draft,
  onChange: (change: (d: Draft) => Draft) => void,
  onReturn: () => void,
  sending: boolean,
) {
  const editor = useOneLineEditor(draft.subjectHtml ?? lineHtml(draft.subject), {
    className: "outline-none py-2",
    onKey: (_view, event) => {
      if (event.key !== "Enter" || event.shiftKey || event.altKey) return false;
      // ⌘↩ is the form's (it sends); plain Return sends here too.
      if (!event.metaKey && !event.ctrlKey) onReturn();
      return true;
    },
    onChange: (ed) =>
      onChange((d) => ({
        ...d,
        subject: ed.getText(),
        subjectHtml: hasFields(ed) ? ed.getHTML() : undefined,
      })),
  });
  // Set from elsewhere (a template, the writing assistant, a reopened
  // draft, a `mailto:` link): shown here. Typing sets the same text, so it
  // isn't loaded again under the cursor.
  useEffect(() => {
    if (!editor || editor.isDestroyed || editor.getText() === draft.subject) return;
    editor.commands.setContent(oneLine(draft.subjectHtml ?? lineHtml(draft.subject)), {
      emitUpdate: false,
    });
  }, [editor, draft.subject, draft.subjectHtml]);
  useEffect(() => {
    editor?.setEditable(!sending, false);
  }, [editor, sending]);
  return editor;
}

export function SubjectLine({ editor, empty }: { editor: Editor | null; empty: boolean }) {
  return (
    <div className="relative flex min-h-9 items-center border-b border-stroke">
      <EditorContent editor={editor} className="min-w-0 flex-1" />
      {empty && (
        <span
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-0 -translate-y-1/2 text-content/45"
        >
          Subject
        </span>
      )}
    </div>
  );
}
