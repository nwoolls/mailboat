import { describe, expect, it } from "vitest";
import { checkSite, type Pages } from "./website";

const HEAD = `<!doctype html><html lang="en"><head><title>T</title>
<meta name="description" content="D" /><link rel="stylesheet" href="site.css" />
<script src="site.js" defer></script></head>`;

const page = (body: string) => `${HEAD}<body>${body}</body></html>`;

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

  it("checks the files and servers site.css names", () => {
    const css = `@font-face { src: url("fonts/gone.woff2") } a { background: url(https://cdn.example/x.png) } b { background: url(data:image/png;base64,AA) }`;
    const out = checkSite(good, exists, CSP, css);
    expect(out).toHaveLength(2);
    expect(out[0]).toContain("fonts/gone.woff2 is not in website/");
    expect(out[1]).toContain("https://cdn.example/x.png from another server");
    expect(checkSite(good, exists, CSP, `@font-face { src: url("site.js") }`)).toEqual([]);
  });

  it("checks the headers file", () => {
    expect(checkSite(good, exists, "")).toContain("_headers: no Content-Security-Policy");
    expect(checkSite(good, exists, "/*\n  Content-Security-Policy: script-src 'self'\n")).toEqual([
      expect.stringContaining("default-src 'self'"),
    ]);
    expect(
      checkSite(
        good,
        exists,
        "/*\n  Content-Security-Policy: default-src 'self'; style-src 'unsafe-inline'\n",
      ),
    ).toEqual([expect.stringContaining("unsafe-inline")]);
  });
});
