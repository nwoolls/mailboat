/** What a right-click inside an email landed on. */
export type EmailMenuTarget = {
  /** The image's address as the email shows it (`data:` or web). */
  image: string | null;
  /** The link's `email-link:` address (Rust opens or copies the real one). */
  link: string | null;
};

/** Images whose address the app can save or copy. */
const SAVABLE = /^(data:image\/|https?:)/i;

/**
 * The image and link at (or around) the element under the pointer: an
 * image inside a link gives both. Nothing for images that aren't really
 * shown (blocked ones carry no address) or links that go nowhere.
 */
export function emailMenuTarget(el: Element | null): EmailMenuTarget {
  const img = el?.closest("img");
  const src = img?.getAttribute("src") ?? "";
  const a = el?.closest("a[href]");
  const href = a?.getAttribute("href") ?? "";
  return {
    image: SAVABLE.test(src) ? src : null,
    link: /^(email-link:|http:\/\/email-link\.localhost\/)/i.test(href) ? href : null,
  };
}

/** The menu's items, image ones first, in Safari's order. */
export function emailMenuItems(
  t: EmailMenuTarget,
): ("saveImage" | "copyImage" | "openLink" | "copyLink")[] {
  return [
    ...(t.image ? (["saveImage", "copyImage"] as const) : []),
    ...(t.link ? (["openLink", "copyLink"] as const) : []),
  ];
}
