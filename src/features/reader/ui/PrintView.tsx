import { useQueries, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { commands } from "../../../platform/tauri/bindings";
import type { MessageMeta, OpenedMessage, ThreadId } from "../../../platform/tauri/bindings";
import { unwrap } from "../../../platform/tauri/ipc";
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
 * next print replaces it (`run` counts prints).
 *
 * Each print reads the conversation afresh under keys of its own (`run`),
 * never from the reader's cache, and never again: the reader's cache can be
 * out of date when Print… is chosen, and mail arriving later refreshes the
 * reader's keys (`useMailEvents`), which would load new emails into a
 * printout nobody asked to update.
 */
export function PrintView({ threadId, run }: { threadId: ThreadId; run: number }) {
  const thread = useQuery({
    queryKey: ["print", run, "thread", threadId] as const,
    queryFn: () => unwrap(commands.threadGet(threadId)),
    staleTime: Infinity,
    gcTime: 0,
    // A failure is final: it says so and doesn't print. A retry that
    // worked after that would be a print nobody is waiting for.
    retry: false,
  });
  const messages = printedMessages(thread.data?.messages ?? []);
  const bodies = useQueries({
    queries: messages.map((m) => ({
      queryKey: ["print", run, "message", m.id] as const,
      queryFn: () => unwrap(commands.messagePrint(m.id)),
      staleTime: Infinity,
      gcTime: 0,
      retry: false,
    })),
  });
  const [loaded, setLoaded] = useState<ReadonlySet<number>>(new Set());
  const printed = useRef(false);

  const failure = thread.isError
    ? "Couldn't print: the conversation didn't load."
    : bodies.some((b) => b.isError)
      ? "Couldn't print: an email in this conversation didn't load."
      : thread.isSuccess && !messages.length
        ? "There's nothing to print in this conversation yet."
        : null;
  const ready =
    thread.isSuccess &&
    messages.length > 0 &&
    bodies.every((b) => b.isSuccess) &&
    messages.every((m) => loaded.has(m.id));
  useEffect(() => {
    if (!failure || printed.current) return;
    printed.current = true;
    showToast({ message: failure });
  }, [failure]);

  useEffect(() => {
    if (!ready || printed.current) return;
    // After the measured heights are painted. A print that replaces this
    // one before then cancels it, so the dialog never opens on a layout
    // that is still loading. Marked printed only once it runs: React runs
    // effects twice in development, cancelling the first.
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        if (printed.current) return;
        printed.current = true;
        void commands.windowPrint().then((r) => {
          if (r.status === "error") showToast({ message: `Couldn't print: ${r.error.message}` });
        });
      });
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
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
            // The white card's inner space, made for the reader, would set
            // the text in from its header on paper; Gmail lines them up.
            const body = e.currentTarget.contentDocument?.body;
            if (body) body.style.padding = "4px 0 0";
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
