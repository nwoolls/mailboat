import { useCallback, useEffect, useRef, useState } from "react";
import { REPLY_FOLLOW_EVENT, REPLY_HOLDS_ATTR } from "../../../shared/lib/replyFollow";
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
  WarningIcon,
} from "../../../shared/ui/icons";
import type { OutgoingAttachment } from "../../../platform/tauri/bindings";
import { formatSize } from "../../reader/model/attachments";
import { attachmentSize } from "../model/draft";
import { outsideBanner, outsideRecipients } from "../model/outside";
import { useOutsideRule } from "../../../shared/lib/queries";
import type { ComposeEntry } from "../model/composeState";
import {
  type ComposeKind,
  type Draft,
  type SendAgainNote as SendAgainNoteFields,
  sendAgainLines,
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
import { stuckAfterScroll } from "../model/stickToEnd";
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
/**
 * How much of the reader's bottom edge the pinned formatting and Send bar
 * covers before it has been measured, in pixels: one row of formatting.
 */
const PINNED_FOOT_HEIGHT = 80;
/** Room kept between the line being typed and that bar, in pixels. */
const ABOVE_FOOT_GAP = 16;

/** How long the smooth scroll to a new reply has before it goes the rest at once. */
const REPLY_ARRIVE_MS = 700;
/** As far as opening a reply scrolls at once rather than smoothly. */
const REPLY_AT_ONCE_PX = 40;
/**
 * How long after a wheel, a touch or a scrolling key a scroll still counts
 * as the person's (a trackpad's momentum keeps sending wheel events).
 */
const HAND_MS = 600;
/** Keys that scroll the reader, or move the cursor in the reply and scroll it. */
const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"]);

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
  const { style, outsideWarningOff } = composingPrefs.use();
  // Recipients outside the From account's organization, marked as Gmail
  // marks them (Workspace accounts only; Settings → Accounts turns it off).
  const outsideRule = useOutsideRule(draft.accountId).data;
  const rule = outsideWarningOff.includes(draft.accountId) ? null : outsideRule;
  const outside = outsideRecipients(rule, [...draft.to, ...draft.cc, ...draft.bcc]);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [dropping, setDropping] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const [footMarker, footStuck] = useStuck();
  // The pinned bar's height as it is: in a narrow reader the formatting
  // wraps onto more rows, and a fixed guess left the line being typed
  // under the bar (owner report, 2026-11-12).
  const [footHeight, setFootHeight] = useState(PINNED_FOOT_HEIGHT);
  const measureFoot = useCallback(
    (el: HTMLDivElement | null) => {
      if (!el || !inline) return;
      const measured = new ResizeObserver(() =>
        setFootHeight(Math.ceil(el.getBoundingClientRect().height)),
      );
      measured.observe(el);
      return () => measured.disconnect();
    },
    [inline],
  );
  // Loaded once with the draft's opening HTML (the quote, for replies);
  // a different draft gets a fresh form (keyed by draft ID).
  const editor = useRichEditor(
    draft.html,
    ({ html, text, edited }) => onChange((d) => ({ ...d, html, text, edited: d.edited || edited })),
    // Inline, the pinned Send bar covers the reader's bottom edge: keep
    // the line being typed above it.
    inline ? { keepClearBelow: footHeight + ABOVE_FOOT_GAP } : undefined,
  );

  // Replies start in the text, above the quote (new messages and
  // forwards start in To). Asked again (focusKey) when `r` is pressed on
  // a conversation already being answered.
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
    const scroller = whole.closest<HTMLElement>(".reader-scroll");
    if (!scroller) {
      whole.scrollIntoView({ block: "nearest", behavior: "smooth" });
      return;
    }
    // The reply is the last thing in the reader, so it sticks to the
    // bottom by keeping the reader at its end (owner, 2026-11-23): while
    // the person types, the signature loads, the assistant opens and its
    // ideas arrive. Scrolling up to read lets go (the Send bar then pins
    // to the bottom edge and the reply passes under it); scrolling back
    // down to the end sticks again. This replaced a follow that kept the
    // reply in view for up to 10 s after it opened, and needed checks of
    // its own for scrolls WebKit cut short (docs/ROADMAP.md).
    // The reader may still be landing on an email it just opened (a draft
    // reply resumes by itself): the reply takes over from it.
    scroller.dispatchEvent(new Event(REPLY_FOLLOW_EVENT));
    // Also marked, for a reader whose landing starts after this (its
    // effect runs after this one when both mount together).
    whole.setAttribute(REPLY_HOLDS_ATTR, "");
    const end = () => scroller.scrollHeight - scroller.clientHeight;
    let stuck = true;
    let lastTop = scroller.scrollTop;
    // Instant: WebKit leaves short smooth scrolls undone, and growth comes
    // a few pixels at a time. Recorded at once, so a scroll up straight
    // after isn't measured from where the reader was before it.
    const toEnd = () => {
      // Any shortfall at all: "at the end" allows rounding, the reply doesn't.
      if (stuck && scroller.scrollTop < end() - 0.5) {
        scroller.scrollTo({ top: end(), behavior: "instant" });
        lastTop = scroller.scrollTop;
      }
    };
    // Opening slides down to it, and while it opens, growth (the assistant
    // revealing itself) aims the slide again rather than jumping. A short
    // way goes at once: WebKit leaves short smooth scrolls undone (and the
    // cursor going into the text has usually scrolled most of the way
    // already). A smooth scroll can also be cut short or stall on a slow
    // machine, so once it has had time to arrive, still stuck and short of
    // the end goes the rest at once, and growth from then on is instant.
    let opening = true;
    const slide = () => {
      if (!stuck || scroller.scrollTop >= end() - 0.5) return;
      if (end() - scroller.scrollTop <= REPLY_AT_ONCE_PX) toEnd();
      else scroller.scrollTo({ top: end(), behavior: "smooth" });
    };
    slide();
    const arrived = window.setTimeout(() => {
      opening = false;
      toEnd();
    }, REPLY_ARRIVE_MS);
    const letGo = () => {
      if (!stuck) return;
      stuck = false;
      // Opening is over: if it sticks again later, growth is instant, as
      // after the timer.
      opening = false;
      window.clearTimeout(arrived);
      // Stops the opening slide where it is, or it would reach the end and
      // stick again.
      scroller.scrollTo({ top: scroller.scrollTop, behavior: "instant" });
      lastTop = scroller.scrollTop;
    };
    // A ResizeObserver reports each box once when it starts watching; that
    // isn't growth, and acting on it cut the opening slide short. Only a
    // change from the size first seen counts.
    const seen = new Map<Element, number>();
    const growing = new ResizeObserver((entries) => {
      let grew = false;
      for (const box of entries) {
        const height = box.contentRect.height;
        if (seen.has(box.target) && seen.get(box.target) !== height) grew = true;
        seen.set(box.target, height);
      }
      if (grew && opening) slide();
      else if (grew) toEnd();
    });
    growing.observe(whole);
    // Whatever grows above it (an email measured taller) moves it too, and
    // so does the reader itself changing height (the window resized).
    const content = scroller.firstElementChild;
    if (content) growing.observe(content);
    growing.observe(scroller);
    // Signs of the person's hand on a scroll (stuckAfterScroll): a wheel, a
    // touch or a scrolling key just now, the scroll bar held, or the
    // pointer over an email (a sandboxed frame of its own, whose wheel
    // never reaches this window and shows only as the reader scrolling).
    let handAt = Number.NEGATIVE_INFINITY;
    let barHeld = false;
    let overEmail = false;
    const byHand = () => barHeld || overEmail || performance.now() - handAt < HAND_MS;
    const onHand = () => {
      handAt = performance.now();
    };
    const onHandKey = (e: KeyboardEvent) => {
      const editing =
        e.target instanceof HTMLElement &&
        (e.target.isContentEditable || ["INPUT", "TEXTAREA"].includes(e.target.tagName));
      if (SCROLL_KEYS.has(e.key) || (e.key === " " && !editing)) onHand();
    };
    const onOver = (e: PointerEvent) => {
      overEmail = e.target instanceof HTMLIFrameElement;
    };
    const onLeave = () => {
      overEmail = false;
    };
    const onRelease = () => {
      barHeld = false;
    };
    window.addEventListener("wheel", onHand, { capture: true, passive: true });
    window.addEventListener("touchmove", onHand, { capture: true, passive: true });
    window.addEventListener("keydown", onHandKey, { capture: true });
    window.addEventListener("pointerup", onRelease, { capture: true });
    scroller.addEventListener("pointerover", onOver);
    scroller.addEventListener("pointerleave", onLeave);
    const onScroll = () => {
      const top = scroller.scrollTop;
      stuck = stuckAfterScroll(stuck, { top, lastTop, end: end(), byHand: byHand() });
      lastTop = top;
      // The layout pulled it short of the end (content shrank for a moment):
      // back to the end at once. (While opening, the slide sees to it.)
      if (!opening && stuck) toEnd();
      // Opening, within a short way of the end (the cursor going into the
      // text scrolled there at once, which also stopped the slide): the
      // rest at once, rather than waiting for REPLY_ARRIVE_MS.
      if (opening && stuck && end() - top <= REPLY_AT_ONCE_PX) toEnd();
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    // A click or a key in the conversation above (opening an email, say,
    // from its header or with the keyboard) lets go, or the email would
    // grow up out of sight instead of down. Typing in the reply doesn't.
    const notInReply = (target: EventTarget | null) =>
      target instanceof Node && !whole.contains(target);
    // Not a press on the reader itself (its scroll bar): a drag up lets go
    // anyway, through the scroll.
    const onPointer = (e: PointerEvent) => {
      if (e.target === scroller) barHeld = true;
      else if (notInReply(e.target)) letGo();
    };
    const onKey = (e: KeyboardEvent) => {
      if (notInReply(e.target)) letGo();
    };
    scroller.addEventListener("pointerdown", onPointer, { capture: true });
    scroller.addEventListener("keydown", onKey, { capture: true });
    return () => {
      whole.removeAttribute(REPLY_HOLDS_ATTR);
      growing.disconnect();
      window.clearTimeout(arrived);
      scroller.removeEventListener("scroll", onScroll);
      scroller.removeEventListener("pointerdown", onPointer, { capture: true });
      scroller.removeEventListener("keydown", onKey, { capture: true });
      window.removeEventListener("wheel", onHand, { capture: true });
      window.removeEventListener("touchmove", onHand, { capture: true });
      window.removeEventListener("keydown", onHandKey, { capture: true });
      window.removeEventListener("pointerup", onRelease, { capture: true });
      scroller.removeEventListener("pointerover", onOver);
      scroller.removeEventListener("pointerleave", onLeave);
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
      {/* min-w-0: a fieldset is at least as wide as its widest line
          (browsers' own style), and a long unbroken line (a row of "=",
          a long link) made the reply wider than the reader, which then
          scrolled sideways (owner, 2026-11-19). */}
      <fieldset disabled={sending} className="flex min-h-0 min-w-0 flex-1 flex-col px-4">
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
          isOutside={(email) => outside.some((a) => a.email.toLowerCase() === email.toLowerCase())}
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
        <OutsideBanner banner={rule && outside.length > 0 ? outsideBanner(rule, outside) : null} />
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
      {draft.sendAgainNote && (
        <SendAgainNote
          note={draft.sendAgainNote}
          files={draft.forwarded.length}
          // The button pressed goes away: the message takes focus (review).
          onRemoveFiles={() => {
            onChange((d) => ({ ...d, forwarded: [] }));
            editor?.commands.focus();
          }}
          onDismiss={() => {
            onChange((d) => ({ ...d, sendAgainNote: undefined }));
            editor?.commands.focus();
          }}
        />
      )}
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
        ref={measureFoot}
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

/**
 * Send again: what came along from the original, said once above the
 * files (not a dialog). Its files can all go at once; each also has its
 * own ×.
 */
function SendAgainNote({
  note,
  files,
  onRemoveFiles,
  onDismiss,
}: {
  note: SendAgainNoteFields;
  /** The original's files still attached. */
  files: number;
  onRemoveFiles: () => void;
  onDismiss: () => void;
}) {
  const lines = sendAgainLines(note, files);
  if (lines.length === 0) return null;
  return (
    <div
      role="note"
      aria-label="Sending again"
      className="mx-4 mb-2 flex items-center gap-2 rounded-lg bg-selection px-3 py-1.5 text-xs text-content/80"
    >
      <span className="min-w-0 flex-1">{lines.join(" ")}</span>
      {files > 0 && (
        <button
          type="button"
          className="shrink-0 rounded px-1.5 py-0.5 font-medium hover:bg-selection-strong"
          onClick={onRemoveFiles}
        >
          {files === 1 ? "Remove it" : "Remove them"}
        </button>
      )}
      <button
        type="button"
        aria-label="Dismiss"
        className="shrink-0 rounded px-1 text-content/50 hover:bg-selection-strong hover:text-content"
        onClick={onDismiss}
      >
        <ClearIcon size={13} />
      </button>
    </div>
  );
}

/** Above the message while it has recipients outside the organization. */
function OutsideBanner({ banner }: { banner: { title: string; detail: string } | null }) {
  // The status region is always there, empty without a warning, so a
  // screen reader announces the first one too (a region added together
  // with its text isn't reliably read).
  return (
    <div role="status">
      {banner && (
        <div className="mt-3 flex items-start gap-2.5 rounded-lg border border-warn/35 bg-warn/10 px-3 py-2.5">
          <WarningIcon aria-hidden size={16} className="mt-px shrink-0 text-warn-ink" />
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="font-semibold">{banner.title}</span>
            <span className="text-content/70">{banner.detail}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function AddressFieldRow({
  draft,
  onChange,
  kindMenu,
  isOutside,
}: {
  draft: Draft;
  onChange: (change: (d: Draft) => Draft) => void;
  kindMenu?: React.ReactNode;
  /** Marks an address outside the organization. */
  isOutside: (email: string) => boolean;
}) {
  // The line a dragged address chip is over, highlighted until it drops.
  const [dragOver, setDragOver] = useState<AddressLine | null>(null);
  const lineProps = (line: AddressLine) => ({
    line,
    isOutside,
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
