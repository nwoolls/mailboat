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
import {
  findDenylistInPassage,
  findIssues,
  findPassageIssues,
  joinLines,
  parseDenylist,
} from "./privacy";

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
  } catch (e) {
    // Deleted in the working tree (not committed yet) is fine; anything else is not.
    if ((e as NodeJS.ErrnoException).code === "ENOENT") continue;
    throw e;
  }
  const lines = content.split("\n");
  lines.forEach((line, i) => {
    for (const f of findIssues(line, denylist, projectDomains)) {
      report(`${file}:${i + 1}`, f.kind, f.text);
    }
  });
  // Text wraps: look at three lines at a time, for counts of real mail (prose
  // only) and for terms or names split across a line break.
  const prose = /\.(md|txt)$/i.test(file);
  const seen = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const window = lines.slice(i, i + 3);
    const passage = joinLines(window);
    const found = [
      ...(prose ? findPassageIssues(passage) : []),
      ...findDenylistInPassage(passage, denylist),
    ];
    for (const f of found) {
      const key = `${f.kind}:${f.text}:${Math.floor(i / 2)}`;
      if (seen.has(key) || seen.has(`${f.kind}:${f.text}:${Math.floor(i / 2) - 1}`)) continue;
      // Already reported from a single line?
      if (
        window.some((l) => findIssues(l, denylist, projectDomains).some((g) => g.kind === f.kind))
      )
        continue;
      seen.add(key);
      report(`${file}:${i + 1}`, f.kind, f.text);
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
if (!base && process.env.CI && branch !== "main") {
  throw new Error(
    "check:privacy: in CI the commits to compare against could not be found (fetch the full history)",
  );
}
if (base) {
  const messages = git("log", `${base}..HEAD`, "--format=%h%x00%B%x01");
  for (const block of messages.split("\x01")) {
    const [hash, body] = block.split("\0");
    if (!hash || !body) continue;
    const msgLines = body.split("\n");
    msgLines.forEach((line) => {
      for (const f of findIssues(line, denylist, projectDomains)) {
        report(`commit ${hash.trim()}`, f.kind, f.text);
      }
    });
    for (let i = 0; i < msgLines.length; i++) {
      const passage = joinLines(msgLines.slice(i, i + 3));
      for (const f of [
        ...findPassageIssues(passage),
        ...findDenylistInPassage(passage, denylist),
      ]) {
        if (
          msgLines
            .slice(i, i + 3)
            .some((l) => findIssues(l, denylist, projectDomains).some((g) => g.kind === f.kind))
        )
          continue;
        report(`commit ${hash.trim()}`, f.kind, f.text);
      }
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
  `check:privacy: no real mail details found${denylist.length ? ` (with ${denylist.length} denylisted terms)` : ""}${base ? `, commits since ${base} included` : ""}`,
);
