import { useEffect, useState } from "react";
import { commands, events, type ThreadId } from "../../../platform/tauri/bindings";
import { IS_TAURI, unwrap } from "../../../platform/tauri/ipc";
import { showToast } from "../../../shared/lib/toast";
import { CheckIcon, ClearIcon } from "../../../shared/ui/icons";
import { type CodeNotice, current, NOTICE_LIFETIME_MS, withCode } from "../model/notices";

/**
 * Sign-in codes from new mail, in a glass notice at the top right (as
 * MonoCode's update notices), so a code can be copied without opening the
 * email. Each stays until dismissed, copied, or 10 minutes pass (codes
 * expire). Never modal: the app works around it.
 */
export function CodeNotices({ onOpen }: { onOpen: (thread: ThreadId) => void }) {
  const [list, setList] = useState<CodeNotice[]>([]);
  const [copied, setCopied] = useState<number | null>(null);

  useEffect(() => {
    if (!IS_TAURI) return;
    const unlisten = events.signInCodeEvent.listen((e) =>
      setList((l) => withCode(current(l, Date.now()), e.payload, Date.now())),
    );
    return () => void unlisten.then((fn) => fn());
  }, []);
  // Codes expire; their notices go with them.
  useEffect(() => {
    if (list.length === 0) return;
    const next = Math.min(...list.map((n) => n.arrivedAt + NOTICE_LIFETIME_MS));
    const timer = window.setTimeout(
      () => setList((l) => current(l, Date.now())),
      Math.max(0, next - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [list]);

  if (list.length === 0) return null;
  const dismiss = (messageId: number) => setList((l) => l.filter((n) => n.messageId !== messageId));
  const copy = (n: CodeNotice) =>
    void unwrap(commands.textCopy(n.code))
      .then(() => {
        setCopied(n.messageId);
        // Copied is what it was for: it goes after a moment.
        window.setTimeout(() => {
          dismiss(n.messageId);
          setCopied(null);
        }, 1200);
      })
      .catch((e: unknown) =>
        showToast({
          tone: "error",
          message: `Couldn’t copy: ${e instanceof Error ? e.message : String(e)}`,
        }),
      );

  return (
    <section
      aria-label="Sign-in codes"
      role="status"
      className="notice-card fixed top-12 right-3 z-50 w-[min(320px,calc(100vw-24px))] overflow-hidden rounded-xl"
    >
      <header className="flex h-8 items-center gap-2 border-b border-stroke pr-1.5 pl-3">
        <span className="min-w-0 flex-1 truncate text-[12px] font-semibold">
          {list.length === 1 ? "Sign-in code" : "Sign-in codes"}
        </span>
        <button
          type="button"
          aria-label="Dismiss all"
          title="Dismiss"
          onClick={() => setList([])}
          className="flex h-6 w-6 items-center justify-center rounded-md text-content/45 hover:bg-selection hover:text-content"
        >
          <ClearIcon size={12} strokeWidth={2} />
        </button>
      </header>
      <ul className="divide-y divide-stroke">
        {list.map((n) => (
          <li key={n.messageId} className="flex items-center gap-3 px-3 py-2.5">
            <button
              type="button"
              title="Open the email"
              onClick={() => onOpen(n.threadId)}
              className="min-w-0 flex-1 text-left"
            >
              <div className="truncate text-[12px] font-medium text-content/85">{n.sender}</div>
              <div className="truncate text-[11px] text-content/50">{n.subject}</div>
            </button>
            <span className="selectable shrink-0 font-mono text-[17px] font-semibold tracking-wider">
              {n.code}
            </span>
            <button
              type="button"
              onClick={() => copy(n)}
              title={`Copy ${n.code}`}
              className="flex h-7 shrink-0 items-center gap-1 rounded-md bg-accent px-2.5 text-[12px] font-medium text-white hover:brightness-110"
            >
              {copied === n.messageId ? (
                <>
                  <CheckIcon size={13} strokeWidth={2.25} />
                  Copied
                </>
              ) : (
                "Copy"
              )}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
