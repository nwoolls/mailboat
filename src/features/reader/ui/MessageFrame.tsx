import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { commands } from "../../../platform/tauri/bindings";
import type { MessageId } from "../../../platform/tauri/bindings";
import { unwrap } from "../../../platform/tauri/ipc";
import { useOpenedMessage } from "../../../shared/lib/queries";

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

  const allowImages = useMutation({
    mutationFn: (email: string) => unwrap(commands.senderAllowImages(email, true)),
    // Other open messages from the same sender should load images too.
    onSuccess: () => qc.invalidateQueries({ queryKey: ["message"] }),
  });

  const onLoad = useCallback(() => {
    const doc = frameRef.current?.contentDocument;
    if (!doc) return;
    const measure = () => setHeight(Math.max(60, doc.documentElement.scrollHeight));
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
        className="mx-6 h-40 animate-pulse rounded-lg bg-selection-subtle motion-reduce:animate-none"
      />
    );
  if (message.error)
    return (
      <div className="selectable px-6 py-4 text-danger">
        Couldn't load this message: {message.error.message}
      </div>
    );
  const m = message.data;

  return (
    <div>
      {m.blockedImages > 0 && !m.imagesAllowed && (
        <div className="mx-6 mb-2 flex items-center gap-3 rounded-md bg-selection-subtle px-3 py-2 text-xs text-content/60">
          <span>
            {m.blockedImages} remote image{m.blockedImages === 1 ? "" : "s"} hidden
            {m.trackersRemoved > 0 &&
              `, ${m.trackersRemoved} tracker${m.trackersRemoved === 1 ? "" : "s"} removed`}
          </span>
          <button
            type="button"
            className="ml-auto text-accent hover:underline disabled:opacity-50"
            disabled={allowImages.isPending}
            onClick={() => allowImages.mutate(m.senderEmail)}
          >
            Always load images from {m.senderEmail}
          </button>
        </div>
      )}
      <iframe
        ref={frameRef}
        title="Message content"
        sandbox="allow-same-origin"
        srcDoc={m.document}
        onLoad={onLoad}
        className="frame-reveal mx-6 block w-[calc(100%-3rem)] rounded-lg border border-stroke bg-white"
        style={{ height, opacity: ready ? 1 : 0 }}
      />
    </div>
  );
}
