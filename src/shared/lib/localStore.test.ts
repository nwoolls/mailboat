import { describe, expect, it } from "vitest";
import { localStore } from "./localStore";

describe("localStore", () => {
  it("saves, and resets to what an empty store reads as", () => {
    const store = localStore("test.key", (raw) => (raw ? (JSON.parse(raw) as number) : 7));
    store.set(3);
    expect(store.get()).toBe(3);
    expect(localStorage.getItem("test.key")).toBe("3");
    store.reset();
    expect(store.get()).toBe(7);
  });
});
