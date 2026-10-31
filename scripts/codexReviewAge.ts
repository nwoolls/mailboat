/**
 * How many calendar days ago Codex was reviewed, or why the date can't be
 * used. Calendar days, not elapsed hours, so time zones and daylight
 * saving can't move the 31-day limit; `today` is the local date.
 */
export type ReviewAge = { days: number } | { invalid: string };

export function reviewAge(reviewed: string, today: Date): ReviewAge {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(reviewed);
  if (!m) return { invalid: `"${reviewed}" isn't a date (YYYY-MM-DD)` };
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const then = Date.UTC(y, mo - 1, d);
  const back = new Date(then);
  // Date.UTC rolls 2026-02-30 over to March: that's not a real date.
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d)
    return { invalid: `"${reviewed}" isn't a real date` };
  const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const days = Math.round((now - then) / 86_400_000);
  if (days < 0) return { invalid: `"${reviewed}" is in the future` };
  return { days };
}
