// Draws an SVG to a PNG at its own size. usage: bun render.mjs in.svg out.png
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const [input, output] = process.argv.slice(2);
const svg = readFileSync(input, "utf8");
const [, w, h] = svg.match(/width="(\d+)" height="(\d+)"/) ?? [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
await page.setContent(`<style>html,body{margin:0}svg{display:block}</style>${svg}`);
await page.screenshot({ path: output });
await browser.close();
