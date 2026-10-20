import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { newDraft } from "../../compose/model/draft";

const aiWrite = vi.fn();
vi.mock("../../../platform/tauri/bindings", () => ({
  commands: { aiWrite: (...a: unknown[]) => aiWrite(...a), aiCancel: vi.fn() },
  events: {},
}));
vi.mock("../../../shared/lib/queries", () => ({
  useAppSettings: () => ({ data: { ai: {} } }),
  useSaveAppSettings: () => ({ mutate: vi.fn() }),
  useAiStatus: () => ({ data: [{ provider: "apple", state: "ready", account: null }] }),
  useAiReplyIdeas: (thread: number | null) =>
    thread === null
      ? { isError: false, isSuccess: false, data: undefined }
      : {
          isError: false,
          isSuccess: true,
          data: ["Confirm Thursday at 3pm", "Ask about the budget"],
        },
}));

const { AssistantPanel } = await import("./AssistantPanel");

afterEach(cleanup);

describe("AssistantPanel", () => {
  it("puts the cursor in the chat box when it opens", async () => {
    render(
      <AssistantPanel
        draft={newDraft([], 1, "me@x.com")}
        placement="side"
        onUse={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await act(() => new Promise((r) => requestAnimationFrame(() => r(null))));
    expect(document.activeElement).toBe(screen.getByLabelText("Ask the AI"));
  });

  it("asks with the chat, shows the draft, and Insert or Replace hands it over", async () => {
    aiWrite.mockResolvedValue({
      status: "ok",
      data: {
        text: "Yes, **Thursday** works.",
        html: "<p>Yes, <strong>Thursday</strong> works.</p>",
        subject: null,
      },
    });
    const onUse = vi.fn();
    const draft = { ...newDraft([], 1, "me@x.com"), kind: "reply" as const, threadId: 42 };
    render(<AssistantPanel draft={draft} placement="side" onUse={onUse} onClose={vi.fn()} />);

    const field = screen.getByLabelText("Ask the AI");
    fireEvent.change(field, { target: { value: "Say yes" } });
    await act(async () => {
      fireEvent.keyDown(field, { key: "Enter" });
    });

    expect(aiWrite).toHaveBeenCalledTimes(1);
    const [request] = aiWrite.mock.calls[0]!;
    expect(request).toMatchObject({
      hasSignature: false,
      threadId: 42,
      kind: "reply",
      chat: [{ role: "user", text: "Say yes" }],
    });
    fireEvent.click(await screen.findByText("Replace"));
    expect(onUse).toHaveBeenCalledWith(
      "<p>Yes, <strong>Thursday</strong> works.</p>",
      null,
      "replace",
    );
    fireEvent.click(screen.getByText("Insert"));
    expect(onUse).toHaveBeenLastCalledWith(
      "<p>Yes, <strong>Thursday</strong> works.</p>",
      null,
      "insert",
    );
    // Shown formatted in the chat, not as Markdown.
    expect(screen.getByText("Thursday").tagName).toBe("STRONG");
  });

  it("offers ideas written from the email when replying", () => {
    const reply = { ...newDraft([], 1, "me@x.com"), kind: "reply" as const, threadId: 42 };
    render(<AssistantPanel draft={reply} placement="top" onUse={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText("Confirm Thursday at 3pm")).toBeTruthy();
    expect(screen.queryByText("Say yes")).toBeNull();
  });

  it("shows a failure in the chat, and Escape closes the panel", async () => {
    aiWrite.mockResolvedValue({
      status: "error",
      error: { kind: "ai", message: "Claude is busy" },
    });
    const onClose = vi.fn();
    render(
      <AssistantPanel
        draft={newDraft([], 1, "me@x.com")}
        placement="top"
        onUse={vi.fn()}
        onClose={onClose}
      />,
    );
    // A suggestion asks straight away.
    await act(async () => {
      fireEvent.click(screen.getByText("Follow up politely"));
    });
    expect((await screen.findByRole("alert")).textContent).toBe("Claude is busy");
    fireEvent.keyDown(screen.getByLabelText("Ask the AI"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
