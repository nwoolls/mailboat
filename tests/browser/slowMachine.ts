/**
 * A slow machine on purpose, to check that a browser test doesn't depend on
 * how fast the computer runs it. With `bun run test:browser:slow`, the harness page keeps its main thread busy most of
 * the time, as on a loaded CI runner: frames come late and far apart, and a
 * click waits for the work in front of it. A test that passes here and
 * normally doesn't race the clock.
 *
 * The busy work is counted in loop turns, not timed: a test may fake the
 * page's clocks (`page.clock`), and the hog has to keep going under them.
 * `VITE_SLOW_MACHINE` is the turns per slice; the script's 12 million take
 * about 80 ms on an Apple-silicon laptop (2026-11-16), about 12 frames a
 * second, and slices queue
 * back to back through a `MessageChannel`, which no fake clock touches,
 * so frames, timers and input get through only between them.
 */
const turns = Number(import.meta.env.VITE_SLOW_MACHINE ?? 0);

if (turns > 0) {
  const channel = new MessageChannel();
  let sink = 0;
  channel.port1.addEventListener("message", () => {
    for (let i = 0; i < turns; i++) sink = (sink + Math.sqrt(i)) % 1e9;
    (globalThis as { __slowSink?: number }).__slowSink = sink;
    channel.port2.postMessage(null);
  });
  channel.port1.start();
  channel.port2.postMessage(null);
}
