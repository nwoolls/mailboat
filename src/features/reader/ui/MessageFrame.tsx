import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { commands } from "../../../platform/tauri/bindings";
import type { MessageId } from "../../../platform/tauri/bindings";
import { unwrap } from "../../../platform/tauri/ipc";
import { useOpenedMessage } from "../../../shared/lib/queries";
import { externalLink } from "../model/links";

/**
 * Shows one message's sanitized HTML.
 *
 * Security: the document was sanitized in Rust and carries its own CSP. The
 * iframe is sandboxed WITHOUT `allow-scripts`, so nothing in the email can
 * run. `allow-same-origin` only lets this component (not the email) measure
 * the content height and catch link clicks, which open in the browser.
 */
export function MessageFrame({ messageId }: { messageId: MessageId }) {
  const qc = useQueryClient();
  const message = useOpenedMessage(messageId);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(120);

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
    doc.addEventListener("click", (e) => {
      const anchor = (e.target as Element | null)?.closest?.("a");
      if (!anchor) return;
      e.preventDefault();
      const url = externalLink(anchor.getAttribute("href"));
      if (url) void commands.openExternal(url);
    });
    for (const img of Array.from(doc.images)) img.addEventListener("load", measure);
    const observer = new ResizeObserver(measure);
    observer.observe(doc.documentElement);
  }, []);

  if (message.isPending) return <div className="px-6 py-4 text-content/40">Loading…</div>;
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
        className="mx-6 block w-[calc(100%-3rem)] rounded-lg border border-stroke bg-white"
        style={{ height }}
      />
    </div>
  );
}
