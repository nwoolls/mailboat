// Checks the website in website/: every link, picture and file a page or
// site.css names exists, nothing the Content Security Policy in
// website/_headers would block (inline scripts and styles, event-handler
// attributes, files from other servers), and the basics each page needs.
// The rules are in scripts/website.ts, where scripts/website.test.ts tests
// them. Run by `bun run check:web`.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { checkSite, type Pages } from "./website";

const root = new URL("../website/", import.meta.url).pathname;
const read = (name: string) =>
  existsSync(`${root}${name}`) ? readFileSync(`${root}${name}`, "utf8") : "";

const pages: Pages = {};
for (const name of readdirSync(root)) {
  if (name.endsWith(".html")) pages[name] = read(name);
}
if (!pages["index.html"]) {
  console.error("check:website: website/index.html is missing");
  process.exit(1);
}

const problems = checkSite(
  pages,
  (path) => existsSync(`${root}${path}`),
  read("_headers"),
  read("site.css"),
);

if (problems.length) {
  console.error(`check:website: ${problems.length} problem(s) in website/:`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`check:website: ${Object.keys(pages).length} pages are sound`);
