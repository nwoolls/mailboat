import { useQueries, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { commands } from "../../../platform/tauri/bindings";
import type { MessageMeta, OpenedMessage, ThreadId } from "../../../platform/tauri/bindings";
import { unwrap } from "../../../platform/tauri/ipc";
import { keys } from "../../../shared/lib/queries";
import { showToast } from "../../../shared/lib/toast";
import { messageCount, printedHeader, printedMessages } from "../model/print";
import { contentHeight } from "./MessageFrame";

/**
 * A conversation laid out for paper, then handed to the system's print
 * dialog. It sits out of sight on screen (laid out, so its emails load and
 * can be measured) and is the only thing on the page when printed
 * (`.print-root` in index.css). Each email is the same sandboxed frame the
 * reader uses, in its original colors on white (`message_print`).
 *
 * It stays mounted after the dialog opens: macOS draws the pages as the
 * dialog previews them, so taking the layout away would blank them. The
 * next print replaces it.
 */
export function PrintView({ threadId }: { threadId: ThreadId }) {
  const thread = useQuery({
    queryKey: keys.thread(threadId),
    queryFn: () => unwrap(commands.threadGet(threadId)),
  });
  const messages = printedMessages(thread.data?.messages ?? []);
  const bodies = useQueries({
    queries: messages.map((m) => ({
      queryKey: ["print", m.id] as const,
      queryFn: () => unwrap(commands.messagePrint(m.id)),
      staleTime: 0,
      gcTime: 0,
    })),
  });
  const [loaded, setLoaded] = useState<ReadonlySet<number>>(new Set());
  const printed = useRef(false);

  const failed = thread.isError || bodies.some((b) => b.isError);
  const ready =
    thread.isSuccess &&
    messages.length > 0 &&
    bodies.every((b) => b.isSuccess) &&
    messages.every((m) => loaded.has(m.id));

  useEffect(() => {
    if (!failed || printed.current) return;
    printed.current = true;
    showToast({ message: "Couldn't print: an email in this conversation didn't load." });
  }, [failed]);

  useEffect(() => {
    if (!ready || printed.current) return;
    printed.current = true;
    // After the measured heights are painted.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        void commands.windowPrint().then((r) => {
          if (r.status === "error") showToast({ message: `Couldn't print: ${r.error.message}` });
        });
      }),
    );
  }, [ready]);

  return createPortal(
    <div className="print-root" aria-hidden="true">
      <h1 className="print-subject">{thread.data?.thread.subject || "(no subject)"}</h1>
      <div className="print-count">{messageCount(messages.length)}</div>
      {messages.map((m, i) => (
        <PrintedEmail
          key={m.id}
          meta={m}
          opened={bodies[i]?.data}
          onLoaded={() => setLoaded((s) => new Set(s).add(m.id))}
        />
      ))}
    </div>,
    document.body,
  );
}

function PrintedEmail({
  meta,
  opened,
  onLoaded,
}: {
  meta: MessageMeta;
  opened: OpenedMessage | undefined;
  onLoaded: () => void;
}) {
  const [height, setHeight] = useState(0);
  const header = printedHeader(meta);
  return (
    <section className="print-email">
      <div className="print-from">{header.from}</div>
      <div className="print-meta">{[...header.recipients, header.date].join(" · ")}</div>
      {opened && (
        <iframe
          title="Message content"
          sandbox="allow-same-origin"
          srcDoc={opened.document}
          className="print-frame"
          style={{ height }}
          onLoad={(e) => {
            setHeight(contentHeight(e.currentTarget));
            onLoaded();
          }}
        />
      )}
      {opened && opened.attachments.length > 0 && (
        <div className="print-attachments">
          {opened.attachments.map((a) => a.filename).join(", ")}
        </div>
      )}
    </section>
  );
}
