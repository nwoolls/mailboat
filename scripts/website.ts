// Checks for the website in website/ (run by `bun run check:website`, part of
// every check). Pure functions: scripts/check-website.ts reads the files and
// passes them in, so the rules are tested in scripts/website.test.ts.
//
// What they guard: a link or picture that points at a file that isn't there,
// anything the site's Content Security Policy would block (inline scripts,
// inline styles, files from other servers), a policy loosened past the site's
// own files, and the basics a page needs (language, title, description, image
// sizes and descriptions).
import { posix } from "node:path";

/** The pages, by path inside website/ (`index.html`), with their text. */
export type Pages = Record<string, string>;

/** The style sheets, by path inside website/ (`site.css`), with their text. */
export type Sheets = Record<string, string>;

/**
 * Pages that are served at any address (the 404 page), not at their own. A
 * relative link in one would resolve against whatever address was asked for,
 * so every file it names must start with a slash.
 */
const SERVED_ANYWHERE = new Set(["404.html"]);

const EXTERNAL = /^(https?:)?\/\//i;
const OTHER_SCHEME = /^(mailto|tel):/i;

/** What a `<link rel>` fetches when the page loads; the other kinds (canonical, alternate…) are only metadata. */
const FETCHED_LINK_RELS = new Set([
  "stylesheet",
  "icon",
  "shortcut",
  "apple-touch-icon",
  "mask-icon",
  "manifest",
  "preload",
  "modulepreload",
  "prefetch",
  "preconnect",
  "dns-prefetch",
]);

/** An attribute list's names and values: double-quoted, single-quoted or bare. */
function attrs(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of text.matchAll(
    /([a-zA-Z][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g,
  )) {
    out.set(m[1].toLowerCase(), m[2] ?? m[3] ?? m[4] ?? "");
  }
  return out;
}

function ids(html: string): Set<string> {
  const found = new Set<string>();
  for (const m of html.matchAll(/\sid\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    found.add(m[1] ?? m[2] ?? m[3]);
  }
  return found;
}

/** Whether this HTML has a link whose text is "Security" (tags inside it ignored) and that has an address. */
function hasSecurityLink(html: string): boolean {
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const text = m[2]
      .replace(/<[^>]*>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const href = attrs(m[1]).get("href")?.trim() ?? "";
    if (text === "Security" && href !== "" && href !== "#") return true;
  }
  return false;
}

/** Where a link in `from` leads: the file's path and the #fragment, if any. */
function resolve(from: string, href: string): { path: string; fragment: string } {
  const [target, fragment = ""] = href.split("#");
  const [file] = target.split("?");
  if (file === "") return { path: from, fragment }; // "#features": this page
  // "/site.css" is the site's root; anything else starts from the page's folder.
  let path = file.startsWith("/")
    ? posix.normalize(file.replace(/^\/+/, ""))
    : posix.normalize(posix.join(posix.dirname(from), file));
  // A folder ("./", "/") is its index page.
  if (path === "." || path.endsWith("/")) path = posix.join(path === "." ? "" : path, "index.html");
  return { path, fragment };
}

/** A Content Security Policy source list may name only the site itself (or nothing, or a quoted keyword). */
function policyProblems(headers: string): string[] {
  const problems: string[] = [];
  const line = headers.split("\n").find((l) => /^\s*Content-Security-Policy:/i.test(l));
  if (!line) return ["_headers: no Content-Security-Policy"];
  const policy = line.replace(/^\s*Content-Security-Policy:\s*/i, "");
  // default-src must begin with 'self'; any extra source is reported below.
  if (!/(^|;)\s*default-src\s+'self'(\s|;|$)/.test(policy)) {
    problems.push("_headers: the policy does not start from default-src 'self'");
  }
  for (const directive of policy.split(";")) {
    const [name, ...sources] = directive.trim().split(/\s+/);
    if (!name) continue;
    for (const source of sources) {
      if (/^'unsafe-(inline|eval)'$/.test(source) || /^unsafe-(inline|eval)$/.test(source)) {
        problems.push(`_headers: ${name} allows ${source}`);
      } else if (!/^'[a-z-]+'$/.test(source) && !/^(data|blob):$/.test(source)) {
        problems.push(`_headers: ${name} allows ${source}, which is not the site's own files`);
      }
    }
  }
  return problems;
}

/**
 * Every problem found, as one line each (empty when the site is fine).
 * `exists` says whether a file is in website/; `headers` is the `_headers`
 * file; `sheets` are the style sheets, whose url() and @import files must
 * exist too.
 */
export function checkSite(
  pages: Pages,
  exists: (path: string) => boolean,
  headers: string,
  sheets: Sheets = {},
): string[] {
  const problems: string[] = [];
  const pageIds = new Map(Object.entries(pages).map(([p, html]) => [p, ids(html)]));

  for (const [page, source] of Object.entries(pages)) {
    const say = (what: string) => problems.push(`${page}: ${what}`);
    // A comment is not served as page content. Strip until nothing changes:
    // one pass can leave a new "<!--" behind (<!<!-- x -->-->), which a
    // browser reads differently from this check.
    let html = source;
    for (let before = ""; before !== html;) {
      before = html;
      html = html.replace(/<!--[\s\S]*?-->/g, "");
    }
    if (html.includes("<!--"))
      say("a comment that is never closed, or one written so this check can't read it");

    if (!/<html[^>]*\slang\s*=\s*["']?[^\s"'>]+/i.test(html)) say("<html> has no lang");
    if (!/<title>[^<]+<\/title>/i.test(html)) say("no <title>");
    if (!/<meta\s+name\s*=\s*["']description["']\s+content\s*=\s*["'][^"']+["']/i.test(html)) {
      say("no meta description");
    }
    // Every footer carries the Security link (the address of the security policy).
    if (/class\s*=\s*["'][^"']*\bsite-footer\b/i.test(html)) {
      const footer =
        /<footer\b[^>]*class\s*=\s*["'][^"']*\bsite-footer\b[^>]*>([\s\S]*?)<\/footer>/i.exec(html);
      if (!footer) {
        say("the site-footer class is not on a <footer> element");
      } else if (!hasSecurityLink(footer[1])) {
        say('the footer has no "Security" link with an address');
      }
    }
    if (/<style[\s>]/i.test(html))
      say("an inline <style> block (the Content Security Policy blocks it)");
    if (/<script\b(?![^>]*\ssrc\s*=)[^>]*>/i.test(html)) {
      say("an inline <script> (the Content Security Policy blocks it)");
    }

    for (const tag of html.matchAll(/<([a-zA-Z][\w-]*)\b([^>]*)>/g)) {
      const name = tag[1].toLowerCase();
      const a = attrs(tag[2]);

      if (a.has("style"))
        say(`<${name}> has a style attribute (the Content Security Policy blocks it)`);
      for (const key of a.keys()) {
        if (/^on[a-z]+$/.test(key))
          say(`<${name}> has an ${key} handler (the Content Security Policy blocks it)`);
      }

      // A <base> would change where every relative address leads.
      if (name === "base")
        say("a <base> tag (it changes every relative address; the site uses none)");

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
      if (name === "link" && a.has("href")) {
        const rels = (a.get("rel") ?? "").toLowerCase().split(/\s+/);
        links.push({ value: a.get("href")!, resource: rels.some((r) => FETCHED_LINK_RELS.has(r)) });
      }
      if (["use", "image"].includes(name)) {
        const value = a.get("href") ?? a.get("xlink:href");
        if (value !== undefined) links.push({ value, resource: true });
      }
      if (
        ["img", "script", "source", "video", "audio", "iframe", "frame", "embed"].includes(name) &&
        a.has("src")
      ) {
        links.push({ value: a.get("src")!, resource: true });
      }
      if (name === "object" && a.has("data")) links.push({ value: a.get("data")!, resource: true });
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
        // A page served at any address can't use a relative file name.
        if (SERVED_ANYWHERE.has(page) && !value.startsWith("#") && !value.startsWith("/")) {
          say(
            `<${name}> uses the relative address ${value}; this page is served at any address, so it must start with /`,
          );
        }
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

  for (const [sheet, css] of Object.entries(sheets)) {
    // `@import url(x)` matches both patterns: report each file once.
    const files = new Set([
      ...[...css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)].map((m) => m[1]),
      ...[...css.matchAll(/@import\s+(?:url\(\s*)?["']?([^"')\s;]+)/g)].map((m) => m[1]),
    ]);
    for (const file of files) {
      if (EXTERNAL.test(file)) {
        problems.push(
          `${sheet}: loads ${file} from another server (the Content Security Policy blocks it)`,
        );
      } else if (!file.startsWith("data:") && !exists(resolve(sheet, file).path)) {
        problems.push(`${sheet}: ${file} is not in website/`);
      }
    }
  }

  problems.push(...policyProblems(headers));
  return problems;
}

/** Where a security contact file must be served, as RFC 9116 sets it. */
export const SECURITY_TXT_PATH = ".well-known/security.txt";

const DAY = 24 * 60 * 60 * 1000;

/** How long before its `Expires` date the file may be left (RFC 9116 advises under a year). */
const SECURITY_TXT_MAX_DAYS = 366;

/**
 * An `Expires` value as milliseconds, or undefined unless it is a real RFC 3339
 * date and time (the format RFC 9116 asks for): all the parts, seconds
 * included, a calendar date that exists (no 30 February), and an offset or Z.
 */
function parseExpires(value: string): number | undefined {
  const m =
    /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(\.\d+)?([Zz]|[+-](\d{2}):(\d{2}))$/.exec(
      value,
    );
  if (!m) return undefined;
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  // A day that rolled over into the next month does not exist.
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  if (hour > 23 || minute > 59 || second > 59) return undefined;
  if (m[9] !== undefined && (Number(m[9]) > 23 || Number(m[10]) > 59)) return undefined;
  const time = Date.parse(value.toUpperCase());
  return Number.isNaN(time) ? undefined : time;
}

/**
 * Problems with `/.well-known/security.txt` (RFC 9116), one line each; `text`
 * is undefined when the file is missing. `Expires` must be a real date, still
 * ahead, and no more than a year away, so the file is renewed rather than
 * forgotten. `now` is a parameter so the tests can pin the date.
 */
export function securityTxtProblems(text: string | undefined, now: Date = new Date()): string[] {
  if (text === undefined) return [`${SECURITY_TXT_PATH} is missing`];
  const problems: string[] = [];
  const say = (what: string) => problems.push(`${SECURITY_TXT_PATH}: ${what}`);
  // RFC 9116: every line, the last included, ends in LF or CRLF.
  if (!text.endsWith("\n")) say("the last line has no line ending");
  const fields = new Map<string, string[]>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Za-z-]+):\s*(.+?)\s*$/.exec(line);
    if (m) fields.set(m[1].toLowerCase(), [...(fields.get(m[1].toLowerCase()) ?? []), m[2]]);
  }

  const contacts = fields.get("contact") ?? [];
  if (!contacts.some((c) => /^(mailto:[^\s@]+@[^\s@]+|https:\/\/\S+)$/i.test(c))) {
    say("no Contact that is a mailto: or https:// address");
  }

  const expires = fields.get("expires") ?? [];
  if (expires.length !== 1) {
    say("it needs exactly one Expires");
  } else if (parseExpires(expires[0]) === undefined) {
    say(`Expires ${expires[0]} is not an RFC 3339 date and time (such as 2027-11-01T00:00:00Z)`);
  } else {
    const days = (parseExpires(expires[0])! - now.getTime()) / DAY;
    if (days <= 0) say(`Expires ${expires[0]} has passed: renew the file`);
    else if (days > SECURITY_TXT_MAX_DAYS) say(`Expires ${expires[0]} is more than a year away`);
  }

  if (!(fields.get("policy") ?? []).some((v) => /^https:\/\/\S+$/i.test(v))) {
    say("no Policy that is an https:// address");
  }
  if (
    !(fields.get("canonical") ?? []).some((v) =>
      /^https:\/\/\S+\/\.well-known\/security\.txt$/i.test(v),
    )
  ) {
    say("no Canonical https:// address ending in /.well-known/security.txt");
  }
  return problems;
}

/** Days left before `Expires` (undefined when there is none to read), for a warning ahead of the deadline. */
export function securityTxtDaysLeft(text: string, now: Date = new Date()): number | undefined {
  const m = /^Expires:\s*(\S+)\s*$/im.exec(text);
  const when = m ? parseExpires(m[1]) : undefined;
  return when === undefined ? undefined : Math.floor((when - now.getTime()) / DAY);
}
