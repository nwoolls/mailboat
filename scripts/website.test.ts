import { describe, expect, it } from "vitest";
import { checkSite, type Pages } from "./website";

const HEAD = `<!doctype html><html lang="en"><head><title>T</title>
<meta name="description" content="D" /><link rel="stylesheet" href="site.css" />
<script src="site.js" defer></script></head>`;

const page = (body: string) => `${HEAD}<body>${body}</body></html>`;
// The same page for a folder or for the 404 page: its files are root-absolute.
const ROOT_HEAD = HEAD.replace('href="site.css"', 'href="/site.css"').replace(
  'src="site.js"',
  'src="/site.js"',
);
const rootPage = (body: string) => `${ROOT_HEAD}<body>${body}</body></html>`;

const FILES = new Set([
  "index.html",
  "privacy.html",
  "site.css",
  "site.js",
  "images/a-dark.webp",
  "images/a-light.webp",
]);
const exists = (p: string) => FILES.has(p);
const CSP = "/*\n  Content-Security-Policy: default-src 'self'; img-src 'self' data:\n";

const good: Pages = {
  "index.html": page(
    `<section id="features"><a href="privacy.html">P</a> <a href="https://example.com/x">E</a>
     <a href="#features">F</a>
     <svg><use href="#i-x" /></svg><svg><symbol id="i-x"></symbol></svg>
     <img src="images/a-light.webp" data-zoom="images/a" width="8" height="4" alt="A" /></section>`,
  ),
  "privacy.html": page(`<a href="./#features">Features</a> <a href="./">Home</a>`),
};

describe("checkSite", () => {
  it("accepts a sound site", () => {
    expect(checkSite(good, exists, CSP)).toEqual([]);
  });

  it("finds a link to a page that is not there", () => {
    const pages = { ...good, "index.html": page(`<a href="nope.html">x</a><i id="features"></i>`) };
    expect(checkSite(pages, exists, CSP)).toEqual([
      expect.stringContaining("nope.html, which is not in website/"),
    ]);
  });

  it("finds a link to a spot that does not exist, on this page and on another", () => {
    const pages = {
      "index.html": page(`<a href="#missing">x</a>`),
      "privacy.html": page(`<a href="./#nowhere">x</a><section id="features"></section>`),
    };
    const out = checkSite(pages, exists, CSP);
    expect(out).toHaveLength(2);
    expect(out[0]).toContain("#missing");
    expect(out[1]).toContain("./#nowhere");
  });

  it("finds a missing picture, srcset file and zoom picture", () => {
    const pages = {
      ...good,
      "index.html": page(
        `<img src="images/b.webp" srcset="images/c.webp 2x" data-zoom="images/z" width="1" height="1" alt="" />`,
      ),
    };
    const out = checkSite(pages, exists, CSP).join("\n");
    expect(out).toContain("images/b.webp");
    expect(out).toContain("images/c.webp");
    expect(out).toContain("images/z-dark.webp is missing");
    expect(out).toContain("images/z-light.webp is missing");
  });

  it("finds what the Content Security Policy would block", () => {
    const pages = {
      ...good,
      "index.html": `${HEAD.replace("</head>", "<style>a{}</style><script>1</script></head>")}<body>
        <p style="color:red" onclick="x()">x</p>
        <img src="https://cdn.example/x.png" width="1" height="1" alt="" />
        <link rel="stylesheet" href="https://fonts.example/css" /></body></html>`,
    };
    const out = checkSite(pages, exists, CSP).join("\n");
    expect(out).toContain("inline <style>");
    expect(out).toContain("inline <script>");
    expect(out).toContain("style attribute");
    expect(out).toContain("onclick handler");
    expect(out).toContain("https://cdn.example/x.png from another server");
    expect(out).toContain("https://fonts.example/css from another server");
  });

  it("allows links to other sites, but not files from them", () => {
    const pages = {
      ...good,
      "index.html": page(
        `<a href="https://example.com">x</a><a href="mailto:a@x.example">m</a><i id="features"></i>`,
      ),
    };
    expect(checkSite(pages, exists, CSP)).toEqual([]);
  });

  it("wants the basics on every page", () => {
    const pages = {
      "index.html": `<html><head></head><body><img src="site.css" /></body></html>`,
    };
    const out = checkSite(pages, exists, CSP).join("\n");
    expect(out).toContain("no lang");
    expect(out).toContain("no <title>");
    expect(out).toContain("no meta description");
    expect(out).toContain("has no alt");
    expect(out).toContain("no width and height");
  });

  it("ignores what is inside a comment", () => {
    const pages = {
      ...good,
      "index.html": good["index.html"] + `<!-- <a href="gone.html">x</a> <p style="a:b"> -->`,
    };
    expect(checkSite(pages, exists, CSP)).toEqual([]);
  });

  it("checks the files and servers a style sheet names", () => {
    const css = `@font-face { src: url("fonts/gone.woff2") } a { background: url(https://cdn.example/x.png) } b { background: url(data:image/png;base64,AA) }`;
    const out = checkSite(good, exists, CSP, { "site.css": css });
    expect(out).toHaveLength(2);
    expect(out[0]).toContain("fonts/gone.woff2 is not in website/");
    expect(out[1]).toContain("https://cdn.example/x.png from another server");
    expect(
      checkSite(good, exists, CSP, { "site.css": `@font-face { src: url("site.js") }` }),
    ).toEqual([]);
    expect(
      checkSite(good, exists, CSP, { "site.css": `@import "https://cdn.example/x.css";` }),
    ).toEqual([expect.stringContaining("https://cdn.example/x.css from another server")]);
    expect(checkSite(good, exists, CSP, { "site.css": `@import url(gone.css);` })).toEqual([
      expect.stringContaining("gone.css is not in website/"),
    ]);
  });

  it("reads single-quoted and unquoted attributes too", () => {
    const bad = (body: string) =>
      checkSite({ ...good, "index.html": page(body + `<i id="features"></i>`) }, exists, CSP);
    expect(bad(`<a href='missing.html'>x</a>`)).toEqual([expect.stringContaining("missing.html")]);
    expect(bad(`<a href=missing.html>x</a>`)).toEqual([expect.stringContaining("missing.html")]);
    expect(bad(`<script src='https://evil.example/x.js'></script>`)).toEqual([
      expect.stringContaining("https://evil.example/x.js from another server"),
    ]);
    expect(bad(`<p style='a:b'>x</p>`)).toEqual([expect.stringContaining("style attribute")]);
    expect(bad(`<a href='privacy.html' id=x>fine</a><a href=#x>fine</a>`)).toEqual([]);
    // an id written with single quotes, bare, or in capitals is still an id
    expect(bad(`<i id='a'></i><i ID=b></i><a href="#a">x</a><a href="#b">y</a>`)).toEqual([]);
  });

  it("treats link tags by what they fetch: a stylesheet is a resource, a canonical address is not", () => {
    const body = (tag: string) =>
      checkSite({ ...good, "index.html": page(tag + `<i id="features"></i>`) }, exists, CSP);
    expect(body(`<link rel="canonical" href="https://example.com/">`)).toEqual([]);
    expect(body(`<link rel="alternate" hreflang="fr" href="https://example.com/fr">`)).toEqual([]);
    expect(body(`<link rel="stylesheet" href="https://cdn.example/x.css">`)).toEqual([
      expect.stringContaining("from another server"),
    ]);
    expect(body(`<link rel="preload" as="font" href="gone.woff2">`)).toEqual([
      expect.stringContaining("gone.woff2"),
    ]);
    expect(body(`<link rel="icon" href="https://cdn.example/i.png">`)).toEqual([
      expect.stringContaining("from another server"),
    ]);
  });

  it("checks SVG use through xlink:href, and image, video, audio, iframe, embed and object", () => {
    const body = (tag: string) =>
      checkSite({ ...good, "index.html": page(tag + `<i id="features"></i>`) }, exists, CSP);
    expect(body(`<svg><use xlink:href="#nowhere" /></svg>`)).toEqual([
      expect.stringContaining("#nowhere"),
    ]);
    expect(body(`<svg><use xlink:href="https://cdn.example/s.svg#a" /></svg>`)).toEqual([
      expect.stringContaining("from another server"),
    ]);
    for (const tag of [
      `<svg><image href="gone.png" /></svg>`,
      `<video src="gone.mp4"></video>`,
      `<audio src="gone.mp3"></audio>`,
      `<iframe src="gone.html"></iframe>`,
      `<embed src="gone.swf">`,
      `<object data="gone.pdf"></object>`,
    ]) {
      expect(body(tag), tag).toEqual([expect.stringContaining("which is not in website/")]);
    }
    expect(body(`<iframe src="https://evil.example/x"></iframe>`)).toEqual([
      expect.stringContaining("from another server"),
    ]);
    expect(body(`<picture><source srcset="gone.webp 1x"></picture>`)).toEqual([
      expect.stringContaining("gone.webp"),
    ]);
  });

  it("refuses a base tag", () => {
    const out = checkSite(
      { ...good, "index.html": page(`<base href="https://evil.example/"><i id="features"></i>`) },
      exists,
      CSP,
    );
    expect(out).toEqual([expect.stringContaining("<base>")]);
  });

  it("resolves a root-absolute address from the site's root, even from a folder", () => {
    const files = new Set([...FILES, "blog/index.html", "blog/post.html"]);
    const has = (p: string) => files.has(p);
    const pages = {
      ...good,
      "blog/index.html": rootPage(
        `<a href="/site.css">a</a><a href="/privacy.html">b</a><a href="/">c</a><a href="post.html">d</a><a href="/blog/">e</a>`,
      ),
    };
    expect(checkSite(pages, has, CSP)).toEqual([]);
    const missing = { ...pages, "blog/index.html": rootPage(`<a href="/gone.css">a</a>`) };
    expect(checkSite(missing, has, CSP)).toEqual([
      expect.stringContaining("/gone.css, which is not in website/"),
    ]);
  });

  it("requires a page served at any address (404.html) to use root-absolute file addresses", () => {
    const four = (body: string) => checkSite({ ...good, "404.html": rootPage(body) }, exists, CSP);
    expect(
      four(
        `<a href="/privacy.html">a</a><a href="/">b</a><a href="#main">c</a><a href="https://example.com">d</a>`,
      ),
    ).toEqual([
      expect.stringContaining("#main"), // no such id on this page
    ]);
    expect(four(`<a href="/privacy.html">a</a><a href="/#features">b</a>`)).toEqual([]);
    expect(four(`<a href="privacy.html">a</a>`)).toEqual([
      expect.stringContaining("must start with /"),
    ]);
    expect(four(`<link rel="stylesheet" href="site.css">`)).toEqual([
      expect.stringContaining("must start with /"),
    ]);
    // an ordinary page may use relative addresses
    expect(checkSite(good, exists, CSP)).toEqual([]);
  });

  it("checks the headers file", () => {
    const csp = (policy: string) => `/*\n  Content-Security-Policy: ${policy}\n`;
    expect(checkSite(good, exists, "")).toContain("_headers: no Content-Security-Policy");
    expect(checkSite(good, exists, csp("script-src 'self'"))).toEqual([
      expect.stringContaining("default-src 'self'"),
    ]);
    expect(checkSite(good, exists, csp("default-src 'self'; style-src 'unsafe-inline'"))).toEqual([
      expect.stringContaining("style-src allows 'unsafe-inline'"),
    ]);
    expect(
      checkSite(good, exists, csp("default-src 'self'; script-src 'self' 'unsafe-eval'")),
    ).toEqual([expect.stringContaining("script-src allows 'unsafe-eval'")]);
    // a policy widened past the site's own files
    expect(checkSite(good, exists, csp("default-src 'self' https://evil.example"))).toEqual([
      expect.stringContaining("allows https://evil.example"),
    ]);
    expect(
      checkSite(good, exists, csp("default-src 'self'; script-src https://evil.example")),
    ).toEqual([expect.stringContaining("script-src allows https://evil.example")]);
    expect(checkSite(good, exists, csp("default-src 'self'; img-src *"))).toEqual([
      expect.stringContaining("img-src allows *"),
    ]);
    // the site's real shape is fine
    expect(
      checkSite(
        good,
        exists,
        csp(
          "default-src 'self'; img-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        ),
      ),
    ).toEqual([]);
  });
});
