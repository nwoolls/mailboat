import { useEffect, useSyncExternalStore } from "react";
import { commands, events } from "../../../platform/tauri/bindings";
import { IS_TAURI, unwrap } from "../../../platform/tauri/ipc";
import { canCheck, type UpdateState } from "../model/update";

/**
 * The app's own update, shared by Settings → About and the top-right notice:
 * one state, held here, since an update found in the background must show in
 * both. Rust does the looking and installing (`src-tauri/src/updates.rs`).
 */
let state: UpdateState = { kind: "idle" };
/** Versions put off with "Later". Only for this run: the notice returns at launch. */
let putOff: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

function set(next: UpdateState) {
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useUpdateState(): UpdateState {
  return useSyncExternalStore(subscribe, () => state);
}

export function usePutOffUpdates(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, () => putOff);
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** "Check for updates". */
export async function checkForUpdates(): Promise<void> {
  if (!canCheck(state)) return;
  set({ kind: "checking" });
  try {
    const found = await unwrap(commands.updateCheck());
    set(
      found
        ? { kind: "available", version: found.version, notes: found.notes }
        : { kind: "upToDate" },
    );
  } catch (e) {
    set({ kind: "failed", message: errorText(e) });
  }
}

/**
 * "Install and restart": Rust downloads it, checks its signature, installs it
 * and starts the new version, so this only comes back with an error.
 */
export async function installUpdate(): Promise<void> {
  if (state.kind !== "available") return;
  const { version, notes } = state;
  set({ kind: "installing", version, notes, downloaded: 0, total: null });
  try {
    await unwrap(commands.updateInstall());
  } catch (e) {
    set({ kind: "available", version, notes, error: errorText(e) });
  }
}

/** "Later": not again for this version until the next launch. */
export function putOffUpdate(version: string) {
  putOff = new Set([...putOff, version]);
  for (const listener of listeners) listener();
}

/** What Rust says on its own: an update found by a look nobody asked for, and a download's progress. */
export function useUpdateEvents() {
  useEffect(() => {
    if (!IS_TAURI) return;
    const unlisteners = [
      events.updateAvailableEvent.listen((e) => {
        // Not in the middle of installing one.
        if (state.kind === "installing") return;
        set({ kind: "available", version: e.payload.version, notes: e.payload.notes });
      }),
      events.updateProgressEvent.listen((e) => {
        if (state.kind !== "installing") return;
        set({ ...state, downloaded: e.payload.downloaded, total: e.payload.total });
      }),
    ];
    return () => {
      for (const unlisten of unlisteners) void unlisten.then((fn) => fn());
    };
  }, []);
}
