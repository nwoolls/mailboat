import { describe, expect, it } from "vitest";
import {
  accelLabel,
  accelMatches,
  detectMac,
  detectPlatform,
  primaryKey,
  revealLabel,
  systemName,
} from "./platform";

const press = (code: string, mods: Partial<KeyboardEvent> = {}) => ({
  key: "",
  code,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

describe("detectMac", () => {
  it("tells the Mac's WebKit from Windows' WebView2", () => {
    expect(detectMac("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15")).toBe(
      true,
    );
    expect(
      detectMac(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0 Edg/141.0",
      ),
    ).toBe(false);
  });
});

describe("detectPlatform", () => {
  it("tells the three web views apart", () => {
    expect(
      detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15"),
    ).toBe("mac");
    expect(
      detectPlatform(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0 Edg/141.0",
      ),
    ).toBe("windows");
    expect(
      detectPlatform(
        "Mozilla/5.0 (X11; Ubuntu; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
      ),
    ).toBe("linux");
  });

  it("is not a Mac on Linux", () => {
    expect(detectMac("Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/605.1.15")).toBe(false);
  });
});

describe("the system's words", () => {
  it("names each system and its file manager", () => {
    expect(systemName("mac")).toBe("macOS");
    expect(systemName("windows")).toBe("Windows");
    expect(systemName("linux")).toBe("your desktop");
    expect(revealLabel("mac")).toBe("Show in Finder");
    expect(revealLabel("windows")).toBe("Show in File Explorer");
    expect(revealLabel("linux")).toBe("Show in Folder");
  });
});

describe("primaryKey", () => {
  it("is ⌘ on the Mac and Ctrl elsewhere", () => {
    expect(primaryKey({ metaKey: true, ctrlKey: false }, true)).toBe(true);
    expect(primaryKey({ metaKey: false, ctrlKey: true }, true)).toBe(false);
    expect(primaryKey({ metaKey: false, ctrlKey: true }, false)).toBe(true);
    expect(primaryKey({ metaKey: true, ctrlKey: false }, false)).toBe(false);
  });
});

describe("accelLabel", () => {
  it("uses the Mac's symbols there", () => {
    expect(accelLabel("Shift+Cmd+R", true)).toBe("⇧⌘R");
    expect(accelLabel("Ctrl+Cmd+S", true)).toBe("⌃⌘S");
    expect(accelLabel("Cmd+Enter", true)).toBe("⌘↩");
    expect(accelLabel("Cmd+,", true)).toBe("⌘,");
  });

  it("spells shortcuts out on Windows, Ctrl for ⌘ and Alt for ⌃", () => {
    expect(accelLabel("Shift+Cmd+R", false)).toBe("Ctrl+Shift+R");
    expect(accelLabel("Ctrl+Cmd+S", false)).toBe("Ctrl+Alt+S");
    expect(accelLabel("Alt+Cmd+U", false)).toBe("Ctrl+Alt+U");
    expect(accelLabel("Cmd+Enter", false)).toBe("Ctrl+Enter");
    expect(accelLabel("Cmd+1", false)).toBe("Ctrl+1");
  });
});

describe("accelMatches", () => {
  it("needs exactly the shortcut's modifiers, by physical key", () => {
    expect(
      accelMatches(press("KeyR", { metaKey: true, shiftKey: true }), "Shift+Cmd+R", true),
    ).toBe(true);
    expect(accelMatches(press("KeyR", { metaKey: true }), "Shift+Cmd+R", true)).toBe(false);
    expect(accelMatches(press("Digit3", { metaKey: true }), "Cmd+3", true)).toBe(true);
  });

  it("takes Ctrl for ⌘ and Ctrl+Alt for ⌃⌘ on Windows", () => {
    expect(accelMatches(press("KeyR", { ctrlKey: true }), "Cmd+R", false)).toBe(true);
    expect(accelMatches(press("KeyR", { metaKey: true }), "Cmd+R", false)).toBe(false);
    expect(accelMatches(press("KeyA", { ctrlKey: true, altKey: true }), "Ctrl+Cmd+A", false)).toBe(
      true,
    );
    expect(accelMatches(press("KeyA", { ctrlKey: true }), "Ctrl+Cmd+A", false)).toBe(false);
  });

  it("matches other keys by name", () => {
    expect(accelMatches({ ...press("Comma", { ctrlKey: true }), key: "," }, "Cmd+,", false)).toBe(
      true,
    );
  });
});
