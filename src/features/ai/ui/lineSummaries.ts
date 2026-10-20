import { useEffect, useSyncExternalStore } from "react";
import { commands, events, type ThreadId } from "../../../platform/tauri/bindings";
import { IS_TAURI, unwrap } from "../../../platform/tauri/ipc";

/**
 * The list's one-line summaries, by conversation. The list asks for the
 * rows on screen; Rust answers with those it has and writes the rest in
 * the background, each arriving as an `AiLineSummaryEvent`.
 */
const lines = new Map<ThreadId, string>();
const subscribers = new Set<() => void>();
let version = 0;
let listening = false;
let lastAsked: ThreadId[] = [];

function changed() {
  version++;
  for (const s of subscribers) s();
}

function listen() {
  if (listening || !IS_TAURI) return;
  listening = true;
  void events.aiLineSummaryEvent.listen((e) => {
    lines.set(e.payload.threadId, e.payload.text);
    changed();
  });
  // New mail makes a summary out of date: ask again for the rows shown.
  void events.mailChangedEvent.listen(() => {
    if (lastAsked.length > 0) void ask(lastAsked);
  });
}

async function ask(ids: ThreadId[]) {
  lastAsked = ids;
  try {
    const current = await unwrap(commands.aiListSummaries(ids));
    const fresh = new Map(current.map((s) => [s.threadId, s.text]));
    for (const id of ids) {
      const text = fresh.get(id);
      if (text === undefined) lines.delete(id);
      else lines.set(id, text);
    }
    changed();
  } catch {
    // Summaries are extra; the list shows the email's own words instead.
  }
}

/** Forgets every summary (they were cleared, or turned off). */
export function clearLineSummaries() {
  lines.clear();
  changed();
}

/**
 * Asks for the summaries of the rows on screen (`ids`, top first) once
 * the list has been still for a moment, and returns the store's version
 * so the rows re-render as summaries arrive.
 */
export function useLineSummaries(ids: ThreadId[], enabled: boolean): ReadonlyMap<ThreadId, string> {
  listen();
  const key = enabled ? ids.join(",") : "";
  useEffect(() => {
    if (!key) return;
    const wanted = key.split(",").map(Number);
    const timer = window.setTimeout(() => void ask(wanted), 400);
    return () => window.clearTimeout(timer);
  }, [key]);
  useSyncExternalStore(
    (notify) => {
      subscribers.add(notify);
      return () => subscribers.delete(notify);
    },
    () => version,
  );
  return lines;
}
