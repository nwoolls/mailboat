import { useEffect, useRef, useState } from "react";
import { commands } from "../../../platform/tauri/bindings";
import { IpcError, unwrap } from "../../../platform/tauri/ipc";
import { useAiStatus, useAppSettings, useSaveAppSettings } from "../../../shared/lib/queries";
import { AiIcon, AskIcon, ClearIcon, StopIcon } from "../../../shared/ui/icons";
import type { Draft } from "../../compose/model/draft";
import { type ChatMessage, chatMessage, suggestions, writeRequest } from "../model/chat";
import { aiChoices, offered, PROVIDER_NAMES, statusLine, statusOf } from "../model/providers";
import { dropText, newRequestId, useStreamedText } from "./stream";

/**
 * Each message's chat, by draft, so closing the panel (or popping a reply
 * out into the card) keeps it until the message is sent or discarded.
 */
const chats = new Map<number, ChatMessage[]>();

export function forgetChat(draftId: number) {
  chats.delete(draftId);
}

/**
 * The writing assistant: a chat about the message being written. Each
 * answer is a whole draft; "Use this" puts it in the editor (replacing
 * what's there, above the signature and quote). Nothing is sent to the
 * model until a request is.
 */
export function AssistantPanel({
  draft,
  placement,
  onUse,
  onClose,
}: {
  draft: Draft;
  /** Beside the floating card's form, or above an inline reply. */
  placement: "side" | "top";
  onUse: (text: string, subject: string | null) => void;
  onClose: () => void;
}) {
  const settings = useAppSettings().data;
  const save = useSaveAppSettings();
  const ai = aiChoices(settings);
  const provider = ai.writingProvider;
  const status = statusOf(useAiStatus().data, provider);
  const [messages, setMessagesState] = useState<ChatMessage[]>(() => chats.get(draft.id) ?? []);
  const setMessages = (change: (m: ChatMessage[]) => ChatMessage[]) =>
    setMessagesState((prev) => {
      const next = change(prev);
      chats.set(draft.id, next);
      return next;
    });
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<number | null>(null);
  const pendingRef = useRef<number | null>(null);
  const streamed = useStreamedText(pending);
  const scroller = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);

  // Closing the panel (or the message) stops a request being written.
  useEffect(
    () => () => {
      if (pendingRef.current !== null) void commands.aiCancel(pendingRef.current);
    },
    [],
  );
  // Keep the newest at the bottom in view as it's written (after every
  // render: a new bubble, or more of the answer).
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  });

  const send = (text: string) => {
    const request = text.trim();
    if (!request || pending !== null) return;
    const next = [...messages, chatMessage({ role: "user", text: request })];
    setMessages(() => next);
    setInput("");
    const id = newRequestId();
    pendingRef.current = id;
    setPending(id);
    unwrap(commands.aiWrite(writeRequest(draft, next), id))
      .then((answer) =>
        setMessages((m) => [
          ...m,
          chatMessage({ role: "assistant", text: answer.text, subject: answer.subject }),
        ]),
      )
      .catch((e: unknown) => {
        if (e instanceof IpcError && e.kind === "cancelled") return;
        setMessages((m) => [
          ...m,
          chatMessage({
            role: "assistant",
            text: e instanceof Error ? e.message : String(e),
            error: true,
          }),
        ]);
      })
      .finally(() => {
        pendingRef.current = null;
        setPending(null);
        dropText(id);
        field.current?.focus();
      });
  };

  const ready = status?.state === "ready";
  const choices = offered(ai);

  return (
    <aside
      aria-label="Write with AI"
      className={`flex min-h-0 flex-col text-[13px] ${
        placement === "side"
          ? "w-[340px] shrink-0 border-r border-stroke"
          : "max-h-[340px] border-b border-stroke"
      }`}
      onKeyDown={(e) => {
        // Esc closes the panel, not the whole message.
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="flex h-9 shrink-0 items-center gap-1.5 pr-1.5 pl-3 text-xs text-content/55">
        <AiIcon size={14} className="text-accent" />
        <span className="font-medium text-content/75">Write with</span>
        <select
          aria-label="Write with"
          title="Also in Settings → AI"
          value={provider}
          disabled={!settings || pending !== null}
          onChange={(e) =>
            settings &&
            save.mutate({
              ...settings,
              ai: { ...ai, writingProvider: e.target.value as typeof provider },
            })
          }
          className="min-w-0 rounded bg-transparent py-0.5 text-content/75 hover:bg-selection"
        >
          {choices.map((p) => (
            <option key={p} value={p}>
              {PROVIDER_NAMES[p]}
            </option>
          ))}
        </select>
        <button
          type="button"
          aria-label="Close"
          title="Close (Esc)"
          onClick={onClose}
          className="ml-auto flex h-7 w-7 items-center justify-center rounded-md text-content/60 hover:bg-selection hover:text-content"
        >
          <ClearIcon size={14} />
        </button>
      </header>
      <div ref={scroller} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-2">
        {!ready && status && (
          <p className="rounded-md bg-selection px-2.5 py-2 text-xs text-content/70">
            {PROVIDER_NAMES[provider]}: {statusLine(status, true)} Choose another above, or set it
            up in Settings → AI.
          </p>
        )}
        {messages.length === 0 && ready && (
          <div className="pt-1">
            <p className="text-xs text-content/50">
              {draft.kind === "new"
                ? "Say what the email should say. You can refine it after."
                : "Say how to reply. It reads the conversation; refine the draft after."}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {suggestions(draft.kind).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="rounded-full px-2.5 py-1 text-xs text-content/70 ring-1 ring-stroke ring-inset hover:bg-selection hover:text-content"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) =>
          m.role === "user" ? (
            <p
              key={m.id}
              className="selectable ml-8 rounded-lg bg-accent/15 px-2.5 py-1.5 whitespace-pre-wrap"
            >
              {m.text}
            </p>
          ) : m.error ? (
            <p key={m.id} role="alert" className="selectable px-1 text-xs text-danger">
              {m.text}
            </p>
          ) : (
            <DraftBubble key={m.id} message={m} onUse={() => onUse(m.text, m.subject ?? null)} />
          ),
        )}
        {pending !== null && (
          <div className="rounded-lg bg-selection px-2.5 py-2">
            {streamed ? (
              <p className="whitespace-pre-wrap text-content/80">{streamed}</p>
            ) : (
              <p className="animate-pulse text-xs text-content/55">Writing…</p>
            )}
          </div>
        )}
      </div>
      <form
        className="flex shrink-0 items-end gap-1.5 px-3 pt-1 pb-3"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <textarea
          ref={field}
          // Opened on purpose (⌘J or ✦): ready to type.
          autoFocus
          rows={2}
          value={input}
          disabled={!ready}
          placeholder={
            messages.some((m) => m.role === "assistant") ? "Change it…" : "Ask for a draft…"
          }
          aria-label="Ask the AI"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            // Return asks; ⇧Return is a new line. ⌘Return stays the message's Send.
            if (e.key === "Enter" && !e.shiftKey && !e.metaKey) {
              e.preventDefault();
              e.stopPropagation();
              send(input);
            }
          }}
          className="max-h-28 min-h-9 flex-1 resize-none rounded-lg bg-selection px-2.5 py-1.5 outline-none placeholder:text-content/40 focus:ring-1 focus:ring-accent/50"
        />
        {pending !== null ? (
          <button
            type="button"
            aria-label="Stop"
            title="Stop"
            onClick={() => void commands.aiCancel(pending)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-selection-strong text-content/80 hover:text-content"
          >
            <StopIcon size={14} />
          </button>
        ) : (
          <button
            type="submit"
            aria-label="Ask"
            title="Ask (Return)"
            disabled={!ready || !input.trim()}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-white hover:brightness-110 disabled:opacity-40"
          >
            <AskIcon size={15} />
          </button>
        )}
      </form>
    </aside>
  );
}

/** One draft from the model, with Use this. */
function DraftBubble({ message, onUse }: { message: ChatMessage; onUse: () => void }) {
  return (
    <div className="rounded-lg bg-selection px-2.5 pt-2 pb-1.5">
      {message.subject && (
        <p className="mb-1 text-xs text-content/55">
          Subject: <span className="text-content/80">{message.subject}</span>
        </p>
      )}
      <p className="selectable whitespace-pre-wrap text-content/85">{message.text}</p>
      <div className="mt-1.5 flex justify-end">
        <button
          type="button"
          onClick={onUse}
          title="Put this in the message (replaces what’s written)"
          className="h-6 rounded-md bg-accent px-2.5 text-xs font-medium text-white hover:brightness-110"
        >
          Use this
        </button>
      </div>
    </div>
  );
}
