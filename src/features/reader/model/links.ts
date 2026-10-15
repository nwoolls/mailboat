/** Links from an email that may be opened in the browser. Anything else is ignored. */
export function externalLink(href: string | null | undefined): string | null {
  if (!href) return null;
  try {
    const url = new URL(href);
    return ["http:", "https:", "mailto:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}
