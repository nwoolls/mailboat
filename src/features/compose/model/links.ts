/** "docs.example.com" becomes "https://docs.example.com"; mailto: and others stay. */
export function linkHref(typed: string): string {
  const href = typed.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return href;
  if (/^[^\s@/]+@[^\s@]+\.[^\s@]+$/.test(href)) return `mailto:${href}`;
  return `https://${href}`;
}
