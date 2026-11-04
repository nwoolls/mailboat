// Draws an SVG to a PNG at its own size. usage: bun render.mjs in.svg out.png
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error("usage: bun render.mjs in.svg out.png");
  process.exit(1);
}
const svg = readFileSync(input, "utf8");
const size = svg.match(/width="(\d+)" height="(\d+)"/);
if (!size) {
  console.error(`${input}: the svg needs width="…" and height="…" in pixels`);
  process.exit(1);
}
const [, w, h] = size;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
await page.setContent(`<style>html,body{margin:0}svg{display:block}</style>${svg}`);
await page.screenshot({ path: output });
await browser.close();
