// Fails when the repository (or the commits not yet pushed) holds what looks
// like real mail: an address at a real domain, a real-looking phone number, a
// measurement taken on a real mailbox, or a term from the local denylist.
// AGENTS.md → "Real mail never goes in the repository". Run by `bun run check`
// and in CI. It is a safety net, not clearance: it cannot know a person's name
// or a company, so the written rule and a careful reread still come first.
//
// Local denylist (never committed): one term per line in
// `~/.config/<short name>/privacy-denylist` (the short name is in brand.json),
// or the file named by <ENV PREFIX>_PRIVACY_DENYLIST. Put in it the real names,
// companies and domains you have seen in your own mail.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import brand from "../brand.json";
import { findIssues, findPassageIssues, parseDenylist } from "./privacy";

/** Not text, generated, or the detector's own test inputs. */
const SKIP =
  /(^|\/)(bun\.lock|Cargo\.lock|LICENSE)$|\.(png|jpe?g|gif|icns|ico|car|pdf|woff2?|webp)$|^docs\/images\/|^scripts\/privacy\.test\.ts$/i;

/** A git command; a failure is an error, never an empty answer. */
function git(...args: string[]): string {
  const r = Bun.spawnSync(["git", ...args], { stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) {
    throw new Error(`check:privacy: git ${args.join(" ")} failed: ${r.stderr.toString().trim()}`);
  }
  return r.stdout.toString();
}
const gitOk = (...args: string[]) =>
  Bun.spawnSync(["git", ...args], { stdout: "pipe", stderr: "pipe" }).exitCode === 0;

const denyPath =
  process.env[`${brand.envPrefix}_PRIVACY_DENYLIST`] ??
  `${homedir()}/.config/${brand.shortName}/privacy-denylist`;
const denylist = existsSync(denyPath) ? parseDenylist(readFileSync(denyPath, "utf8")) : [];

// The project's own contact domain (the web address of the brand).
const projectDomains = [`get${brand.shortName}.app`];

let problems = 0;
const report = (where: string, kind: string, text: string) => {
  problems++;
  console.error(`check:privacy: ${where}: ${kind}: ${text}`);
};

const files = git("ls-files", "-z").split("\0").filter(Boolean);
for (const file of files) {
  if (SKIP.test(file)) continue;
  let content: string;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    continue; // deleted in the working tree, or not text
  }
  const lines = content.split("\n");
  lines.forEach((line, i) => {
    for (const f of findIssues(line, denylist, projectDomains)) {
      report(`${file}:${i + 1}`, f.kind, f.text);
    }
  });
  // Prose wraps: look at three lines at a time for counts of real mail.
  if (/\.(md|txt)$/i.test(file)) {
    let lastAt = -9;
    let lastText = "";
    for (let i = 0; i < lines.length; i++) {
      const found = findPassageIssues(lines.slice(i, i + 3).join(" "));
      for (const f of found) {
        if (f.text === lastText && i - lastAt < 3) continue;
        lastAt = i;
        lastText = f.text;
        report(`${file}:${i + 1}`, f.kind, f.text);
      }
    }
  }
}

// The messages of the commits this branch adds: against the upstream, else
// against origin/main or main when on another branch (CHECK_PRIVACY_BASE
// overrides). On main with nothing to compare, the history is left to review.
const branch = git("rev-parse", "--abbrev-ref", "HEAD").trim();
const base =
  process.env.CHECK_PRIVACY_BASE?.replace(/^0+$/, "") ||
  (gitOk("rev-parse", "--verify", "-q", "@{upstream}")
    ? "@{upstream}"
    : gitOk("rev-parse", "--verify", "-q", "origin/main")
      ? "origin/main"
      : branch !== "main" && gitOk("rev-parse", "--verify", "-q", "main")
        ? "main"
        : null);
if (base) {
  const messages = git("log", `${base}..HEAD`, "--format=%h%x00%B%x01");
  for (const block of messages.split("\x01")) {
    const [hash, body] = block.split("\0");
    if (!hash || !body) continue;
    body
      .replace(/^Co-Authored-By:.*$/gim, "")
      .split("\n")
      .forEach((line) => {
        for (const f of findIssues(line, denylist, projectDomains)) {
          report(`commit ${hash.trim()}`, f.kind, f.text);
        }
      });
  }
}

if (problems > 0) {
  console.error(
    `check:privacy: ${problems} problem(s). Real mail must not be written into the repository: describe the behaviour in general terms, with made-up data.`,
  );
  process.exit(1);
}
console.log(
  `check:privacy: no real mail details found${denylist.length ? ` (with ${denylist.length} denylisted terms)` : ""}${base ? `, commits since ${base} included` : ""}`,
);
