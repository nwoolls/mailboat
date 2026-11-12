import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ThreadDetail } from "../../../platform/tauri/bindings";

const aiThreadSummary = vi.fn();
vi.mock("../../../platform/tauri/bindings", () => ({
  commands: {
    aiThreadSummary: (...a: unknown[]) => aiThreadSummary(...a),
    aiCancel: vi.fn(),
  },
  events: {},
}));
vi.mock("../../../platform/tauri/ipc", async (real) => ({
  ...(await real<object>()),
  IS_TAURI: true,
}));
vi.mock("./stream", () => ({
  newRequestId: () => 1,
  dropText: vi.fn(),
  useStreamedText: () => "",
}));
// Summaries on a button, so nothing is asked until someone asks.
vi.mock("../../../shared/lib/queries", () => ({
  useAppSettings: () => ({ data: { ai: { readerSummary: "button" } } }),
  useAiStatus: () => ({ data: [{ provider: "apple", state: "ready", account: null }] }),
}));

const { ThreadSummaryCard } = await import("./ThreadSummaryCard");
const { requestSummary } = await import("./summaryRequests");

afterEach(cleanup);

const detail = (id: number, newest = 5) =>
  ({
    thread: { id },
    messages: [{ id: newest, draft: false }],
    labels: [],
  }) as unknown as ThreadDetail;

function show(id: number, newest = 5) {
  const client = new QueryClient();
  const tree = (newestId: number) => (
    <QueryClientProvider client={client}>
      <ThreadSummaryCard detail={detail(id, newestId)} zoom={1} />
    </QueryClientProvider>
  );
  const view = render(tree(newest));
  // New mail arriving in the open conversation.
  return { client, newMail: (newestId: number) => view.rerender(tree(newestId)) };
}

describe("ThreadSummaryCard", () => {
  it("summarizes when asked from a menu, as the button does", async () => {
    aiThreadSummary.mockResolvedValue({
      status: "ok",
      data: { threadId: 7, text: "- Lunch moved to Friday", provider: "apple", createdAt: 0 },
    });
    show(7);
    expect(screen.getByText("Summarize")).toBeTruthy();
    expect(aiThreadSummary).not.toHaveBeenCalled();

    await act(async () => requestSummary(7));
    expect(await screen.findByText("Lunch moved to Friday")).toBeTruthy();
    // Asked for, so short conversations are summarized too (not automatic).
    expect(aiThreadSummary).toHaveBeenCalledWith(7, false, false, 1);
  });

  it("comes back after Hide when asked again", async () => {
    aiThreadSummary.mockResolvedValue({
      status: "ok",
      data: { threadId: 8, text: "- Invoice is due", provider: "apple", createdAt: 0 },
    });
    await act(async () => requestSummary(8));
    show(8);
    await screen.findByText("Invoice is due");

    fireEvent.click(screen.getByLabelText("Hide summary"));
    expect(screen.queryByText("Invoice is due")).toBeNull();

    await act(async () => requestSummary(8));
    expect(await screen.findByText("Invoice is due")).toBeTruthy();
  });

  it("waits for another ask when new mail arrives after one", async () => {
    aiThreadSummary.mockClear();
    aiThreadSummary.mockResolvedValue({
      status: "ok",
      data: { threadId: 11, text: "- Plans confirmed", provider: "claude", createdAt: 0 },
    });
    const { newMail } = show(11);
    fireEvent.click(screen.getByText("Summarize"));
    expect(await screen.findByText("Plans confirmed")).toBeTruthy();
    expect(aiThreadSummary).toHaveBeenCalledTimes(1);

    // A newer message: back to the button, and nothing is sent by itself.
    await act(async () => newMail(6));
    expect(screen.getByText("Summarize")).toBeTruthy();
    expect(aiThreadSummary).toHaveBeenCalledTimes(1);

    // Asked again, it is summarized.
    fireEvent.click(screen.getByText("Summarize"));
    expect(await screen.findByText("Plans confirmed")).toBeTruthy();
    expect(aiThreadSummary).toHaveBeenCalledTimes(2);
  });

  // Asked again when mail changed, the card fell back to its one-line
  // placeholder until the (usually identical) answer came: it shrank and
  // grew back, moving a reply being written below it.
  it("keeps showing its summary while it is asked again", async () => {
    aiThreadSummary.mockResolvedValue({
      status: "ok",
      data: { threadId: 12, text: "- Tickets booked", provider: "apple", createdAt: 0 },
    });
    const { client } = show(12);
    fireEvent.click(screen.getByText("Summarize"));
    expect(await screen.findByText("Tickets booked")).toBeTruthy();

    aiThreadSummary.mockReturnValue(new Promise(() => {}));
    await act(async () => void client.invalidateQueries({ queryKey: ["aiSummary"] }));
    expect(screen.getByRole("region", { name: "Summary" }).getAttribute("aria-busy")).toBe("true");
    expect(screen.getByText("Tickets booked")).toBeTruthy();
  });

  it("leaves other conversations alone", () => {
    requestSummary(9);
    show(10);
    expect(screen.getByText("Summarize")).toBeTruthy();
  });
});
