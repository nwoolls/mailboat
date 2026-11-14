import { onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
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

/** The app's own query defaults (`app/App.tsx`): a failed query is tried once more. */
const appClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: 1, retryDelay: 0 } } });

function setup(client = appClient(), { strict = false } = {}) {
  messagePrint.mockImplementation(async (id: number) => opened(id));
  windowPrint.mockResolvedValue({ status: "ok", data: null });
  const view = (run: number) => {
    const tree = (
      <QueryClientProvider client={client}>
        <PrintView threadId={7} run={run} />
      </QueryClientProvider>
    );
    return strict ? <StrictMode>{tree}</StrictMode> : tree;
  };
  return { client, view };
}

/**
 * Animation frames that run only when the test says, so a run can be
 * replaced at each step between being ready and printing.
 */
function handRunFrames() {
  const pending = new Map<number, FrameRequestCallback>();
  let next = 0;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
    pending.set(++next, cb);
    return next;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => pending.delete(id));
  return {
    pending,
    run: () =>
      act(() => {
        const due = [...pending.values()];
        pending.clear();
        for (const cb of due) cb(0);
      }),
  };
}

const frames = () => [...document.querySelectorAll<HTMLIFrameElement>(".print-root iframe")];

/** Waits for the printout's frames (happy-dom loads a `srcdoc` frame by itself). */
async function loadFrames(count: number) {
  await waitFor(() => expect(frames()).toHaveLength(count));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
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

  for (const framesRun of [0, 1]) {
    it(`never prints a run replaced after ${framesRun} of its two frames`, async () => {
      const frames2 = handRunFrames();
      const { view } = setup();
      threadGet.mockResolvedValue(detail([1]));
      const { rerender } = render(view(1));
      await loadFrames(1);
      await waitFor(() => expect(frames2.pending.size).toBeGreaterThan(0));
      for (let i = 0; i < framesRun; i++) frames2.run();
      let second!: () => void;
      messagePrint.mockReturnValue(new Promise((done) => (second = () => done(opened(1)))));
      rerender(view(2));
      frames2.run();
      frames2.run();
      expect(windowPrint).not.toHaveBeenCalled();
      act(() => second());
      await waitFor(() => expect(frames2.pending.size).toBeGreaterThan(0));
      frames2.run();
      frames2.run();
      await waitFor(() => expect(windowPrint).toHaveBeenCalledTimes(1));
    });
  }

  it("prints once under React's development double run", async () => {
    const { view } = setup(appClient(), { strict: true });
    threadGet.mockResolvedValue(detail([1, 2]));
    render(view(1));
    await waitFor(() => expect(windowPrint).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(windowPrint).toHaveBeenCalledTimes(1);
  });

  it("says why when the conversation itself doesn't load", async () => {
    const { view } = setup();
    threadGet.mockRejectedValue(new Error("offline"));
    render(view(1));
    await waitFor(() => expect(showToast).toHaveBeenCalledTimes(1));
    expect(showToast.mock.calls[0]![0]).toEqual({
      message: "Couldn't print: the conversation didn't load.",
    });
    // Not tried again behind the toast.
    await new Promise((r) => setTimeout(r, 50));
    expect(threadGet).toHaveBeenCalledTimes(1);
    expect(windowPrint).not.toHaveBeenCalled();
  });

  it("prints while the computer is offline, from the app's own cache", async () => {
    onlineManager.setOnline(false);
    try {
      const { view } = setup();
      threadGet.mockResolvedValue(detail([1]));
      render(view(1));
      await waitFor(() => expect(windowPrint).toHaveBeenCalledTimes(1));
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it("says when there's nothing to print", async () => {
    const { view } = setup();
    threadGet.mockResolvedValue({ ...detail([1]), messages: [{ ...meta(1), draft: true }] });
    render(view(1));
    await waitFor(() => expect(showToast).toHaveBeenCalledTimes(1));
    expect(showToast.mock.calls[0]![0]).toEqual({
      message: "There's nothing to print in this conversation yet.",
    });
    expect(windowPrint).not.toHaveBeenCalled();
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
    expect(showToast.mock.calls[0]![0]).toEqual({
      message: "Couldn't print: an email in this conversation didn't load.",
    });
    // Not tried again behind the toast (the app's queries retry once), so
    // no dialog opens after it said it couldn't print.
    await new Promise((r) => setTimeout(r, 50));
    expect(messagePrint.mock.calls.filter(([id]) => id === 2)).toHaveLength(1);
    expect(windowPrint).not.toHaveBeenCalled();
  });
});
