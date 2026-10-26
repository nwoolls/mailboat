import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { commands } from "../../../platform/tauri/bindings";
import type { MessageId } from "../../../platform/tauri/bindings";
import { unwrap } from "../../../platform/tauri/ipc";
import { useOpenedMessage } from "../../../shared/lib/queries";
import { imageNotice } from "../model/imageNotice";
import { InviteCard } from "./InviteCard";
import { AttachmentList } from "./AttachmentList";
import { useTextZoom } from "../../settings/ui/textSize";
import { TranslationCard } from "../../ai/ui/TranslationCard";

/**
 * Shows one message's sanitized HTML.
 *
 * Security: the document was sanitized in Rust and carries its own CSP. The
 * iframe is sandboxed WITHOUT `allow-scripts`, so nothing in the email can
 * run. `allow-same-origin` only lets this component (not the email) measure
 * the content height. Links were rewritten in Rust to `email-link:` URLs,
 * which the app opens in the default browser (see `mail/links.rs`).
 */
/** The message frame last clicked into, whose selection ⌘C copies. */
let clickedFrame: HTMLIFrameElement | null = null;

/**
 * The text selected in the message last clicked into, and which message
 * that is, so a reply can quote just that. None if the app's own page has
 * a selection instead, or the message is no longer on screen.
 */
export function selectedInMessage(): { messageId: MessageId; text: string } | null {
  const frame = clickedFrame;
  if (!frame?.isConnected || !(window.getSelection()?.isCollapsed ?? true)) return null;
  const text = frame.contentWindow?.getSelection()?.toString() ?? "";
  const messageId = Number(frame.dataset.messageId);
  return text.trim() && messageId ? { messageId, text } : null;
}

/**
 * How tall an email's content is. A document's `scrollHeight` is never
 * less than its frame, so measured at the frame's current height an email
 * could grow but never shrink back: once measured tall (the reader briefly
 * narrower, say), it kept that height, with blank space under it. So it's
 * measured with the frame collapsed for that moment. Both changes happen
 * before anything is drawn, so nothing flickers.
 */
function contentHeight(frame: HTMLIFrameElement): number {
  const doc = frame.contentDocument;
  if (!doc?.documentElement) return 0;
  const kept = frame.style.height;
  frame.style.height = "0px";
  const height = doc.documentElement.scrollHeight;
  frame.style.height = kept;
  return Math.max(60, height);
}

export function MessageFrame({ messageId }: { messageId: MessageId }) {
  const qc = useQueryClient();
  const message = useOpenedMessage(messageId);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const holderRef = useRef<HTMLDivElement>(null);

  // Keys pressed in an iframe never reach the app, and WebKit won't run
  // listeners inside a frame without scripts (even the app's own), so
  // keys can't be passed on from there. Instead, clicking into a message
  // hands focus straight back to the app (r, e, j… keep working); the
  // selection made in the message stays, and ⌘C copies it from here.
  useEffect(() => {
    const onBlur = () =>
      // After the focus has moved.
      window.setTimeout(() => {
        const frame = frameRef.current;
        if (!frame || document.activeElement !== frame) return;
        clickedFrame = frame;
        holderRef.current?.focus({ preventScroll: true });
      });
    const frameSelection = () => {
      const frame = frameRef.current;
      if (!frame || frame !== clickedFrame || !(window.getSelection()?.isCollapsed ?? true))
        return null;
      const selection = frame.contentWindow?.getSelection();
      return selection && !selection.isCollapsed ? selection : null;
    };
    // WebKit only offers Copy when something here is selected, unless
    // "beforecopy" is cancelled.
    const onBeforeCopy = (e: Event) => {
      if (frameSelection()) e.preventDefault();
    };
    const onCopy = (e: ClipboardEvent) => {
      const selection = frameSelection();
      if (!selection || !e.clipboardData) return;
      const html = document.createElement("div");
      for (let i = 0; i < selection.rangeCount; i++)
        html.append(selection.getRangeAt(i).cloneContents());
      e.clipboardData.setData("text/plain", selection.toString());
      e.clipboardData.setData("text/html", html.innerHTML);
      e.preventDefault();
    };
    window.addEventListener("blur", onBlur);
    document.addEventListener("beforecopy", onBeforeCopy);
    document.addEventListener("copy", onCopy);
    return () => {
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("beforecopy", onBeforeCopy);
      document.removeEventListener("copy", onCopy);
      if (clickedFrame && !clickedFrame.isConnected) clickedFrame = null;
    };
  }, []);
  const [height, setHeight] = useState(120);
  // The frame stays invisible until its content has been measured, then
  // fades in, so the white card never pops in short and jumps taller.
  const [ready, setReady] = useState(false);

  const senderImages = useMutation({
    mutationFn: ({ email, allow }: { email: string; allow: boolean }) =>
      unwrap(commands.senderAllowImages(email, allow)),
    // Other open messages from the same sender should follow the choice too.
    onSuccess: () => qc.invalidateQueries({ queryKey: ["message"] }),
  });
  // "Original colors" is remembered per sender, so their other emails (open
  // now, and later) follow it too.
  const senderColors = useMutation({
    mutationFn: ({ email, original }: { email: string; original: boolean }) =>
      unwrap(commands.senderOriginalColors(email, original)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["message"] }),
  });

  // Settings → Appearance → Text size, applied inside the email (WebKit
  // then reports its zoomed height, which sizes the frame). Read through a
  // ref so a change re-zooms without reloading the email.
  const zoom = useTextZoom();
  const zoomRef = useRef(zoom);
  useEffect(() => {
    zoomRef.current = zoom;
    const frame = frameRef.current;
    const doc = frame?.contentDocument;
    if (!frame || !doc?.documentElement) return;
    doc.documentElement.style.setProperty("zoom", String(zoom));
    setHeight(contentHeight(frame));
  }, [zoom]);

  const onLoad = useCallback(() => {
    const frame = frameRef.current;
    const doc = frame?.contentDocument;
    if (!frame || !doc) return;
    doc.documentElement.style.setProperty("zoom", String(zoomRef.current));
    const measure = () => setHeight(contentHeight(frame));
    measure();
    setReady(true);
    for (const img of Array.from(doc.images)) img.addEventListener("load", measure);
    const observer = new ResizeObserver(measure);
    observer.observe(doc.documentElement);
  }, []);

  // A soft placeholder holds the card's place while the message loads.
  if (message.isPending)
    return (
      <div
        role="status"
        aria-label="Loading message"
        className="h-32 animate-pulse rounded-lg bg-selection-subtle motion-reduce:animate-none"
      />
    );
  if (message.error)
    return (
      <div className="selectable px-6 py-4 text-danger">
        Couldn't load this message: {message.error.message}
      </div>
    );
  const m = message.data;
  const notice = imageNotice(m);
  const original = m.originalColors;
  // For emails the dark-mode remap gets wrong: their own colors on a white
  // card, or back. In the line above the email, never over it (floating on
  // the email, it hid the end of the first line: owner, 2026-10-24).
  const colors = m.recolorable && (
    <button
      type="button"
      disabled={senderColors.isPending}
      onClick={() => senderColors.mutate({ email: m.senderEmail, original: !original })}
      title={
        original
          ? `Show emails from ${m.senderEmail} on the glass, with colors adjusted for dark mode`
          : `Always show emails from ${m.senderEmail} on a white card, with their own colors`
      }
      className="shrink-0 hover:text-content hover:underline disabled:opacity-50"
    >
      {original ? "Adapted colors" : "Original colors"}
    </button>
  );

  return (
    // Takes the focus back from the frame (see above); never shows a ring.
    <div ref={holderRef} tabIndex={-1} className="outline-none">
      <InviteCard messageId={m.messageId} accountId={m.accountId} />
      {notice ? (
        <div
          // A lighter layer inside the message card, always one line.
          className={`mb-3 flex items-center gap-3 rounded-lg px-3 py-1.5 text-xs ${
            notice.quiet
              ? "message-notice text-content/50"
              : "message-notice-strong text-content/70"
          }`}
        >
          <span className="min-w-0 truncate">{notice.text}</span>
          <span className="ml-auto flex shrink-0 items-center gap-3">
            {notice.action && (
              <button
                type="button"
                title={notice.action.hint}
                className={`shrink-0 disabled:opacity-50 ${
                  notice.quiet
                    ? "hover:text-content hover:underline"
                    : "text-accent hover:underline"
                }`}
                disabled={senderImages.isPending}
                onClick={() =>
                  senderImages.mutate({ email: m.senderEmail, allow: notice.action!.allow })
                }
              >
                {notice.action.label}
              </button>
            )}
            {colors && (
              <span className="text-content/50">
                {notice.action && <span className="mr-3 text-content/25">·</span>}
                {colors}
              </span>
            )}
          </span>
        </div>
      ) : (
        colors && (
          // No notice: just the switch, quietly, at the right.
          <div className="mb-1.5 flex justify-end px-3 text-xs text-content/45">{colors}</div>
        )
      )}
      {/* Above the email, not under it, where a long email hid it (owner,
          2026-10-26). */}
      <TranslationCard messageId={messageId} />
      <div>
        <iframe
          ref={frameRef}
          title="Message content"
          data-message-id={m.messageId}
          sandbox="allow-same-origin"
          srcDoc={m.document}
          onLoad={onLoad}
          // Adaptive emails (plain text, inline colors) sit straight on the
          // glass with colors remapped for dark mode in Rust; emails with
          // their own style sheet keep a white card.
          className={`frame-reveal block w-full ${m.adaptive ? "bg-transparent" : "email-card"}`}
          style={{ height, opacity: ready ? 1 : 0 }}
        />
      </div>
      <AttachmentList attachments={m.attachments} />
    </div>
  );
}
