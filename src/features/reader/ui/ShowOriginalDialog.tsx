import { useEffect, useRef, useState } from "react";
import type { MessageId, ThreadId } from "../../../platform/tauri/bindings";
import { commands } from "../../../platform/tauri/bindings";
import { unwrap } from "../../../platform/tauri/ipc";
import { useOriginal, useThread } from "../../../shared/lib/queries";
import { showToast } from "../../../shared/lib/toast";
import { formatFullDate } from "../../mailbox/model/format";
import { formatSize } from "../model/attachments";
import { failed, startingEmail, summaryRows } from "../model/original";

const BUTTON =
  "h-7 rounded-md px-3 bg-selection hover:bg-selection-strong disabled:opacity-50 text-[12px]";

/** Shows why copying or downloading failed. */
const failure = (what: string) => (e: unknown) =>
  showToast({
    tone: "error",
    message: `Couldn’t ${what}: ${e instanceof Error ? e.message : String(e)}`,
  });

/**
 * "Show original": an email exactly as it arrived, with Gmail's summary
 * of it above (who it's from, when, and whether SPF, DKIM and DMARC
 * passed), to copy or download as an `.eml` file. Starts on the
 * conversation's newest email; the others can be picked.
 */
export function ShowOriginalDialog({
  threadId,
  onClose,
}: {
  threadId: ThreadId;
  onClose: () => void;
}) {
  const thread = useThread(threadId).data;
  const messages = thread?.thread.id === threadId ? thread.messages : [];
  const [picked, setPicked] = useState<MessageId | null>(null);
  const messageId = picked ?? startingEmail(messages)?.id ?? null;
  const original = useOriginal(messageId);
  const [saving, setSaving] = useState(false);

  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    el?.showModal();
    return () => el?.close();
  }, []);

  const copy = () => {
    if (!original.data) return;
    unwrap(commands.textCopy(original.data.source))
      .then(() => showToast({ message: "Copied the original" }))
      .catch(failure("copy it"));
  };
  const download = () => {
    if (messageId === null) return;
    setSaving(true);
    unwrap(commands.messageOriginalSave(messageId))
      .then((name) =>
        showToast({
          message: `Saved “${name}” to Downloads`,
          action: {
            label: "Show in Finder",
            run: () => void unwrap(commands.downloadReveal(name)).catch(() => {}),
          },
        }),
      )
      .catch(failure("download it"))
      .finally(() => setSaving(false));
  };

  const o = original.data;
  return (
    <dialog
      ref={ref}
      aria-labelledby="original-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className="dialog m-auto flex h-[calc(100vh-4rem)] w-[min(56rem,calc(100vw-4rem))] flex-col rounded-xl p-5 text-[13px] text-content"
    >
      <header className="mb-3 flex items-center gap-3">
        <h2 id="original-title" className="flex-1 text-sm font-semibold">
          Original email
        </h2>
        {messages.length > 1 && (
          <select
            aria-label="Email"
            value={messageId ?? ""}
            onChange={(e) => setPicked(Number(e.target.value) as MessageId)}
            className="max-w-[20rem] truncate rounded-md bg-selection-subtle px-1.5 py-1 text-xs outline-none"
          >
            {messages.map((m) => (
              <option key={m.id} value={m.id}>
                {m.from.name || m.from.email} · {formatFullDate(m.internalDate)}
                {m.draft ? " (draft)" : ""}
              </option>
            ))}
          </select>
        )}
        <button type="button" className={BUTTON} onClick={copy} disabled={!o}>
          Copy
        </button>
        <button
          type="button"
          className={BUTTON}
          onClick={download}
          disabled={messageId === null || saving}
        >
          {saving ? "Downloading…" : "Download"}
        </button>
        <button type="button" className={BUTTON} onClick={onClose}>
          Done
        </button>
      </header>
      {original.error ? (
        <p className="selectable text-[12px] text-danger">
          Couldn’t load the original: {original.error.message}
        </p>
      ) : !o ? (
        <p className="text-[12px] text-content/50">Loading…</p>
      ) : (
        <>
          <dl className="selectable mb-3 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 rounded-lg bg-selection-subtle px-3 py-2.5 text-[12px]">
            {summaryRows(o).map(([name, value]) => {
              const check = o.checks.find((c) => c.method === name);
              return (
                <div key={name} className="contents">
                  <dt className="text-content/50">{name}</dt>
                  <dd
                    className={`min-w-0 break-words ${check && failed(check) ? "text-danger" : ""}`}
                  >
                    {value}
                  </dd>
                </div>
              );
            })}
          </dl>
          {o.truncated && (
            <p className="mb-2 text-[12px] text-content/55">
              Showing the first {formatSize(o.source.length)} of {formatSize(o.size)}. Download it
              for the whole email.
            </p>
          )}
          <pre className="selectable min-h-0 flex-1 overflow-auto rounded-lg px-3 py-2.5 font-mono text-[11px] leading-relaxed break-all whitespace-pre-wrap ring-1 ring-stroke ring-inset">
            {o.source}
          </pre>
        </>
      )}
    </dialog>
  );
}
