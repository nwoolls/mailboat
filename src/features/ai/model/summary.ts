/**
 * A summary's points: lines starting with "- ", "• " or "* " (as the
 * prompt asks), or the whole text as one point if the model wrote prose.
 */
export function summaryPoints(text: string): string[] {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const marked = lines.filter((l) => /^([-•*]|\d+\.)\s+/.test(l));
  if (marked.length === 0) return lines.length > 0 ? [lines.join(" ")] : [];
  return marked.map((l) => l.replace(/^([-•*]|\d+\.)\s+/, "").replace(/\*\*/g, ""));
}

/**
 * The points of a summary still being written: as `summaryPoints`, less any
 * point with no words yet (a bullet's "-" before its first word arrives).
 */
export function pointsSoFar(text: string): string[] {
  return summaryPoints(text).filter((p) => /[\p{L}\p{N}]/u.test(p));
}
