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

const detail = (id: number) =>
  ({ thread: { id }, messages: [{ id: 5, draft: false }], labels: [] }) as unknown as ThreadDetail;

function show(id: number) {
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <ThreadSummaryCard detail={detail(id)} zoom={1} />
    </QueryClientProvider>,
  );
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

  it("leaves other conversations alone", () => {
    requestSummary(9);
    show(10);
    expect(screen.getByText("Summarize")).toBeTruthy();
  });
});
