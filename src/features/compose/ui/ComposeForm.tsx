import { useEffect, useRef, useState } from "react";
import type { Account, Identity } from "../../../platform/tauri/bindings";
import { ConfirmDialog } from "../../../shared/ui/ConfirmDialog";
import { AccountDot } from "../../../shared/ui/AccountDot";
import { AttachmentIcon, ClearIcon, TrashIcon } from "../../../shared/ui/icons";
import type { OutgoingAttachment } from "../../../platform/tauri/bindings";
import { formatSize } from "../../reader/model/attachments";
import { attachmentSize } from "../model/draft";
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
    // false: don't report this as an edit (TipTap emits "update" by default,
    // which marked untouched drafts as typed in and froze the signature).
    editor?.setEditable(!sending, false);
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
        <div className={inline ? "" : "min-h-0 flex-1 overflow-y-auto"}>
          <EditorBody
            editor={editor}
            className={draft.quote || draft.signature ? "" : "min-h-40"}
          />
          {draft.signature && (
            // Read-only, as it will be sent (Gmail's own HTML). It follows
            // the From address; edit signatures in Gmail's settings.
            <div className="pt-4 pb-3" title="Signature (changes with From)">
              <HtmlPreview title="Signature" html={draft.signature} />
            </div>
          )}
          {draft.quoteText && <QuoteFold html={draft.quote} startOpen={draft.kind === "forward"} />}
        </div>
      </fieldset>
      {draft.attachments.length > 0 && (
        <AttachmentChips
          files={draft.attachments}
          onRemove={(i) =>
            onChange((d) => ({ ...d, attachments: d.attachments.filter((_, j) => j !== i) }))
          }
        />
      )}
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
        <AttachButton
          disabled={sending}
          onFiles={(files) =>
            onChange((d) => ({ ...d, attachments: [...d.attachments, ...files] }))
          }
        />
        <button
          type="button"
          aria-label="Discard"
          title="Discard"
          disabled={sending}
          onClick={discard}
          className="flex h-7 w-7 items-center justify-center rounded-md text-content/60 hover:bg-selection hover:text-content disabled:opacity-35"
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

/**
 * The quoted original under the text, folded behind "…" as in Gmail
 * (forwards start open), shown as it will be sent: its own formatting,
 * in a sandboxed frame (cleaned in Rust; no scripts can run). Read-only.
 */
function QuoteFold({ html, startOpen }: { html: string; startOpen: boolean }) {
  const [open, setOpen] = useState(startOpen);
  return (
    <div className="pb-3">
      <button
        type="button"
        title={open ? "Hide quoted text" : "Show quoted text"}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="h-4 rounded-full bg-selection px-2 text-xs leading-none text-content/60 hover:bg-selection-strong"
      >
        •••
      </button>
      {open && (
        <div className="mt-2">
          <HtmlPreview title="Quoted message" html={html} />
        </div>
      )}
    </div>
  );
}

/**
 * Mail HTML shown as it will be sent, on white as mail apps show it, in a
 * sandboxed frame: same-origin only so its height can be read, never
 * scripts. Its height follows the content once images have loaded.
 */
function HtmlPreview({ title, html }: { title: string; html: string }) {
  return (
    <iframe
      title={title}
      sandbox="allow-same-origin"
      srcDoc={`<!doctype html><meta charset="utf-8"><body style="margin:0;padding:8px 10px;font:13px Arial,Helvetica,sans-serif;color:#222">${html}</body>`}
      onLoad={(e) => {
        const doc = e.currentTarget.contentDocument;
        if (doc) e.currentTarget.style.height = `${doc.documentElement.scrollHeight}px`;
      }}
      className="block w-full rounded-md bg-white"
    />
  );
}

/** Reads a picked file as base64 for sending. */
async function readFile(file: File): Promise<OutgoingAttachment> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  // In chunks: spreading a large file into one call overflows the stack.
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return {
    filename: file.name,
    mimeType: file.type || "application/octet-stream",
    data: btoa(binary),
  };
}

/** The paperclip: the system file picker, several files at once. */
function AttachButton({
  disabled,
  onFiles,
}: {
  disabled: boolean;
  onFiles: (files: OutgoingAttachment[]) => void;
}) {
  return (
    <label
      title="Attach files"
      aria-disabled={disabled}
      className="ml-auto flex h-7 w-7 cursor-default items-center justify-center rounded-md text-content/60 hover:bg-selection hover:text-content"
    >
      <AttachmentIcon />
      <input
        type="file"
        multiple
        disabled={disabled}
        aria-label="Attach files"
        className="hidden"
        onChange={(e) => {
          const picked = [...(e.target.files ?? [])];
          e.target.value = "";
          void Promise.all(picked.map(readFile)).then(onFiles);
        }}
      />
    </label>
  );
}

function AttachmentChips({
  files,
  onRemove,
}: {
  files: OutgoingAttachment[];
  onRemove: (index: number) => void;
}) {
  return (
    <ul className="flex flex-wrap gap-1.5 px-4 pb-2" aria-label="Attachments">
      {files.map((f, i) => (
        <li
          key={`${f.filename}:${f.data.length}:${f.data.slice(-24)}`}
          className="flex h-7 max-w-60 items-center gap-1.5 rounded-md bg-selection pr-0.5 pl-2 text-xs"
        >
          <AttachmentIcon size={13} className="shrink-0 text-content/55" />
          <span className="truncate" title={f.filename}>
            {f.filename}
          </span>
          <span className="shrink-0 text-content/45">{formatSize(attachmentSize(f))}</span>
          <button
            type="button"
            aria-label={`Remove ${f.filename}`}
            onClick={() => onRemove(i)}
            className="rounded p-1 text-content/45 hover:bg-selection-strong hover:text-content"
          >
            <ClearIcon size={12} />
          </button>
        </li>
      ))}
    </ul>
  );
}
