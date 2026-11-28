import { describe, expect, it, vi } from "vitest";
import { listenThenDrain } from "./listenThenDrain";

/** A listener whose registration finishes only when `register` is called. */
function delayedListen() {
  let handler: (() => void) | undefined;
  let finish: (() => void) | undefined;
  const unlisten = vi.fn(() => {
    handler = undefined;
  });
  const listen = (h: () => void) => {
    handler = h;
    return new Promise<() => void>((resolve) => {
      finish = () => resolve(unlisten);
    });
  };
  return {
    listen,
    unlisten,
    fire: () => handler?.(),
    register: async () => {
      finish?.();
      await Promise.resolve();
    },
  };
}

describe("listenThenDrain", () => {
  it("empties the queue only once the listener is registered", async () => {
    const l = delayedListen();
    const drain = vi.fn();
    listenThenDrain(l.listen, drain);
    expect(drain).not.toHaveBeenCalled();
    await l.register();
    expect(drain).toHaveBeenCalledTimes(1);
    l.fire();
    expect(drain).toHaveBeenCalledTimes(2);
  });

  it("takes nothing once stopped, even from an event before registration finishes", async () => {
    const l = delayedListen();
    const drain = vi.fn();
    const stop = listenThenDrain(l.listen, drain);
    stop();
    l.fire();
    await l.register();
    expect(drain).not.toHaveBeenCalled();
    expect(l.unlisten).toHaveBeenCalledTimes(1);
  });

  it("leaves a request for the next listener after a remount", async () => {
    const queue = ["archive"];
    const first: string[] = [];
    const second: string[] = [];
    const l1 = delayedListen();
    const stop1 = listenThenDrain(l1.listen, () => {
      const v = queue.shift();
      if (v) first.push(v);
    });
    stop1();
    const l2 = delayedListen();
    listenThenDrain(l2.listen, () => {
      const v = queue.shift();
      if (v) second.push(v);
    });
    // The old listener hears an event before its registration resolves.
    l1.fire();
    await l1.register();
    await l2.register();
    expect(first).toEqual([]);
    expect(second).toEqual(["archive"]);
  });

  it("stops listening when stopped after registration", async () => {
    const l = delayedListen();
    const drain = vi.fn();
    const stop = listenThenDrain(l.listen, drain);
    await l.register();
    stop();
    expect(l.unlisten).toHaveBeenCalledTimes(1);
    l.fire();
    expect(drain).toHaveBeenCalledTimes(1);
  });
});
