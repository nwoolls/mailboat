import { describe, expect, it } from "vitest";
import type { Label, LabelSidebar } from "../../../platform/tauri/bindings";
import { splitByVisibility } from "./labelVisibility";

const label = (id: number, sidebar: LabelSidebar): Label => ({
  id,
  accountId: 1,
  gmailLabelId: `Label_${id}`,
  name: `Label ${id}`,
  kind: "user",
  colorBg: null,
  colorFg: null,
  sidebar,
  onConversations: true,
});

describe("labels in the sidebar", () => {
  it("shows labels set to show, and the unread-only ones while they have unread mail", () => {
    const labels = [
      label(1, "show"),
      label(2, "showIfUnread"),
      label(3, "showIfUnread"),
      label(4, "hide"),
    ];
    const unread = new Map([[2, 3]]);
    const { shown, hidden } = splitByVisibility(labels, (l) => unread.get(l.id) ?? 0);
    expect(shown.map((l) => l.id)).toEqual([1, 2]);
    expect(hidden.map((l) => l.id)).toEqual([3, 4]);
  });
});
