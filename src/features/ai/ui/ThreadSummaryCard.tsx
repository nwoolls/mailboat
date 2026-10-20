import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { commands, type ThreadDetail, type ThreadId } from "../../../platform/tauri/bindings";
import { IS_TAURI, unwrap } from "../../../platform/tauri/ipc";
import { useAiStatus, useAppSettings } from "../../../shared/lib/queries";
import { AiIcon, ClearIcon, SyncIcon } from "../../../shared/ui/icons";
import { aiChoices, isReady, PROVIDER_NAMES } from "../model/providers";
import { summaryPoints } from "../model/summary";
import { dropText, newRequestId, useStreamedText } from "./stream";

/** Conversations whose next summary request should skip the cache. */
const askAgain = new Set<ThreadId>();

/**
 * The AI summary above an opened conversation (Settings → AI): written
 * by itself for long conversations, or when Summarize is pressed. Leaving
 * the conversation while it's being written stops it.
 */
export function ThreadSummaryCard({ detail, zoom }: { detail: ThreadDetail; zoom: number }) {
  const ai = aiChoices(useAppSettings().data);
  const status = useAiStatus().data;
  const provider = ai.readerProvider;
  const usable =
    ai.readerSummary !== "off" &&
    isReady(status, provider) &&
    (provider === "apple" || ai.connected.includes(provider));
  const threadId = detail.thread.id;
  // A summary covers the conversation up to its newest message.
  const newest = detail.messages.findLast((m) => !m.draft)?.id ?? 0;
  const [asked, setAsked] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [requestId, setRequestId] = useState<number | null>(null);
  const automatic = !asked;
  const query = useQuery({
    queryKey: ["aiSummary", threadId, newest, automatic],
    queryFn: async ({ signal }) => {
      const id = newRequestId();
      setRequestId(id);
      signal.addEventListener("abort", () => void commands.aiCancel(id));
      const fresh = askAgain.delete(threadId);
      try {
        return await unwrap(commands.aiThreadSummary(threadId, automatic, fresh, id));
      } finally {
        dropText(id);
      }
    },
    enabled: IS_TAURI && usable && (asked || ai.readerSummary === "auto"),
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    retry: false,
  });
  const streamed = useStreamedText(query.isFetching ? requestId : null);
  if (!usable || hidden) return null;

  if (ai.readerSummary === "button" && !asked)
    return (
      <div className="px-4 pb-2" style={{ zoom }}>
        <button
          type="button"
          onClick={() => setAsked(true)}
          title={`Summarize with ${PROVIDER_NAMES[provider]}`}
          className="flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs text-content/60 ring-1 ring-stroke ring-inset hover:bg-selection hover:text-content"
        >
          <AiIcon size={13} className="text-accent" />
          Summarize
        </button>
      </div>
    );

  // Short conversations (automatic) get none.
  if (query.data === null) return null;
  const text = query.isFetching ? streamed : (query.data?.text ?? "");
  const points = summaryPoints(text);

  return (
    <section
      aria-label="Summary"
      aria-busy={query.isFetching}
      className="message-card mb-2 rounded-[10px] px-4 pt-2.5 pb-3 ring-1 ring-stroke ring-inset"
      style={{ zoom }}
    >
      <header className="flex h-6 items-center gap-1.5 text-xs text-content/50">
        <AiIcon size={13} className={`text-accent ${query.isFetching ? "animate-pulse" : ""}`} />
        <span className="font-medium text-content/70">
          {query.isFetching ? "Summarizing…" : "Summary"}
        </span>
        <span title="Change in Settings → AI">· {PROVIDER_NAMES[provider]}</span>
        <span className="ml-auto flex items-center">
          {!query.isFetching && (
            <button
              type="button"
              aria-label="Summarize again"
              title="Summarize again"
              onClick={() => {
                askAgain.add(threadId);
                // Asked for now: a new request (its own query) if the
                // first was automatic, else this one again.
                if (asked) void query.refetch();
                else setAsked(true);
              }}
              className="flex h-6 w-6 items-center justify-center rounded-md hover:bg-selection hover:text-content"
            >
              <SyncIcon size={13} />
            </button>
          )}
          <button
            type="button"
            aria-label="Hide summary"
            title="Hide"
            onClick={() => setHidden(true)}
            className="flex h-6 w-6 items-center justify-center rounded-md hover:bg-selection hover:text-content"
          >
            <ClearIcon size={13} />
          </button>
        </span>
      </header>
      {query.error ? (
        <p className="selectable mt-1 text-xs text-danger">
          Couldn’t summarize: {query.error.message}{" "}
          <button
            type="button"
            className="text-content/60 underline hover:text-content"
            onClick={() => void query.refetch()}
          >
            Try again
          </button>
        </p>
      ) : points.length === 0 ? (
        <div className="mt-1.5 h-3 w-2/3 animate-pulse rounded bg-selection" />
      ) : (
        <ul className="selectable mt-1 list-disc space-y-0.5 pl-4 text-[13px] leading-relaxed text-content/85 marker:text-content/35">
          {points.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
