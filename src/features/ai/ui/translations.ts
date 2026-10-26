import { useSyncExternalStore } from "react";
import { commands, type MessageId } from "../../../platform/tauri/bindings";
import { unwrap } from "../../../platform/tauri/ipc";
import { languageLabel } from "../model/translate";
import { newRequestId } from "./stream";

/**
 * Translations of text selected in emails, shown above each email
 * (`TranslationCard`) without changing it, one per email, kept while
 * Mailboat runs.
 */
export type Translation =
  | { state: "working"; original: string }
  | { state: "done"; original: string; text: string; by: string; source: string | null }
  | { state: "failed"; original: string; message: string };

const entries = new Map<MessageId, Translation>();
const running = new Map<MessageId, number>();
const subscribers = new Set<() => void>();
let version = 0;

function set(message: MessageId, entry: Translation | null) {
  if (entry) entries.set(message, entry);
  else entries.delete(message);
  version++;
  for (const s of subscribers) s();
}

/** Translates text selected in an email into the Mac's language. */
export async function translateInMessage(message: MessageId, text: string) {
  const previous = running.get(message);
  if (previous !== undefined) void commands.aiCancel(previous);
  const id = newRequestId();
  running.set(message, id);
  set(message, { state: "working", original: text });
  const target = navigator.language;
  try {
    const answer = await unwrap(commands.aiTranslate(text, target, languageLabel(target), id));
    if (running.get(message) !== id) return;
    set(message, {
      state: "done",
      original: text,
      text: answer.text,
      by: answer.by,
      source: answer.source,
    });
  } catch (e) {
    if (running.get(message) !== id) return;
    set(message, { state: "failed", original: text, message: (e as Error).message });
  } finally {
    if (running.get(message) === id) running.delete(message);
  }
}

export function closeTranslation(message: MessageId) {
  const id = running.get(message);
  if (id !== undefined) void commands.aiCancel(id);
  running.delete(message);
  set(message, null);
}

export function useTranslation(message: MessageId): Translation | undefined {
  useSyncExternalStore(
    (notify) => {
      subscribers.add(notify);
      return () => subscribers.delete(notify);
    },
    () => version,
  );
  return entries.get(message);
}
