import { describe, expect, it } from "vitest";
import { keychainName, problemWords, resetWords } from "./cache";

describe("the mail cache's words", () => {
  it("names the keychain as each system does", () => {
    expect(keychainName("mac")).toBe("Keychain");
    expect(keychainName("windows")).toBe("Credential Manager");
    expect(keychainName("linux")).toBe("your desktop's keyring");
  });

  it("says what to do when the keychain doesn't answer, and that the mail is safe", () => {
    const words = problemWords("keychain", "windows", "Mailbox");
    expect(words.body).toContain(
      "Unlock Credential Manager or let Mailbox use it, then try again.",
    );
    expect(words.body).toContain("Your mail stays as it is.");
  });

  it("on Linux, asks for a default keyring that's unlocked, as a missing one fails the same way", () => {
    const words = problemWords("keychain", "linux", "Mailbox");
    expect(words.body).toContain(
      "Make sure your desktop has a default keyring and that it's unlocked, then try again.",
    );
    expect(words.body).toContain("Your mail stays as it is.");
  });

  it("asks to quit the other copy when it holds the cache", () => {
    const words = problemWords("inUse", "mac", "Mailbox");
    expect(words.title).toBe("Another copy of Mailbox is open");
    expect(words.body).toContain("Quit it");
  });

  it("explains a reset: what was missing, and what comes back and what doesn't", () => {
    const words = resetWords("mac", "Mailbox");
    expect(words.body).toContain("missing from Keychain or didn't match");
    expect(words.body).toContain("Sign in to your accounts again");
    expect(words.body).toContain("Settings are back to their defaults.");
  });
});
