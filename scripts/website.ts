// Checks for the website in website/ (run by `bun run check:website`, part of
// every check). Pure functions: scripts/check-website.ts reads the files and
// passes them in, so the rules are tested in scripts/website.test.ts.
//
// What they guard: a link or picture that points at a file that isn't there,
// anything the site's Content Security Policy would block (inline scripts,
// inline styles, files from other servers), and the basics a page needs
// (language, title, description, image sizes and descriptions).
import { posix } from "node:path";

/** The pages, by path inside website/ (`index.html`), with their text. */
export type Pages = Record<string, string>;

const EXTERNAL = /^(https?:)?\/\//i;
const OTHER_SCHEME = /^(mailto|tel):/i;

function attrs(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of text.matchAll(/([a-zA-Z][\w:-]*)(?:\s*=\s*"([^"]*)")?/g)) {
    out.set(m[1].toLowerCase(), m[2] ?? "");
  }
  return out;
}

function ids(html: string): Set<string> {
  return new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
}

/** Where a link in `from` leads: the page's path and the #fragment, if any. */
function resolve(from: string, href: string): { path: string; fragment: string } {
  const [target, fragment = ""] = href.split("#");
  const [file] = target.split("?");
  if (file === "") return { path: from, fragment }; // "#features": this page
  let path = posix.normalize(posix.join(posix.dirname(from), file));
  // A folder ("./") is its index page.
  if (path === "." || path.endsWith("/")) path = posix.join(path === "." ? "" : path, "index.html");
  return { path, fragment };
}

/**
 * Every problem found, as one line each (empty when the site is fine).
 * `exists` says whether a file is in website/; `headers` is the `_headers`
 * file; `css` is site.css, whose url() files must exist too.
 */
export function checkSite(
  pages: Pages,
  exists: (path: string) => boolean,
  headers: string,
  css = "",
): string[] {
  const problems: string[] = [];
  const pageIds = new Map(Object.entries(pages).map(([p, html]) => [p, ids(html)]));

  for (const [page, source] of Object.entries(pages)) {
    const say = (what: string) => problems.push(`${page}: ${what}`);
    // A comment is not served as page content.
    const html = source.replace(/<!--[\s\S]*?-->/g, "");

    if (!/<html[^>]*\slang="[^"]+"/.test(html)) say("<html> has no lang");
    if (!/<title>[^<]+<\/title>/.test(html)) say("no <title>");
    if (!/<meta\s+name="description"\s+content="[^"]+"/.test(html)) say("no meta description");
    if (/<style[\s>]/i.test(html))
      say("an inline <style> block (the Content Security Policy blocks it)");
    if (/<script\b(?![^>]*\ssrc=)[^>]*>/i.test(html))
      say("an inline <script> (the Content Security Policy blocks it)");

    for (const tag of html.matchAll(/<([a-zA-Z][\w-]*)\b([^>]*)>/g)) {
      const name = tag[1].toLowerCase();
      const a = attrs(tag[2]);

      if (a.has("style"))
        say(`<${name}> has a style attribute (the Content Security Policy blocks it)`);
      for (const key of a.keys()) {
        if (/^on[a-z]+$/.test(key))
          say(`<${name}> has an ${key} handler (the Content Security Policy blocks it)`);
      }

      if (name === "img") {
        if (!a.has("alt")) say(`<img src="${a.get("src")}"> has no alt`);
        if (!a.has("width") || !a.has("height"))
          say(`<img src="${a.get("src")}"> has no width and height`);
      }

      if (a.has("data-zoom")) {
        for (const theme of ["dark", "light"]) {
          const file = `${a.get("data-zoom")}-${theme}.webp`;
          if (!exists(file)) say(`data-zoom picture ${file} is missing`);
        }
      }

      // Each place a tag names a file or a spot on a page.
      const links: { value: string; resource: boolean }[] = [];
      if (name === "a" && a.has("href")) links.push({ value: a.get("href")!, resource: false });
      if (["link", "use", "image"].includes(name) && a.has("href"))
        links.push({ value: a.get("href")!, resource: true });
      if (["img", "script", "source", "video", "audio"].includes(name) && a.has("src"))
        links.push({ value: a.get("src")!, resource: true });
      if (["img", "source"].includes(name) && a.has("srcset")) {
        for (const candidate of a.get("srcset")!.split(",")) {
          const url = candidate.trim().split(/\s+/)[0];
          if (url) links.push({ value: url, resource: true });
        }
      }

      for (const { value, resource } of links) {
        if (EXTERNAL.test(value)) {
          if (resource)
            say(
              `<${name}> loads ${value} from another server (the Content Security Policy blocks it)`,
            );
          continue;
        }
        if (OTHER_SCHEME.test(value)) continue;
        const { path, fragment } = resolve(page, value);
        if (value.startsWith("#") || (path === page && value.includes("#"))) {
          if (fragment && !pageIds.get(page)?.has(fragment))
            say(`link ${value} has no matching id on the page`);
          continue;
        }
        if (!exists(path)) {
          say(`<${name}> points at ${value}, which is not in website/`);
        } else if (fragment && pageIds.has(path) && !pageIds.get(path)!.has(fragment)) {
          say(`link ${value} has no matching id in ${path}`);
        }
      }
    }
  }

  for (const m of css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
    if (EXTERNAL.test(m[1])) {
      problems.push(
        `site.css: loads ${m[1]} from another server (the Content Security Policy blocks it)`,
      );
    } else if (!m[1].startsWith("data:") && !exists(resolve("site.css", m[1]).path)) {
      problems.push(`site.css: ${m[1]} is not in website/`);
    }
  }

  if (!/^\s*Content-Security-Policy:/m.test(headers))
    problems.push("_headers: no Content-Security-Policy");
  if (!/default-src 'self'/.test(headers))
    problems.push("_headers: the policy does not start from default-src 'self'");
  if (/unsafe-(inline|eval)/.test(headers))
    problems.push("_headers: the policy allows unsafe-inline or unsafe-eval");

  return problems;
}
