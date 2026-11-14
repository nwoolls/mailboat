import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MessageMeta, ThreadDetail } from "../../../platform/tauri/bindings";

const threadGet = vi.fn();
const messagePrint = vi.fn();
const windowPrint = vi.fn();
const showToast = vi.fn();

vi.mock("../../../platform/tauri/bindings", () => ({
  commands: {
    threadGet: (id: number) => threadGet(id),
    messagePrint: (id: number) => messagePrint(id),
    windowPrint: () => windowPrint(),
  },
}));
vi.mock("../../../platform/tauri/ipc", () => ({
  unwrap: async (p: Promise<unknown>) => p,
}));
vi.mock("../../../shared/lib/toast", () => ({ showToast: (t: unknown) => showToast(t) }));

const { PrintView } = await import("./PrintView");

function meta(id: number): MessageMeta {
  return {
    id,
    accountId: 1,
    threadId: 7,
    from: { name: "Maya Chen", email: "maya@x.example" },
    to: [{ name: "Priya Raman", email: "priya@x.example" }],
    cc: [],
    subject: "Lisbon in May?",
    snippet: "",
    internalDate: id * 1000,
    unread: false,
    starred: false,
    hasAttachments: false,
    draft: false,
  };
}

function detail(ids: number[]): ThreadDetail {
  return {
    thread: { id: 7, subject: "Lisbon in May?" } as ThreadDetail["thread"],
    messages: ids.map(meta),
    labels: [],
  };
}

const opened = (id: number) => ({
  messageId: id,
  accountId: 1,
  senderEmail: "maya@x.example",
  imagesAllowed: true,
  imagePolicy: "loadedByDefault",
  attachments: [],
  originalColors: false,
  document: "<p>Hi</p>",
  blockedImages: 0,
  loadedImages: 0,
  trackersRemoved: 0,
  adaptive: false,
  recolorable: false,
});

function setup(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  messagePrint.mockImplementation(async (id: number) => opened(id));
  windowPrint.mockResolvedValue({ status: "ok", data: null });
  const view = (run: number) => (
    <QueryClientProvider client={client}>
      <PrintView threadId={7} run={run} />
    </QueryClientProvider>
  );
  return { client, view };
}

const frames = () => [...document.querySelectorAll<HTMLIFrameElement>(".print-root iframe")];

/** Waits for the printout's frames (happy-dom loads a `srcdoc` frame by itself). */
async function loadFrames(count: number) {
  await waitFor(() => expect(frames()).toHaveLength(count));
}

afterEach(() => {
  cleanup();
  for (const f of [threadGet, messagePrint, windowPrint, showToast]) f.mockReset();
});

describe("printing a conversation", () => {
  it("opens the dialog once, only after every email has loaded", async () => {
    const { view } = setup();
    threadGet.mockResolvedValue(detail([1, 2, 3]));
    let last!: () => void;
    messagePrint.mockImplementation((id: number) =>
      id === 3
        ? new Promise((done) => (last = () => done(opened(3))))
        : Promise.resolve(opened(id)),
    );
    render(view(1));
    await waitFor(() => expect(frames()).toHaveLength(2));
    await new Promise((r) => setTimeout(r, 50));
    expect(windowPrint).not.toHaveBeenCalled();
    act(() => last());
    await waitFor(() => expect(windowPrint).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(windowPrint).toHaveBeenCalledTimes(1);
  });

  it("reads the conversation afresh, not from the reader's cache", async () => {
    const { client, view } = setup();
    // The reader's copy is out of date: a reply arrived since.
    client.setQueryData(["thread", 7], detail([1]));
    let answer!: (d: ThreadDetail) => void;
    threadGet.mockReturnValue(new Promise((done) => (answer = done)));
    render(view(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(messagePrint).not.toHaveBeenCalled();
    act(() => answer(detail([1, 2])));
    await loadFrames(2);
    await waitFor(() => expect(windowPrint).toHaveBeenCalledTimes(1));
    expect(messagePrint.mock.calls.map(([id]) => id)).toEqual([1, 2]);
  });

  it("loads nothing more once printed, when mail arrives", async () => {
    const { client, view } = setup();
    threadGet.mockResolvedValue(detail([1]));
    render(view(1));
    await loadFrames(1);
    await waitFor(() => expect(windowPrint).toHaveBeenCalledTimes(1));
    threadGet.mockResolvedValue(detail([1, 2]));
    // As `useMailEvents` does when mail changes.
    await act(() => client.invalidateQueries({ queryKey: ["thread"] }));
    await new Promise((r) => setTimeout(r, 50));
    expect(threadGet).toHaveBeenCalledTimes(1);
    expect(messagePrint).toHaveBeenCalledTimes(1);
    expect(frames()).toHaveLength(1);
  });

  it("never prints a run that a newer one replaced", async () => {
    // Animation frames run only when the test says, so the first run can
    // be replaced between being ready and printing.
    const pending = new Map<number, FrameRequestCallback>();
    let next = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      pending.set(++next, cb);
      return next;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => pending.delete(id));
    const runFrames = () =>
      act(() => {
        const due = [...pending.values()];
        pending.clear();
        for (const cb of due) cb(0);
      });

    const { view } = setup();
    threadGet.mockResolvedValue(detail([1]));
    const { rerender } = render(view(1));
    await loadFrames(1);
    await waitFor(() => expect(pending.size).toBeGreaterThan(0));
    let second!: () => void;
    messagePrint.mockReturnValue(new Promise((done) => (second = () => done(opened(1)))));
    rerender(view(2));
    runFrames();
    runFrames();
    expect(windowPrint).not.toHaveBeenCalled();
    act(() => second());
    await waitFor(() => expect(pending.size).toBeGreaterThan(0));
    runFrames();
    runFrames();
    await waitFor(() => expect(windowPrint).toHaveBeenCalledTimes(1));
    vi.restoreAllMocks();
  });

  it("says so instead of printing when an email fails to load", async () => {
    const { view } = setup();
    threadGet.mockResolvedValue(detail([1, 2]));
    messagePrint.mockImplementation(async (id: number) => {
      if (id === 2) throw new Error("offline");
      return opened(id);
    });
    render(view(1));
    await waitFor(() => expect(showToast).toHaveBeenCalledTimes(1));
    expect(windowPrint).not.toHaveBeenCalled();
  });
});
