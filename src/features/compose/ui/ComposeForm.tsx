import { useEffect, useRef, useState } from "react";
import type { Account, Identity } from "../../../platform/tauri/bindings";
import { ConfirmDialog } from "../../../shared/ui/ConfirmDialog";
import { AccountDot } from "../../../shared/ui/AccountDot";
import { TrashIcon } from "../../../shared/ui/icons";
import type { ComposeEntry } from "../model/composeState";
import { type Draft, hasChanges, sendProblem, withIdentity } from "../model/draft";
import { AddressField } from "./AddressField";
import { EditorBody, FormatBar, useRichEditor } from "./RichEditor";

/**
 * The fields of a message being written: From (when there's a choice),
 * To/Cc/Bcc, Subject (new messages), the text, then Send and Discard.
 * ⌘↩ sends. Shared by the floating card and inline replies.
 */
export function ComposeForm({
  entry,
  identities,
  accounts,
  inline,
  onChange,
  onSend,
  onDiscard,
}: {
  entry: ComposeEntry;
  identities: Identity[];
  accounts: Account[];
  /** In the reader, under the conversation: no subject, the text grows. */
  inline?: boolean;
  onChange: (change: (d: Draft) => Draft) => void;
  onSend: () => void;
  onDiscard: () => void;
}) {
  const { draft, sending, error } = entry;
  const [problem, setProblem] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  // Loaded once with the draft's opening HTML (the quote, for replies);
  // a different draft gets a fresh form (keyed by draft ID).
  const editor = useRichEditor(draft.html, ({ html, text, edited }) =>
    onChange((d) => ({ ...d, html, text, edited: d.edited || edited })),
  );

  // Replies start in the text, above the quote (new messages and
  // forwards start in To). Asked again (focusKey) when `r` is pressed on
  // a conversation already being answered.
  useEffect(() => {
    if ((draft.kind === "new" || draft.kind === "forward") && entry.focusKey === 0) return;
    if (!editor) return;
    editor.commands.focus(entry.focusKey === 0 ? "start" : undefined);
    formRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [editor, draft.kind, entry.focusKey]);

  useEffect(() => {
    editor?.setEditable(!sending);
  }, [editor, sending]);

  const trySend = () => {
    const why = sendProblem(draft);
    setProblem(why);
    if (!why && !sending) onSend();
  };
  const discard = () => (hasChanges(draft) ? setConfirming(true) : onDiscard());
  const account = accounts.find((a) => a.id === draft.accountId);
  const message = problem ?? error;

  return (
    <form
      ref={formRef}
      aria-label={draft.kind === "new" ? "New message" : "Reply"}
      className={`flex min-h-0 flex-col text-[13px] ${inline ? "" : "flex-1"}`}
      onSubmit={(e) => {
        e.preventDefault();
        trySend();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.metaKey) {
          e.preventDefault();
          trySend();
        }
      }}
    >
      <fieldset disabled={sending} className="flex min-h-0 flex-1 flex-col px-4">
        {identities.length > 1 && (
          <div className="flex h-9 items-center gap-1 border-b border-stroke">
            <span className="w-12 shrink-0 text-content/45">From</span>
            <AccountDot account={account} />
            <select
              aria-label="From"
              className="min-w-0 flex-1 truncate bg-transparent py-1 outline-none"
              value={`${draft.accountId}:${draft.from.email}`}
              onChange={(e) => {
                const picked = identities.find(
                  (i) => `${i.accountId}:${i.email}` === e.target.value,
                );
                if (picked) onChange((d) => withIdentity(d, picked));
              }}
            >
              {accounts.map((a) => (
                <optgroup key={a.id} label={a.email}>
                  {identities
                    .filter((i) => i.accountId === a.id)
                    .map((i) => (
                      <option key={i.email} value={`${i.accountId}:${i.email}`}>
                        {i.name ? `${i.name} <${i.email}>` : i.email}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </div>
        )}
        <AddressFieldRow draft={draft} onChange={onChange} />
        {!inline && (
          <input
            aria-label="Subject"
            placeholder="Subject"
            value={draft.subject}
            onChange={(e) => onChange((d) => ({ ...d, subject: e.target.value }))}
            className="h-9 border-b border-stroke bg-transparent outline-none placeholder:text-content/45 focus-visible:outline-none"
          />
        )}
        <EditorBody
          editor={editor}
          className={inline ? "min-h-40" : "min-h-0 flex-1 overflow-y-auto"}
        />
      </fieldset>
      <FormatBar editor={editor} />
      <div className="flex shrink-0 items-center gap-3 px-4 pt-1 pb-3">
        <button
          type="submit"
          disabled={sending}
          title="Send (⌘↩)"
          className="h-7 rounded-md bg-accent px-3.5 font-medium text-white hover:brightness-110 disabled:opacity-60"
        >
          {sending ? "Sending…" : "Send"}
        </button>
        {message && (
          <span
            role="alert"
            className="selectable min-w-0 flex-1 truncate text-xs text-danger"
            title={message}
          >
            {message}
          </span>
        )}
        <button
          type="button"
          aria-label="Discard"
          title="Discard"
          disabled={sending}
          onClick={discard}
          className="ml-auto flex h-7 w-7 items-center justify-center rounded-md text-content/60 hover:bg-selection hover:text-content disabled:opacity-35"
        >
          <TrashIcon />
        </button>
      </div>
      {confirming && (
        <ConfirmDialog
          title="Discard this message?"
          confirmLabel="Discard"
          danger
          onConfirm={() => {
            setConfirming(false);
            onDiscard();
          }}
          onCancel={() => setConfirming(false)}
        >
          <p>What you’ve written will be lost. Drafts aren’t saved to Gmail yet.</p>
        </ConfirmDialog>
      )}
    </form>
  );
}

function AddressFieldRow({
  draft,
  onChange,
}: {
  draft: Draft;
  onChange: (change: (d: Draft) => Draft) => void;
}) {
  const toggle = (field: "showCc" | "showBcc", label: string) =>
    !draft[field] && (
      <button
        type="button"
        className="rounded px-1.5 py-0.5 text-content/50 hover:bg-selection hover:text-content"
        onClick={(e) => {
          e.stopPropagation();
          onChange((d) => ({ ...d, [field]: true }));
        }}
      >
        {label}
      </button>
    );
  return (
    <>
      <AddressField
        label="To"
        value={draft.to}
        autoFocus={draft.kind === "new" || draft.kind === "forward"}
        onChange={(to) => onChange((d) => ({ ...d, to }))}
        trailing={
          <span className="ml-auto flex shrink-0">
            {toggle("showCc", "Cc")}
            {toggle("showBcc", "Bcc")}
          </span>
        }
      />
      {draft.showCc && (
        <AddressField
          label="Cc"
          value={draft.cc}
          onChange={(cc) => onChange((d) => ({ ...d, cc }))}
        />
      )}
      {draft.showBcc && (
        <AddressField
          label="Bcc"
          value={draft.bcc}
          onChange={(bcc) => onChange((d) => ({ ...d, bcc }))}
        />
      )}
    </>
  );
}
