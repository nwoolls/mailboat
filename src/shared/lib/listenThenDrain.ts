/**
 * Listens for an event that says a queue in Rust has something, then
 * empties the queue once, so a request queued between the two isn't left
 * waiting for the next one. The returned function stops it: after that,
 * neither the listener nor the first emptying takes anything, even when the
 * listener's registration only finishes later. A take already under way
 * when it stops still finishes.
 */
export function listenThenDrain(
  listen: (handler: () => void) => Promise<() => void>,
  drain: () => void,
): () => void {
  let stopped = false;
  let unlisten: (() => void) | undefined;
  const take = () => {
    if (!stopped) drain();
  };
  void listen(take).then((fn) => {
    if (stopped) return fn();
    unlisten = fn;
    take();
  });
  return () => {
    stopped = true;
    unlisten?.();
  };
}
