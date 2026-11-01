// Fails when the repository (or the commits not yet pushed) holds what looks
// like real mail: an address at a real domain, a real-looking phone number, a
// measurement taken on a real mailbox, or a term from the local denylist.
// AGENTS.md → "Real mail never goes in the repository". Run by `bun run check`.
//
// Local denylist (never committed): one term per line in
// `~/.config/<short name>/privacy-denylist` (the short name is in brand.json),
// or the file named by <ENV PREFIX>_PRIVACY_DENYLIST. Put in it the real names, companies and domains
// you have seen in your own mail, so they can never be written by accident.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import brand from "../brand.json";
import { findIssues, parseDenylist } from "./privacy";

const SKIP =
  /(^|\/)(bun\.lock|Cargo\.lock|LICENSE)$|\.(png|jpe?g|gif|icns|ico|car|pdf|woff2?|webp|svg)$|^docs\/images\/|^crates\/core\/tests\/fixtures\/gmail\/.*\.json$|^scripts\/privacy\.test\.ts$/i;

const run = (args: string[]) =>
  Bun.spawnSync(args, { stdout: "pipe", stderr: "pipe" }).stdout.toString();

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

const files = run(["git", "ls-files", "-z"]).split("\0").filter(Boolean);
for (const file of files) {
  if (SKIP.test(file)) continue;
  let content: string;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  content.split("\n").forEach((line, i) => {
    for (const f of findIssues(line, denylist, projectDomains))
      report(`${file}:${i + 1}`, f.kind, f.text);
  });
}

// The messages of commits not yet pushed. With no upstream (before the first
// push) the whole history is "unpushed", so the messages are left to the
// reviewed history and only commits made after the first push are checked.
const hasUpstream =
  Bun.spawnSync(["git", "rev-parse", "@{upstream}"], { stdout: "pipe", stderr: "pipe" })
    .exitCode === 0;
if (hasUpstream) {
  const messages = run(["git", "log", "@{upstream}..HEAD", "--format=%h%x00%B%x01"]);
  for (const block of messages.split("\x01")) {
    const [hash, body] = block.split("\0");
    if (!hash || !body) continue;
    for (const f of findIssues(
      body.replace(/Co-Authored-By:.*$/gim, ""),
      denylist,
      projectDomains,
    )) {
      report(`commit ${hash.trim()}`, f.kind, f.text);
    }
  }
}

if (problems > 0) {
  console.error(
    `check:privacy: ${problems} problem(s). Real mail must not be written into the repository: describe the behaviour in general terms, with made-up data.`,
  );
  process.exit(1);
}
console.log(
  `check:privacy: no real mail details found${denylist.length ? ` (with ${denylist.length} denylisted terms)` : ""}`,
);
