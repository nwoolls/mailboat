import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { commands } from "../../../platform/tauri/bindings";
import type { MessageId } from "../../../platform/tauri/bindings";
import { unwrap } from "../../../platform/tauri/ipc";
import { useOpenedMessage } from "../../../shared/lib/queries";
import { imageNotice } from "../model/imageNotice";
import { AttachmentList } from "./AttachmentList";

/**
 * Shows one message's sanitized HTML.
 *
 * Security: the document was sanitized in Rust and carries its own CSP. The
 * iframe is sandboxed WITHOUT `allow-scripts`, so nothing in the email can
 * run. `allow-same-origin` only lets this component (not the email) measure
 * the content height. Links were rewritten in Rust to `mailboat-link:` URLs,
 * which the app opens in the default browser (see `mail/links.rs`).
 */
export function MessageFrame({ messageId }: { messageId: MessageId }) {
  const qc = useQueryClient();
  const message = useOpenedMessage(messageId);
  const frameRef = useRef<HTMLIFrameElement>(null);
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

  const onLoad = useCallback(() => {
    const doc = frameRef.current?.contentDocument;
    if (!doc) return;
    const measure = () => setHeight(Math.max(60, doc.documentElement.scrollHeight));
    measure();
    setReady(true);
    for (const img of Array.from(doc.images)) img.addEventListener("load", measure);
    // Keys pressed with the message clicked into (r, e, j…) go to the app
    // as if pressed outside it: an iframe's keys never reach the window.
    doc.addEventListener("keydown", (e) => {
      const copy = new KeyboardEvent("keydown", {
        key: e.key,
        code: e.code,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        shiftKey: e.shiftKey,
        repeat: e.repeat,
        bubbles: true,
        cancelable: true,
      });
      frameRef.current?.dispatchEvent(copy);
      if (copy.defaultPrevented) e.preventDefault();
    });
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

  return (
    <div>
      {notice && (
        <div
          // A lighter layer inside the message card, always one line.
          className={`mb-3 flex items-center gap-3 rounded-lg px-3 py-1.5 text-xs ${
            notice.quiet
              ? "message-notice text-content/50"
              : "message-notice-strong text-content/70"
          }`}
        >
          <span className="min-w-0 truncate">{notice.text}</span>
          {notice.action && (
            <button
              type="button"
              title={notice.action.hint}
              className={`ml-auto shrink-0 disabled:opacity-50 ${
                notice.quiet ? "hover:text-content hover:underline" : "text-accent hover:underline"
              }`}
              disabled={senderImages.isPending}
              onClick={() =>
                senderImages.mutate({ email: m.senderEmail, allow: notice.action!.allow })
              }
            >
              {notice.action.label}
            </button>
          )}
        </div>
      )}
      <iframe
        ref={frameRef}
        title="Message content"
        sandbox="allow-same-origin"
        srcDoc={m.document}
        onLoad={onLoad}
        // Adaptive emails (plain text, inline colors) sit straight on the
        // glass with colors remapped for dark mode in Rust; emails with
        // their own style sheet keep a white card.
        className={`frame-reveal block w-full ${
          m.adaptive ? "bg-transparent" : "rounded-lg bg-white ring-1 ring-stroke"
        }`}
        style={{ height, opacity: ready ? 1 : 0 }}
      />
      <AttachmentList attachments={m.attachments} />
    </div>
  );
}
