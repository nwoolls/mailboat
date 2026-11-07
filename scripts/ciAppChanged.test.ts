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
  it("says false when only the website, docs, changesets, the image script or top-level Markdown change", () => {
    expect(
      answer(() => {
        write("website/a.html", "changed\n");
        write("website/images/new.webp");
        write("docs/b.md");
        write(".changeset/x.md");
        write("scripts/build-website-images.sh");
        write("CHANGELOG.md");
      }),
    ).toBe("false");
  });

  it("says true when an app file changes, alone or with site files", () => {
    expect(answer(() => write("src/lib.rs", "changed\n"))).toBe("true");
    expect(
      answer(() => {
        write("website/a.html", "changed\n");
        write("crates/core/src/x.rs");
      }),
    ).toBe("true");
  });

  it("says true for files that only look like docs: a nested Markdown file, other scripts, workflows", () => {
    expect(answer(() => write("crates/core/README.md"))).toBe("true");
    expect(answer(() => write("scripts/check-brand.ts"))).toBe("true");
    expect(answer(() => write(".github/workflows/ci.yml"))).toBe("true");
  });

  it("says true when an app file is deleted", () => {
    expect(answer(() => rmSync(join(dir, "src-tauri/tauri.conf.json")))).toBe("true");
  });

  it("says true when an app file is moved into website/ or docs/ (a rename lists only the new path)", () => {
    expect(answer(() => git("mv", "src/lib.rs", "website/lib.rs"))).toBe("true");
    expect(answer(() => git("mv", "src-tauri/tauri.conf.json", "docs/tauri.conf.json"))).toBe(
      "true",
    );
  });

  it("fails safe: says true when the changed files can't be listed", () => {
    const out = spawnSync(script, ["nope", "nope"], { cwd: dir, encoding: "utf8" });
    expect(out.stdout.trim()).toBe("true");
    expect(out.status).toBe(0);
  });
});
