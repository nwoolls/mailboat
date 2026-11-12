import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

type Listener = (e: { payload: { accountId: number; draftsOnly: boolean } }) => void;
const listeners: Partial<Record<string, Listener>> = {};
const listen = (name: string) => (cb: Listener) => {
  listeners[name] = cb;
  return Promise.resolve(() => {});
};
vi.mock("../../platform/tauri/ipc", () => ({ IS_TAURI: true, unwrap: (x: unknown) => x }));
vi.mock("../../platform/tauri/bindings", () => ({
  commands: {},
  events: {
    syncStatusEvent: { listen: listen("sync") },
    mailChangedEvent: { listen: listen("mail") },
    accountsChangedEvent: { listen: listen("accounts") },
    identitiesChangedEvent: { listen: listen("identities") },
  },
}));

const { useMailEvents } = await import("./queries");

afterEach(cleanup);

function Listen() {
  useMailEvents();
  return null;
}

describe("useMailEvents", () => {
  // Code review R9-02: when mail changed, the screen kept its own copy of a
  // conversation's AI summary and reply ideas, so it went on showing ones
  // that covered a deleted email, and reply ideas missed new mail.
  it("marks AI results out of date when mail changes", () => {
    const qc = new QueryClient();
    qc.setQueryData(["aiSummary", 7, 14, true], { text: "old" });
    qc.setQueryData(["aiReplyIdeas", 7, false, "apple"], ["old idea"]);
    render(
      <QueryClientProvider client={qc}>
        <Listen />
      </QueryClientProvider>,
    );
    listeners.mail?.({ payload: { accountId: 1, draftsOnly: false } });
    expect(qc.getQueryState(["aiSummary", 7, 14, true])?.isInvalidated).toBe(true);
    expect(qc.getQueryState(["aiReplyIdeas", 7, false, "apple"])?.isInvalidated).toBe(true);
  });

  // A reply saving as it's typed: asking the summary again made it blink
  // above the reply, which moved the reply under the person's cursor.
  // Both leave drafts out, so their answers can't have changed.
  it("leaves AI results alone when only drafts changed", () => {
    const qc = new QueryClient();
    qc.setQueryData(["aiSummary", 7, 14, true], { text: "old" });
    qc.setQueryData(["aiReplyIdeas", 7, false, "apple"], ["old idea"]);
    qc.setQueryData(["thread", 7], { messages: [] });
    render(
      <QueryClientProvider client={qc}>
        <Listen />
      </QueryClientProvider>,
    );
    listeners.mail?.({ payload: { accountId: 1, draftsOnly: true } });
    expect(qc.getQueryState(["aiSummary", 7, 14, true])?.isInvalidated).toBe(false);
    expect(qc.getQueryState(["aiReplyIdeas", 7, false, "apple"])?.isInvalidated).toBe(false);
    // The conversation still refreshes: it shows the saved draft.
    expect(qc.getQueryState(["thread", 7])?.isInvalidated).toBe(true);
  });
});
