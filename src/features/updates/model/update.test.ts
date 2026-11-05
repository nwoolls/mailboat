import { describe, expect, it } from "vitest";
import {
  canCheck,
  describeUpdate,
  notesPreview,
  percent,
  showNotice,
  type UpdateState,
} from "./update";

const available: UpdateState = { kind: "available", version: "0.2.0", notes: "Fixes." };

describe("what the About row says", () => {
  it("says each state in plain words", () => {
    expect(describeUpdate({ kind: "idle" })).toMatch(/not checked/i);
    expect(describeUpdate({ kind: "checking" })).toBe("Checking…");
    expect(describeUpdate({ kind: "upToDate" })).toBe("You have the latest version.");
    expect(describeUpdate(available)).toBe("Version 0.2.0 is available.");
    expect(describeUpdate({ kind: "failed", message: "No network." })).toBe("No network.");
  });

  it("says why an install failed, and that the update is still there", () => {
    expect(describeUpdate({ ...available, error: "The update failed." })).toBe(
      "Version 0.2.0 is available, but it couldn’t be installed: The update failed.",
    );
  });
});

describe("the download's progress", () => {
  it("is a whole percent, held between 0 and 100", () => {
    expect(percent(50, 200)).toBe(25);
    expect(percent(1, 3)).toBe(33);
    expect(percent(300, 200)).toBe(100);
    expect(percent(0, 200)).toBe(0);
  });

  it("is unknown until the size is", () => {
    expect(percent(50, null)).toBeNull();
    expect(percent(50, 0)).toBeNull();
  });
});

describe("pressing Check for updates", () => {
  it("is possible except while checking or installing", () => {
    expect(canCheck({ kind: "idle" })).toBe(true);
    expect(canCheck({ kind: "upToDate" })).toBe(true);
    expect(canCheck(available)).toBe(true);
    expect(canCheck({ kind: "failed", message: "x" })).toBe(true);
    expect(canCheck({ kind: "checking" })).toBe(false);
    expect(
      canCheck({ kind: "installing", version: "0.2.0", notes: null, downloaded: 0, total: null }),
    ).toBe(false);
  });
});

describe("the notice", () => {
  const none = new Set<string>();

  it("shows for an update, not for anything else", () => {
    expect(showNotice(available, none)).toBe(true);
    expect(showNotice({ kind: "idle" }, none)).toBe(false);
    expect(showNotice({ kind: "checking" }, none)).toBe(false);
    expect(showNotice({ kind: "upToDate" }, none)).toBe(false);
    expect(showNotice({ kind: "failed", message: "x" }, none)).toBe(false);
  });

  it("stays away for a version put off with Later, but not for a newer one", () => {
    expect(showNotice(available, new Set(["0.2.0"]))).toBe(false);
    expect(showNotice({ ...available, version: "0.3.0" }, new Set(["0.2.0"]))).toBe(true);
  });

  it("always shows while installing, even for a version put off", () => {
    const installing: UpdateState = {
      kind: "installing",
      version: "0.2.0",
      notes: null,
      downloaded: 10,
      total: 100,
    };
    expect(showNotice(installing, new Set(["0.2.0"]))).toBe(true);
  });
});

describe("the release notes in the notice", () => {
  it("is nothing for empty or missing notes", () => {
    expect(notesPreview(null)).toBeNull();
    expect(notesPreview("  \n \n")).toBeNull();
  });

  it("keeps short notes as they are, without blank lines", () => {
    expect(notesPreview("A fix.\n\n  Another fix.  ")).toBe("A fix.\nAnother fix.");
  });

  it("cuts long notes to a few lines, and says so", () => {
    expect(notesPreview("1\n2\n3\n4\n5\n6")).toBe("1\n2\n3\n4…");
    const long = "x".repeat(500);
    const cut = notesPreview(long)!;
    expect(cut.length).toBeLessThanOrEqual(281);
    expect(cut.endsWith("…")).toBe(true);
  });
});
