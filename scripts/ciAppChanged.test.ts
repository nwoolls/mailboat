import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const script = resolve(__dirname, "ci-app-changed.sh");
let dir = "";

const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
const write = (path: string, text = "x\n") => {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), text);
};

/** A pull request: `change` runs on a branch from the base commit. Answers what the script says. */
function answer(change: () => void): string {
  const base = git("rev-parse", "HEAD");
  git("switch", "-q", "-c", `pr-${Math.random().toString(36).slice(2)}`);
  change();
  git("add", "-A");
  git("commit", "-qm", "change");
  const head = git("rev-parse", "HEAD");
  git("switch", "-q", "main");
  return execFileSync(script, [base, head], { cwd: dir, encoding: "utf8" }).trim();
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "ci-changed-"));
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@x.example");
  git("config", "user.name", "t");
  git("config", "commit.gpgsign", "false");
  for (const f of [
    "src/lib.rs",
    "src-tauri/tauri.conf.json",
    "website/a.html",
    "docs/a.md",
    "README.md",
  ])
    write(f);
  git("add", "-A");
  git("commit", "-qm", "base");
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("ci-app-changed.sh", () => {
  it("says docs when only docs, changesets and top-level Markdown change", () => {
    expect(
      answer(() => {
        write("docs/b.md");
        write("docs/images/new.png");
        write(".changeset/x.md");
        write("CHANGELOG.md");
        write("README.md", "changed\n");
      }),
    ).toBe("docs");
    expect(answer(() => write("docs/a.md", "changed\n"))).toBe("docs");
  });

  it("reads a non-ASCII file name as it is, so a docs change with one is still docs", () => {
    expect(answer(() => write("docs/café.md"))).toBe("docs");
    expect(answer(() => write("website/café.html"))).toBe("site");
    expect(answer(() => write("src/café.rs"))).toBe("app");
  });

  it("says site when the website, its image script or its own checks change, with or without docs", () => {
    expect(answer(() => write("website/a.html", "changed\n"))).toBe("site");
    expect(answer(() => write("website/images/new.webp"))).toBe("site");
    expect(answer(() => write("scripts/build-website-images.sh"))).toBe("site");
    expect(answer(() => write("scripts/website.ts"))).toBe("site");
    expect(answer(() => write("scripts/check-website.ts"))).toBe("site");
    expect(answer(() => write("scripts/policy.ts"))).toBe("site");
    expect(answer(() => write("scripts/website.test.ts"))).toBe("site");
    expect(answer(() => write("scripts/policy.test.ts"))).toBe("site");
    expect(
      answer(() => {
        write("website/a.html", "changed\n");
        write("docs/b.md");
        write(".changeset/x.md");
      }),
    ).toBe("site");
  });

  it("says app when an app file changes, alone or with site and docs files", () => {
    expect(answer(() => write("src/lib.rs", "changed\n"))).toBe("app");
    expect(
      answer(() => {
        write("website/a.html", "changed\n");
        write("docs/b.md");
        write("crates/core/src/x.rs");
      }),
    ).toBe("app");
  });

  it("says app for files that only look like docs or site: a nested Markdown file, other scripts (even with a similar name), workflows, the website's deploy config", () => {
    expect(answer(() => write("crates/core/README.md"))).toBe("app");
    expect(answer(() => write("scripts/check-brand.ts"))).toBe("app");
    expect(answer(() => write("scripts/websites.ts"))).toBe("app");
    expect(answer(() => write("scripts/policy-extra.ts"))).toBe("app");
    // A test file the site run's Vitest step doesn't list must run in the full suite.
    expect(answer(() => write("scripts/check-website.test.ts"))).toBe("app");
    expect(answer(() => write(".github/workflows/ci.yml"))).toBe("app");
    expect(answer(() => write(".github/website/wrangler.jsonc"))).toBe("app");
    expect(answer(() => write("package.json"))).toBe("app");
  });

  it("says app when an app file is deleted", () => {
    expect(answer(() => rmSync(join(dir, "src-tauri/tauri.conf.json")))).toBe("app");
  });

  it("says app when an app file is moved into website/ or docs/ (a rename lists only the new path)", () => {
    expect(answer(() => git("mv", "src/lib.rs", "website/lib.rs"))).toBe("app");
    expect(answer(() => git("mv", "src-tauri/tauri.conf.json", "docs/tauri.conf.json"))).toBe(
      "app",
    );
  });

  it("fails safe: says app when the changed files can't be listed", () => {
    const out = spawnSync(script, ["nope", "nope"], { cwd: dir, encoding: "utf8" });
    expect(out.stdout.trim()).toBe("app");
    expect(out.status).toBe(0);
  });
});
