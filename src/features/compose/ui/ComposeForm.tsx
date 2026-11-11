import { useEffect, useRef, useState } from "react";
import { REPLY_FOLLOW_EVENT } from "../../../shared/lib/replyFollow";
import type { Account, Address, Identity } from "../../../platform/tauri/bindings";
import { type AddressLine, moveAddress } from "../model/addresses";
import { ConfirmDialog } from "../../../shared/ui/ConfirmDialog";
import { AccountDot } from "../../../shared/ui/AccountDot";
import {
  AiIcon,
  AttachmentIcon,
  ClearIcon,
  ForwardIcon,
  ReplyAllIcon,
  ReplyIcon,
  TrashIcon,
} from "../../../shared/ui/icons";
import type { OutgoingAttachment } from "../../../platform/tauri/bindings";
import { formatSize } from "../../reader/model/attachments";
import { attachmentSize } from "../model/draft";
import type { ComposeEntry } from "../model/composeState";
import {
  type ComposeKind,
  type Draft,
  hasChanges,
  sendProblem,
  withIdentity,
} from "../model/draft";
import { AssistantPanel, type UseMode } from "../../ai/ui/AssistantPanel";
import { RewriteButton } from "../../ai/ui/RewriteButton";
import { InlineReveal } from "../../ai/ui/InlineReveal";
import { AddressField } from "./AddressField";
import { HtmlPreview } from "./HtmlPreview";
import { EditorBody, FormatBar, useRichEditor } from "./RichEditor";
import { composingPrefs } from "./composingPrefs";
import { useStuck } from "../../../shared/ui/useStuck";
import { accelLabel, primaryKey } from "../../../shared/lib/platform";

export type ReplyKind = Exclude<ComposeKind, "new">;

export const KIND_LABELS: Record<ReplyKind, string> = {
  reply: "Reply",
  replyAll: "Reply all",
  forward: "Forward",
};

/**
 * The fields of a message being written: From (when there's a choice),
 * To/Cc/Bcc, Subject (new messages), the text, then Send and Discard.
 * ⌘↩ sends. Shared by the floating card and inline replies.
 */
/** About how tall the pinned formatting and Send bar is, in pixels. */
const PINNED_FOOT_HEIGHT = 96;

/** The longest a newly opened reply is kept in view while it lays out. */
const REPLY_FOLLOW_MS = 10_000;
/** How far the reader has to move up for that to be the person reading. */
const REPLY_FOLLOW_UP_PX = 8;
/** As far as following scrolls at once rather than smoothly. */
const REPLY_FOLLOW_AT_ONCE_PX = 40;

export function ComposeForm({
  entry,
  identities,
  accounts,
  inline,
  onChange,
  onSend,
  onDiscard,
  onSwitchKind,
  assistant,
}: {
  entry: ComposeEntry;
  identities: Identity[];
  accounts: Account[];
  /** In the reader, under the conversation: no subject, the text grows. */
  inline?: boolean;
  onChange: (change: (d: Draft) => Draft) => void;
  onSend: () => void;
  onDiscard: () => void;
  /** Offered for replies that can turn into another kind. */
  onSwitchKind?: (kind: ReplyKind) => void;
  /**
   * The writing assistant (⌘J): beside the form in the floating card,
   * above it inline. Its parent keeps whether it's open, so the card can
   * widen for it.
   */
  assistant?: {
    open: boolean;
    /** Still drawn while it animates closed. */
    shown: boolean;
    /** In the card: the side it opens on, and the form's fixed width. */
    side?: "left" | "right";
    formWidth?: number;
    onToggle: (open: boolean) => void;
  };
}) {
  const { draft, sending, error } = entry;
  const { style } = composingPrefs.use();
  const [problem, setProblem] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [dropping, setDropping] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const [footMarker, footStuck] = useStuck();
  // Loaded once with the draft's opening HTML (the quote, for replies);
  // a different draft gets a fresh form (keyed by draft ID).
  const editor = useRichEditor(
    draft.html,
    ({ html, text, edited }) => onChange((d) => ({ ...d, html, text, edited: d.edited || edited })),
    // Inline, the pinned Send bar covers the reader's bottom edge: keep
    // the line being typed above it.
    inline ? { keepClearBelow: PINNED_FOOT_HEIGHT } : undefined,
  );

  // Replies start in the text, above the quote (new messages and
  // forwards start in To). Asked again (focusKey) when `r` is pressed on
  // a conversation already being answered.
  // The whole reply is scrolled into view, its header to its Send button,
  // and kept there while it finishes laying out (the signature loads a
  // moment later, an email above it is measured taller), not just the
  // line being typed on.
  // A reply that opens with the writing assistant ("Reply with AI") leaves
  // the cursor in the assistant's box instead. Read through a ref, so
  // opening or closing the assistant later doesn't move the cursor here.
  const assistantOpen = useRef(assistant?.open ?? false);
  useEffect(() => {
    assistantOpen.current = assistant?.open ?? false;
  });
  useEffect(() => {
    if ((draft.kind === "new" || draft.kind === "forward") && entry.focusKey === 0) return;
    if (!editor) return;
    // (Pressing `r` again still goes to the text.)
    if (!(assistantOpen.current && entry.focusKey === 0))
      editor.commands.focus(entry.focusKey === 0 ? "start" : undefined);
    const whole = formRef.current?.closest("section") ?? formRef.current;
    if (!whole) return;
    // Taller than the reader (the AI chat above it, say), its end shows:
    // "nearest" showed its top, the chat, with the reply out of sight.
    const scroller = whole.closest(".reader-scroll");
    // Where the follow is taking the reader, so its own scrolling (up too,
    // when the reply's end is already in view) isn't taken for the person's.
    let target = scroller?.scrollTop ?? 0;
    const show = () => {
      if (!scroller) {
        whole.scrollIntoView({ block: "nearest", behavior: "smooth" });
        return;
      }
      const view = scroller.getBoundingClientRect();
      const box = whole.getBoundingClientRect();
      // Taller than the reader: its end at the bottom. Otherwise the least
      // movement that shows all of it.
      let by = 0;
      if (box.height > view.height || box.bottom > view.bottom) by = box.bottom - view.bottom;
      else if (box.top < view.top) by = box.top - view.top;
      target = scroller.scrollTop + by;
      // WebKit leaves a smooth scroll of a pixel or two undone, so the
      // reply, growing a little at a time, ended a few pixels below the
      // reader. A short way (looks the same) goes at once.
      scroller.scrollTo({
        top: target,
        behavior: Math.abs(by) <= REPLY_FOLLOW_AT_ONCE_PX ? "instant" : "smooth",
      });
    };
    // The reader may still be landing on an email it just opened (a draft
    // reply resumes by itself): the reply takes over from it.
    scroller?.dispatchEvent(new Event(REPLY_FOLLOW_EVENT));
    show();
    const growing = new ResizeObserver(show);
    growing.observe(whole);
    // Inline, the reader's content too: whatever grows above moves it.
    const content = scroller?.firstElementChild;
    if (content) growing.observe(content);
    // Followed until the person scrolls or types (where they are then wins),
    // or for REPLY_FOLLOW_MS at most. A fixed second and a half wasn't enough
    // on a slow machine: the email above, the assistant and the signature
    // finished laying out after it, and the reply was left part way below.
    const stop = () => growing.disconnect();
    const byHand = ["wheel", "pointerdown", "keydown", "touchstart"] as const;
    for (const type of byHand) window.addEventListener(type, stop, { capture: true, once: true });
    // A wheel or a touch over an email (a sandboxed frame of its own, whose
    // input never reaches this window) shows only as the reader scrolling.
    // Following only ever scrolls down to the reply, so the reader moving up
    // is the person reading: stop.
    // Measured from the furthest down it has been, so slow scrolling in
    // small steps adds up.
    let furthest = scroller?.scrollTop ?? 0;
    const onScroll = () => {
      if (!scroller) return;
      furthest = Math.max(furthest, scroller.scrollTop);
      // Up past both the furthest point and where the follow is heading.
      if (scroller.scrollTop < Math.min(furthest, target) - REPLY_FOLLOW_UP_PX) stop();
    };
    scroller?.addEventListener("scroll", onScroll, { passive: true });
    const settled = window.setTimeout(stop, REPLY_FOLLOW_MS);
    return () => {
      stop();
      window.clearTimeout(settled);
      scroller?.removeEventListener("scroll", onScroll);
      for (const type of byHand) window.removeEventListener(type, stop, { capture: true });
    };
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
  // Nothing (signature, quoted text) under the message: it can fill the space.
  const fills = !(draft.quote || draft.signature);

  // The AI's draft: Insert adds it where the cursor was (the editor keeps
  // its selection while the chat has focus), Replace puts it in place of
  // the text. Signature and quote stay either way; new mail without a
  // subject takes the one suggested.
  const applyDraft = (html: string, subject: string | null, how: UseMode) => {
    if (!editor) return;
    if (how === "insert") {
      editor.chain().focus().insertContent(html).run();
    } else {
      editor.commands.setContent(html, { emitUpdate: true });
      editor.commands.focus("end");
    }
    if (subject && draft.kind === "new")
      onChange((d) => (d.subject.trim() ? d : { ...d, subject }));
  };
  const panel = assistant?.shown && (
    <AssistantPanel
      draft={draft}
      placement={inline ? "top" : (assistant.side ?? "left")}
      onUse={applyDraft}
      onClose={() => {
        assistant.onToggle(false);
        editor?.commands.focus();
      }}
    />
  );

  const form = (
    <form
      ref={formRef}
      // Files dropped anywhere on the message attach to it (checked before
      // the editor sees the drop, which would otherwise ignore them).
      onDragOverCapture={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        if (!dropping) setDropping(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false);
      }}
      onDropCapture={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        setDropping(false);
        if (sending) return;
        const files = [...e.dataTransfer.files];
        void Promise.all(files.map(readFile)).then((read) =>
          onChange((d) => ({ ...d, attachments: [...d.attachments, ...read] })),
        );
      }}
      aria-label={draft.kind === "new" ? "New message" : "Reply"}
      className={`relative flex min-h-0 flex-col text-[13px] ${inline ? "" : "flex-1"}`}
      onSubmit={(e) => {
        e.preventDefault();
        trySend();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && primaryKey(e)) {
          e.preventDefault();
          trySend();
        }
        if (e.key === "j" && primaryKey(e) && assistant) {
          e.preventDefault();
          assistant.onToggle(!assistant.open);
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
        <AddressFieldRow
          draft={draft}
          onChange={onChange}
          kindMenu={
            onSwitchKind &&
            draft.kind !== "new" && <KindMenu kind={draft.kind} onSwitch={onSwitchKind} />
          }
        />
        {/* Replies keep the conversation's subject, popped out too. */}
        {!inline && draft.kind === "new" && (
          <input
            aria-label="Subject"
            placeholder="Subject"
            value={draft.subject}
            onChange={(e) => onChange((d) => ({ ...d, subject: e.target.value }))}
            className="h-9 border-b border-stroke bg-transparent outline-none placeholder:text-content/45 focus-visible:outline-none"
          />
        )}
        {/* Never squeezed below a few lines by what's under it (a long
          list of attachments, say); that scrolls instead. */}
        {/* With nothing under it, the editor fills the space, so a click
          anywhere below the text puts the cursor in the message. */}
        <div
          className={
            inline ? "" : `min-h-28 flex-1 overflow-y-auto ${fills ? "flex flex-col" : ""}`
          }
        >
          <EditorBody
            editor={editor}
            className={
              fills
                ? `flex min-h-40 flex-col [&>.ProseMirror]:flex-1 ${inline ? "" : "flex-1"}`
                : ""
            }
            // Shown in the starting font it will be sent in (Settings → Composing).
            style={{ fontFamily: style.font || undefined, fontSize: style.size || undefined }}
          />
          {draft.signature && (
            // Read-only, as it will be sent (Gmail's own HTML). It follows
            // the From address; edit signatures in Gmail's settings.
            // pt-2 plus the editor's bottom padding makes one blank line,
            // the gap Gmail sends between the text and the signature.
            <div className="pt-2 pb-3" title="Signature (changes with From)">
              {/* Keyed so a new signature is measured afresh, not at the old height. */}
              <HtmlPreview key={draft.signature} title="Signature" html={draft.signature} />
            </div>
          )}
          {draft.quoteText && <QuoteFold html={draft.quote} startOpen={draft.kind === "forward"} />}
        </div>
      </fieldset>
      {draft.attachments.length + draft.forwarded.length > 0 && (
        <AttachmentChips
          files={[
            ...draft.forwarded.map((f) => ({
              key: `fwd:${f.id}`,
              name: f.filename,
              size: f.size,
              remove: () =>
                onChange((d) => ({ ...d, forwarded: d.forwarded.filter((x) => x.id !== f.id) })),
            })),
            ...draft.attachments.map((f, i) => ({
              key: `new:${f.filename}:${f.data.length}:${f.data.slice(-24)}`,
              name: f.filename,
              size: attachmentSize(f),
              remove: () =>
                onChange((d) => ({
                  ...d,
                  attachments: d.attachments.filter((_, j) => j !== i),
                })),
            })),
          ]}
        />
      )}
      {/* Inline in the reader, formatting and Send stay at the bottom of
        the window while a long reply or forward scrolls under them. */}
      <div
        className={inline ? "reader-foot reader-foot-in-card pt-2" : ""}
        data-stuck={(inline && footStuck) || undefined}
      >
        <FormatBar editor={editor}>
          {editor && <RewriteButton editor={editor} threadId={draft.threadId} />}
        </FormatBar>
        <div className="flex shrink-0 items-center gap-3 px-4 pt-1 pb-3">
          <button
            type="submit"
            disabled={sending}
            title={`Send (${accelLabel("Cmd+Enter")})`}
            className="h-7 rounded-md bg-accent px-3.5 font-medium text-white hover:brightness-110 disabled:opacity-60"
          >
            {sending ? "Sending…" : "Send"}
          </button>
          {!message && entry.save && (
            <span className="text-xs text-content/45" role="status">
              {entry.save === "saving"
                ? "Saving…"
                : entry.save === "saved"
                  ? "Saved to Drafts"
                  : "Couldn’t save the draft"}
            </span>
          )}
          {message && (
            <span
              role="alert"
              className="selectable min-w-0 flex-1 truncate text-xs text-danger"
              title={message}
            >
              {message}
            </span>
          )}
          {assistant && (
            <button
              type="button"
              aria-label="Write with AI"
              aria-pressed={assistant.open}
              title={`Write with AI (${accelLabel("Cmd+J")})`}
              disabled={sending}
              onClick={() => assistant.onToggle(!assistant.open)}
              className={`ml-auto flex h-7 w-7 items-center justify-center rounded-md hover:bg-selection hover:text-content disabled:opacity-35 ${
                assistant.open ? "bg-selection text-accent" : "text-content/60"
              }`}
            >
              <AiIcon />
            </button>
          )}
          <AttachButton
            className={assistant ? "" : "ml-auto"}
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
      </div>
      {inline && <div ref={footMarker} aria-hidden className="h-px" />}
      {dropping && (
        <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-accent bg-accent/10 text-[13px] font-medium text-accent">
          Drop to attach
        </div>
      )}
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
          <p>What you’ve written will be lost, and its saved draft deleted from Gmail.</p>
        </ConfirmDialog>
      )}
    </form>
  );
  // The same layout whether the assistant is open or not, so opening it
  // doesn't rebuild the form (which took the focus back into the editor
  // and away from the chat box).
  // Inline, the panel grows and shrinks above the reply, the reader
  // scrolling with it so the reply stays put. In the card the form keeps
  // its width and place while the card's spring widens it: the panel takes
  // whatever width the card has beyond the form, so it springs open and
  // collapses on its side.
  return inline ? (
    <>
      {panel && <InlineReveal open={assistant?.open ?? false}>{panel}</InlineReveal>}
      {form}
    </>
  ) : (
    <div className={`flex min-h-0 flex-1 ${assistant?.side === "right" ? "flex-row-reverse" : ""}`}>
      {panel && <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">{panel}</div>}
      <div
        className="flex min-w-0 flex-1 flex-col"
        style={assistant?.formWidth ? { flex: `0 0 ${assistant.formWidth}px` } : undefined}
      >
        {form}
      </div>
    </div>
  );
}

function AddressFieldRow({
  draft,
  onChange,
  kindMenu,
}: {
  draft: Draft;
  onChange: (change: (d: Draft) => Draft) => void;
  kindMenu?: React.ReactNode;
}) {
  // The line a dragged address chip is over, highlighted until it drops.
  const [dragOver, setDragOver] = useState<AddressLine | null>(null);
  const lineProps = (line: AddressLine) => ({
    line,
    dropTarget: dragOver === line,
    onDragOver: setDragOver,
    onMove: (address: Address, to: AddressLine) =>
      onChange((d) => moveAddress(d, address, line, to)),
  });
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
        {...lineProps("to")}
        value={draft.to}
        autoFocus={draft.kind === "new" || draft.kind === "forward"}
        onChange={(to) => onChange((d) => ({ ...d, to }))}
        trailing={
          <span className="ml-auto flex shrink-0 items-center">
            {kindMenu}
            {toggle("showCc", "Cc")}
            {toggle("showBcc", "Bcc")}
          </span>
        }
      />
      {draft.showCc && (
        <AddressField
          label="Cc"
          {...lineProps("cc")}
          value={draft.cc}
          onChange={(cc) => onChange((d) => ({ ...d, cc }))}
        />
      )}
      {draft.showBcc && (
        <AddressField
          label="Bcc"
          {...lineProps("bcc")}
          value={draft.bcc}
          onChange={(bcc) => onChange((d) => ({ ...d, bcc }))}
        />
      )}
    </>
  );
}

/**
 * Reply / Reply all / Forward, switched without starting over: a small
 * button showing the current kind, by Cc and Bcc on the To line, as in
 * Mimestream (Gmail has it left of the recipients). A native menu, opened
 * by a select laid invisibly over the button.
 */
function KindMenu({ kind, onSwitch }: { kind: ReplyKind; onSwitch: (kind: ReplyKind) => void }) {
  const Icon = kind === "forward" ? ForwardIcon : kind === "replyAll" ? ReplyAllIcon : ReplyIcon;
  return (
    <span
      title={`${KIND_LABELS[kind]}: change to reply, reply all or forward`}
      // Not the line's click, which would move the focus to the address box.
      onClick={(e) => e.stopPropagation()}
      className="relative mr-1 flex h-6 items-center gap-0.5 rounded px-1.5 text-content/50 hover:bg-selection hover:text-content"
    >
      <Icon size={14} />
      <span aria-hidden className="text-[9px] leading-none">
        ▾
      </span>
      <select
        aria-label="Kind of reply"
        value={kind}
        onChange={(e) => onSwitch(e.target.value as ReplyKind)}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        {(Object.keys(KIND_LABELS) as ReplyKind[]).map((k) => (
          <option key={k} value={k}>
            {KIND_LABELS[k]}
          </option>
        ))}
      </select>
    </span>
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
  className,
}: {
  disabled: boolean;
  onFiles: (files: OutgoingAttachment[]) => void;
  className: string;
}) {
  return (
    <label
      title="Attach files"
      aria-disabled={disabled}
      className={`${className} flex h-7 w-7 cursor-default items-center justify-center rounded-md text-content/60 hover:bg-selection hover:text-content`}
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

type Chip = { key: string; name: string; size: number; remove: () => void };

/**
 * Files going with the message: new ones and a forward's originals. Side
 * by side, wrapping; past two rows they scroll (the third peeks out, so
 * it's clear there are more) rather than taking the writing area's room.
 */
function AttachmentChips({ files }: { files: Chip[] }) {
  return (
    <ul
      className="flex max-h-20 shrink-0 flex-wrap gap-1.5 overflow-y-auto px-4 pb-2"
      aria-label="Attachments"
    >
      {files.map((f) => (
        <li
          key={f.key}
          className="flex h-7 max-w-60 items-center gap-1.5 rounded-md bg-selection pr-0.5 pl-2 text-xs"
        >
          <AttachmentIcon size={13} className="shrink-0 text-content/55" />
          <span className="truncate" title={f.name}>
            {f.name}
          </span>
          <span className="shrink-0 text-content/45">{formatSize(f.size)}</span>
          <button
            type="button"
            aria-label={`Remove ${f.name}`}
            onClick={f.remove}
            className="rounded p-1 text-content/45 hover:bg-selection-strong hover:text-content"
          >
            <ClearIcon size={12} />
          </button>
        </li>
      ))}
    </ul>
  );
}

function hasFiles(e: React.DragEvent): boolean {
  return [...e.dataTransfer.types].includes("Files");
}
