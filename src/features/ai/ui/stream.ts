import { useSyncExternalStore } from "react";
import { events } from "../../../platform/tauri/bindings";
import { IS_TAURI } from "../../../platform/tauri/ipc";

/**
 * Answers arrive bit by bit as `AiTextEvent`s, tagged with the request's
 * ID. One listener keeps the latest text per request for the components
 * showing it.
 */
const texts = new Map<number, string>();
const subscribers = new Set<() => void>();
let listening = false;

function listen() {
  if (listening || !IS_TAURI) return;
  listening = true;
  void events.aiTextEvent.listen((e) => {
    texts.set(e.payload.requestId, e.payload.text);
    for (const s of subscribers) s();
  });
}

let counter = Math.floor(Math.random() * 1_000_000);
/** A new request's ID (fits Rust's u32). */
export function newRequestId(): number {
  counter = (counter + 1) % 4_000_000_000;
  return counter;
}

/** Forgets a finished request's text. */
export function dropText(requestId: number) {
  texts.delete(requestId);
}

/** The text so far of the request, or "" before any arrives. */
export function useStreamedText(requestId: number | null): string {
  listen();
  return useSyncExternalStore(
    (notify) => {
      subscribers.add(notify);
      return () => subscribers.delete(notify);
    },
    () => (requestId === null ? "" : (texts.get(requestId) ?? "")),
  );
}
