import { useEffect, useRef, useState } from "react";
import { forgetAssistant } from "./assistantOpen";
import { commands } from "../../../platform/tauri/bindings";
import { IpcError, unwrap } from "../../../platform/tauri/ipc";
import {
  useAiReplyIdeas,
  useAiStatus,
  useAppSettings,
  useSaveAppSettings,
} from "../../../shared/lib/queries";
import { AiIcon, AskIcon, ClearIcon, StopIcon } from "../../../shared/ui/icons";
import { type Draft, textToHtml } from "../../compose/model/draft";
import { type ChatMessage, chatMessage, suggestions, writeRequest } from "../model/chat";
import { aiChoices, offered, PROVIDER_NAMES, statusLine, statusOf } from "../model/providers";
import { dropText, newRequestId, useStreamedText } from "./stream";

/** Insert: at the cursor, keeping what's written. Replace: instead of it. */
export type UseMode = "insert" | "replace";

/**
 * Each message's chat, by draft, so closing the panel (or popping a reply
 * out into the card) keeps it until the message is sent or discarded.
 */
const chats = new Map<number, ChatMessage[]>();

export function forgetChat(draftId: number) {
  chats.delete(draftId);
  forgetAssistant({ id: draftId, threadId: null });
}

/**
 * The writing assistant: a chat about the message being written. Each
 * answer is a whole draft; "Insert" puts it at the cursor, "Replace" in place of
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
  /** Beside the floating card's form (on its left or right), or above an inline reply. */
  placement: "left" | "right" | "top";
  /** The draft as the composer's HTML (cleaned in Rust), and a subject. */
  onUse: (html: string, subject: string | null, how: UseMode) => void;
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
          chatMessage({
            role: "assistant",
            text: answer.text,
            html: answer.html,
            subject: answer.subject,
          }),
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
  // Chips for a reply or forward come from the email itself; new mail (and
  // a failed or impossible request) gets the general ones.
  const ideasFor = draft.kind !== "new" && ready && messages.length === 0 ? draft.threadId : null;
  const ideas = useAiReplyIdeas(ideasFor, draft.kind === "forward", provider);
  const chips =
    ideasFor === null || ideas.isError || (ideas.isSuccess && ideas.data.length === 0)
      ? suggestions(draft.kind)
      : (ideas.data ?? null);
  // Opened (✦ or ⌘J): ready to type. After the click that opened it has
  // finished, and again once the provider's status is known (the box is
  // disabled until then, and a disabled box can't take focus). Without
  // scrolling: in WebKit that cut short the reply's own smooth scroll into
  // view, leaving Reply with AI stopped partway down the email above.
  useEffect(() => {
    if (!ready) return;
    const frame = requestAnimationFrame(() => field.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [ready]);

  return (
    <aside
      aria-label="Write with AI"
      className={`flex min-h-0 flex-col text-[13px] ${
        placement === "top"
          ? "max-h-[340px] border-b border-stroke"
          : // Fixed width: the card's spring reveals and hides it.
            `w-[340px] shrink-0 border-stroke ${placement === "left" ? "border-r" : "border-l"}`
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
            <div
              // Ideas written from the email usually take two rows, and
              // arrive a few seconds after the reply has scrolled into
              // view: the space is kept for two rows from the start, so
              // they don't push the reply down (owner, 2026-10-24).
              className={`mt-2 flex flex-wrap content-start gap-1.5 ${ideasFor === null ? "" : "min-h-[3.375rem]"}`}
            >
              {chips === null &&
                // Being written from the email: faint stand-ins meanwhile,
                // as shares of the width so they always fill two rows.
                ["55%", "35%", "45%"].map((w) => (
                  <span
                    key={w}
                    aria-hidden
                    className="h-6 animate-pulse rounded-full bg-selection"
                    style={{ width: `calc(${w} - 0.375rem)` }}
                  />
                ))}
              {chips?.map((s) => (
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
            <DraftBubble
              key={m.id}
              message={m}
              onUse={(how) => onUse(m.html ?? textToHtml(m.text), m.subject ?? null, how)}
            />
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

/** One draft from the model, with Insert and Replace. */
function DraftBubble({ message, onUse }: { message: ChatMessage; onUse: (how: UseMode) => void }) {
  return (
    <div className="rounded-lg bg-selection px-2.5 pt-2 pb-1.5">
      {message.subject && (
        <p className="mb-1 text-xs text-content/55">
          Subject: <span className="text-content/80">{message.subject}</span>
        </p>
      )}
      {message.html ? (
        <div
          className="compose-editor selectable text-content/85"
          // Cleaned in Rust (ai::format) to plain formatting tags: no
          // images, styles, scripts or attributes but links' href.
          dangerouslySetInnerHTML={{ __html: message.html }}
        />
      ) : (
        <p className="selectable whitespace-pre-wrap text-content/85">{message.text}</p>
      )}
      <div className="mt-1.5 flex justify-end gap-1.5">
        <button
          type="button"
          onClick={() => onUse("insert")}
          title="Add this where the cursor is, keeping what’s written"
          className="h-6 rounded-md px-2.5 text-xs font-medium text-content/80 ring-1 ring-stroke ring-inset hover:bg-selection-strong hover:text-content"
        >
          Insert
        </button>
        <button
          type="button"
          onClick={() => onUse("replace")}
          title="Put this in place of what’s written (signature and quote stay)"
          className="h-6 rounded-md bg-accent px-2.5 text-xs font-medium text-white hover:brightness-110"
        >
          Replace
        </button>
      </div>
    </div>
  );
}
