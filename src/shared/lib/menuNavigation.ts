/**
 * Which menu item an arrow key moves to, as in macOS menus: with nothing
 * highlighted (`at` is -1), Down picks the first item and Up the last;
 * otherwise they step and wrap around. -1 if there are no items.
 */
export function nextMenuIndex(at: number, count: number, key: "ArrowDown" | "ArrowUp"): number {
  if (count === 0) return -1;
  if (at < 0) return key === "ArrowDown" ? 0 : count - 1;
  const step = key === "ArrowDown" ? 1 : -1;
  return (at + step + count) % count;
}
