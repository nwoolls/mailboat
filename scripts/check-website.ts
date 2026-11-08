// Checks the website in website/: every link, picture and file a page or
// style sheet names exists, nothing the Content Security Policy in
// website/_headers would block (inline scripts and styles, event-handler
// attributes, files from other servers), a policy no wider than the site's
// own files, and the basics each page needs. Every .html and .css file under
// website/ is read, folders included. The rules are in scripts/website.ts,
// where scripts/website.test.ts tests them (the security contact file,
// .well-known/security.txt, included). Run by `bun run check:web`.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import {
  checkSite,
  SECURITY_TXT_PATH,
  securityTxtDaysLeft,
  securityTxtProblems,
  type Pages,
  type Sheets,
} from "./website";

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

const securityTxt = existsSync(`${root}${SECURITY_TXT_PATH}`)
  ? readFileSync(`${root}${SECURITY_TXT_PATH}`, "utf8")
  : undefined;

const problems = [
  ...checkSite(pages, (path) => existsSync(`${root}${path}`), read("_headers"), sheets),
  ...securityTxtProblems(securityTxt),
];

if (problems.length) {
  console.error(`check:website: ${problems.length} problem(s) in website/:`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
const daysLeft = securityTxt === undefined ? undefined : securityTxtDaysLeft(securityTxt);
if (daysLeft !== undefined && daysLeft < 60) {
  console.warn(
    `check:website: ${SECURITY_TXT_PATH} expires in ${daysLeft} day(s): renew its Expires date (the check fails once it has passed)`,
  );
}
console.log(
  `check:website: ${Object.keys(pages).length} pages and ${Object.keys(sheets).length} style sheet(s) are sound`,
);
