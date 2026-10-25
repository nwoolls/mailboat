import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MessageId } from "../../../platform/tauri/bindings";

const aiTranslate = vi.fn();
vi.mock("../../../platform/tauri/bindings", () => ({
  commands: { aiTranslate: (...a: unknown[]) => aiTranslate(...a), aiCancel: vi.fn() },
  events: {},
}));

const { TranslationCard } = await import("./TranslationCard");
const { translateInMessage } = await import("./translations");

afterEach(cleanup);

describe("TranslationCard", () => {
  it("shows the translation under the email, into the Mac's language, until closed", async () => {
    aiTranslate.mockResolvedValue({
      status: "ok",
      data: { text: "See you on Friday", html: "", source: "fr", by: "Apple Translation" },
    });
    const id = 5 as MessageId;
    render(<TranslationCard messageId={id} />);
    expect(screen.queryByLabelText("Translation")).toBeNull();

    await act(() => translateInMessage(id, "À vendredi"));
    expect(screen.getByText("See you on Friday")).toBeTruthy();
    expect(screen.getByText(/from French by Apple Translation/)).toBeTruthy();
    const [text, target] = aiTranslate.mock.calls[0]!;
    expect([text, target]).toEqual(["À vendredi", navigator.language]);

    fireEvent.click(screen.getByLabelText("Close translation"));
    expect(screen.queryByLabelText("Translation")).toBeNull();
  });

  it("says why it couldn't", async () => {
    aiTranslate.mockResolvedValue({
      status: "error",
      error: { kind: "ai", message: "Download it in System Settings" },
    });
    const id = 6 as MessageId;
    render(<TranslationCard messageId={id} />);
    await act(() => translateInMessage(id, "Hallo"));
    expect(screen.getByText(/Couldn’t translate: Download it/)).toBeTruthy();
  });
});
