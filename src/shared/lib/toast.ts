import { useSyncExternalStore } from "react";
import type { ToastData } from "../ui/Toast";

/**
 * The one toast on screen, shared app-wide so anything (the toolbar's
 * actions, an attachment save) can show a line at the bottom of the window.
 */
let current: ToastData | null = null;
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => {
  for (const listener of listeners) listener();
};

export function showToast(toast: Omit<ToastData, "id">): void {
  current = { ...toast, id: ++seq };
  emit();
}

export function dismissToast(): void {
  if (current === null) return;
  current = null;
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useToast(): ToastData | null {
  return useSyncExternalStore(subscribe, () => current);
}
