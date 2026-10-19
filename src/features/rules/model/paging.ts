/** Rules shown per page in Settings → Rules, per account. */
export const RULES_PER_PAGE = 10;

/**
 * One page of a list. A page past the end (the list shrank: a search, a
 * deletion) shows the last page instead. `from` and `to` count from 1,
 * for "11–20 of N".
 */
export function pageOf<T>(items: readonly T[], page: number, size = RULES_PER_PAGE) {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const at = Math.min(Math.max(0, page), pages - 1);
  const shown = items.slice(at * size, at * size + size);
  return {
    items: shown,
    page: at,
    pages,
    from: shown.length ? at * size + 1 : 0,
    to: at * size + shown.length,
    total: items.length,
  };
}
