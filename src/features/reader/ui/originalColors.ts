import { useSyncExternalStore } from "react";
import type { MessageId } from "../../../platform/tauri/bindings";

/**
 * Messages switched to "Original colors": shown on the white card with
 * their own colors instead of on the glass with colors adapted for dark
 * mode. Remembered until the app quits, so reopening the conversation
 * keeps the choice.
 */
const shown = new Set<MessageId>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setOriginalColors(id: MessageId, on: boolean) {
  if (on) shown.add(id);
  else shown.delete(id);
  for (const listener of listeners) listener();
}

export function useOriginalColors(id: MessageId): boolean {
  return useSyncExternalStore(subscribe, () => shown.has(id));
}
