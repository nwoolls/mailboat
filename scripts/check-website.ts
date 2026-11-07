// Checks the website in website/: every link, picture and file a page or
// style sheet names exists, nothing the Content Security Policy in
// website/_headers would block (inline scripts and styles, event-handler
// attributes, files from other servers), a policy no wider than the site's
// own files, and the basics each page needs. Every .html and .css file under
// website/ is read, folders included. The rules are in scripts/website.ts,
// where scripts/website.test.ts tests them. Run by `bun run check:web`.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { checkSite, type Pages, type Sheets } from "./website";

const root = new URL("../website/", import.meta.url).pathname;
const read = (name: string) =>
  existsSync(`${root}${name}`) ? readFileSync(`${root}${name}`, "utf8") : "";

const pages: Pages = {};
const sheets: Sheets = {};
for (const name of readdirSync(root, { recursive: true }) as string[]) {
  if (name.endsWith(".html")) pages[name] = read(name);
  else if (name.endsWith(".css")) sheets[name] = read(name);
}
if (!pages["index.html"]) {
  console.error("check:website: website/index.html is missing");
  process.exit(1);
}

const problems = checkSite(pages, (path) => existsSync(`${root}${path}`), read("_headers"), sheets);

if (problems.length) {
  console.error(`check:website: ${problems.length} problem(s) in website/:`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(
  `check:website: ${Object.keys(pages).length} pages and ${Object.keys(sheets).length} style sheet(s) are sound`,
);
