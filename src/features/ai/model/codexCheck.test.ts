import { describe, expect, it } from "vitest";
import { codexNotice } from "./codexCheck";

const ok = { unreviewed: [], accepted: false, failed: false };

describe("codexNotice", () => {
  it("says nothing when all is as reviewed, or ChatGPT isn't connected", () => {
    expect(codexNotice(ok, true)).toBeNull();
    expect(codexNotice(undefined, true)).toBeNull();
    expect(codexNotice({ ...ok, failed: true }, false)).toBeNull();
  });

  it("pauses on unreviewed switches, offering Use anyway", () => {
    const n = codexNotice({ ...ok, unreviewed: ["brand_new_tool"] }, true);
    expect(n?.title).toBe("ChatGPT is paused");
    expect(n?.switches).toEqual(["brand_new_tool"]);
    expect(n?.canUseAnyway).toBe(true);
  });

  it("says when it's being used anyway, without offering it again", () => {
    const n = codexNotice({ unreviewed: ["brand_new_tool"], accepted: true, failed: false }, true);
    expect(n?.title).toBe("Using ChatGPT anyway");
    expect(n?.canUseAnyway).toBe(false);
  });

  it("pauses when Codex can't be checked, with no way around it", () => {
    const n = codexNotice({ ...ok, failed: true }, true);
    expect(n?.title).toBe("ChatGPT is paused");
    expect(n?.canUseAnyway).toBe(false);
  });
});
