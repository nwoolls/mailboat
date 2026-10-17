import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { commands } from "../../../platform/tauri/bindings";
import { unwrap } from "../../../platform/tauri/ipc";
import { keys } from "../../../shared/lib/queries";
import { type Selection, selectionKey } from "../model/views";

export type OlderStatus = "idle" | "loading" | "error";

/**
 * Fetches conversations older than the cache from Gmail when a list
 * reaches its end. For a search, it asks Gmail's own search (`q=`), each
 * account at once; what Gmail matched joins the local results. Remembers (until relaunch) which views Gmail has
 * nothing older for, so they stop asking. After an error it waits for
 * `retry` instead of asking again on every scroll.
 */
export function useOlderMail(selection: Selection) {
  const qc = useQueryClient();
  const key = selectionKey(selection);
  const [exhausted, setExhausted] = useState<ReadonlySet<string>>(() => new Set());
  const mutation = useMutation({
    mutationFn: (s: Selection) => unwrap(commands.threadsLoadOlder(s.accounts, s.view)),
    onSuccess: async (result, s) => {
      if (result.exhausted) setExhausted((prev) => new Set(prev).add(selectionKey(s)));
      // Stay "loading" until the list has the new rows, so reaching the
      // end again doesn't ask Gmail twice for the same page.
      await qc.invalidateQueries({ queryKey: keys.threads(s) });
    },
  });
  const forThis = mutation.variables !== undefined && selectionKey(mutation.variables) === key;
  const status: OlderStatus =
    forThis && mutation.isPending ? "loading" : forThis && mutation.isError ? "error" : "idle";
  return {
    /** More may be waiting in Gmail, and it's fine to ask now. */
    available: !exhausted.has(key) && status === "idle",
    /** A search: the footer says "Searching Gmail…". */
    searching: selection.view.kind === "search",
    /** Any view's load is running (one at a time). */
    busy: mutation.isPending,
    status,
    load: () => mutation.mutate(selection),
    retry: () => mutation.mutate(selection),
  };
}
