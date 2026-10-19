import { describe, expect, it } from "vitest";
import {
  accelLabel,
  appCommands,
  conversationCommands,
  isCommandId,
  MENU_BAR,
  menuBarSpecs,
  menuStates,
} from "./commands";

const row = (over: Partial<Parameters<typeof conversationCommands>[0][number]> = {}) => ({
  unread: true,
  inInbox: true,
  starred: false,
  inTrash: false,
  inSpam: false,
  onlyDraft: false,
  ...over,
});
const none = { editing: false, canFilter: true, blockEmail: "x@y.com" };

describe("conversationCommands", () => {
  it("names actions after what they'll do", () => {
    const byId = new Map(
      conversationCommands([row({ unread: false, inInbox: false, starred: true })], none).map(
        (c) => [c.id, c],
      ),
    );
    expect(byId.get("archive")?.title).toBe("Move to Inbox");
    expect(byId.get("read")?.title).toBe("Mark as unread");
    expect(byId.get("star")?.title).toBe("Unstar");
    expect(byId.get("block")?.title).toBe("Block x@y.com…");
  });

  it("offers replies for one conversation only, and nothing with none", () => {
    const two = conversationCommands([row(), row()], none);
    expect(two.find((c) => c.id === "reply")?.enabled).toBe(false);
    expect(two.find((c) => c.id === "filterLike")?.title).toBe("Filter messages like these…");
    expect(conversationCommands([], none).every((c) => !c.enabled)).toBe(true);
  });

  it("turns off changing actions while typing, but not replies", () => {
    const typing = conversationCommands([row()], { ...none, editing: true });
    expect(typing.find((c) => c.id === "archive")?.enabled).toBe(false);
    expect(typing.find((c) => c.id === "labels")?.enabled).toBe(false);
    expect(typing.find((c) => c.id === "reply")?.enabled).toBe(true);
  });
});

describe("menu bar", () => {
  it("lists only commands that exist, each once", () => {
    const ids = new Set([
      ...conversationCommands([row()], none).map((c) => c.id),
      ...appCommands({ sidebarOpen: true, readerOpen: true, hasConversation: true }).map(
        (c) => c.id,
      ),
    ]);
    const listed = MENU_BAR.flatMap((m) => m.items).filter((i) => i !== "-");
    expect(listed.filter((id) => !ids.has(id))).toEqual([]);
    expect(new Set(listed).size).toBe(listed.length);
  });

  it("shows shortcuts as macOS does", () => {
    expect(accelLabel("Shift+Cmd+R")).toBe("⇧⌘R");
    expect(accelLabel("Ctrl+Cmd+A")).toBe("⌃⌘A");
  });

  it("gives no two commands the same menu shortcut", () => {
    const accels = [
      ...conversationCommands([row()], none),
      ...appCommands({ sidebarOpen: true, readerOpen: true, hasConversation: true }),
    ].flatMap((c) => (c.accel ? [c.accel] : []));
    expect(new Set(accels).size).toBe(accels.length);
  });
});

describe("menu bar specs", () => {
  it("fills each menu with its commands' names, shortcuts and states", () => {
    const states = menuStates([
      ...conversationCommands([row()], none),
      ...appCommands({ sidebarOpen: false, readerOpen: true, hasConversation: false }),
    ]);
    const specs = menuBarSpecs(MENU_BAR, states);
    const view = specs.find((m) => m.title === "View")!;
    expect(view.items[0]).toEqual({
      kind: "item",
      id: "sidebar",
      title: "Show sidebar",
      accel: "Ctrl+Cmd+S",
      enabled: true,
    });
    expect(view.items[1]).toMatchObject({ id: "reader", enabled: false });
    expect(view.items[2]).toEqual({ kind: "separator" });
  });

  it("knows its own IDs", () => {
    expect(isCommandId("go:i")).toBe(true);
    expect(isCommandId("archive")).toBe(true);
    expect(isCommandId("rm -rf")).toBe(false);
  });
});
