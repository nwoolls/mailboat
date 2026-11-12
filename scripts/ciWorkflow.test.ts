import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// CI skips work for a pull request that only changes docs or the website
// (.github/workflows/ci.yml, "What changed"). This test reads that workflow
// and evaluates every job and step condition for each answer the classifier can
// give (and for no answer at all, as when that job fails), then compares
// what would run with what should. A condition written the wrong way round, or
// one that quietly never runs (`&& false`), fails here. A step nobody listed
// below fails too, so a new step has to be classified on purpose.
const ci = readFileSync(resolve(__dirname, "../.github/workflows/ci.yml"), "utf8");

type Step = { key: string; cond: string | undefined };
type Job = { name: string; cond: string | undefined; steps: Step[] };

/** The jobs and steps of ci.yml, read by indentation (the file's shape is fixed and linted). */
function parse(text: string): Job[] {
  // Only what follows "jobs:" (the "on:" block has two-space keys too).
  const lines = text.slice(text.indexOf("\njobs:")).split("\n");
  const jobs: Job[] = [];
  let job: Job | null = null;
  let step: { fields: Record<string, string> } | null = null;
  let folded: string | null = null;
  const closeStep = () => {
    if (job && step) {
      const f = step.fields;
      const raw = f.run ?? f.uses ?? "";
      job.steps.push({
        key: f.uses ? raw.split("@")[0] : raw.replace(/\s*#.*$/, ""),
        cond: f.if,
      });
    }
    step = null;
  };
  for (const line of lines) {
    const jobStart = /^ {2}([a-z]+):\s*$/.exec(line);
    if (jobStart) {
      closeStep();
      job = { name: jobStart[1], cond: undefined, steps: [] };
      jobs.push(job);
      continue;
    }
    if (!job) continue;
    const jobIf = /^ {4}if:\s*(.*)$/.exec(line);
    if (jobIf) job.cond = jobIf[1];
    if (/^ {6}- /.test(line)) {
      closeStep();
      step = { fields: {} };
      folded = null;
    }
    if (!step) continue;
    const field = /^ {6}(?:- | {2})([a-z]+):\s*(.*)$/.exec(line);
    if (field) {
      folded = field[2] === ">-" || field[2] === ">" ? field[1] : null;
      step.fields[field[1]] = folded ? "" : field[2];
      continue;
    }
    if (folded && /^ {10}\S/.test(line)) {
      step.fields[folded] = `${step.fields[folded]} ${line.trim()}`.trim();
    }
  }
  closeStep();
  return jobs;
}

/** What GitHub would decide for one condition, for a given answer and runner, with the workflow not cancelled. */
function runs(cond: string | undefined, kind: string, os: string): boolean {
  if (cond === undefined) return true;
  // A condition that never reads the classifier's answer (the changeset check's
  // "is this a pull request" one) is not what this test is about.
  if (!cond.includes("needs.changes.outputs.kind") && !cond.includes("!cancelled()")) return true;
  const expression = cond
    .replace(/\$\{\{|\}\}/g, "")
    .replace(/needs\.changes\.outputs\.kind/g, "KIND")
    .replace(/runner\.os/g, "OS")
    .replace(/!cancelled\(\)/g, "true")
    .replace(/\bfailure\(\)/g, "true")
    .trim();
  if (!/^[\w\s'!=&|().]+$/.test(expression)) {
    throw new Error(`a condition this test can't evaluate: ${cond}`);
  }
  return Boolean(new Function("KIND", "OS", `return (${expression});`)(kind, os));
}

const KINDS = ["docs", "site", "app", ""] as const; // "" is the answer when "What changed" fails
type Rule = (kind: string, os: string) => boolean;
const always: Rule = () => true;
const unlessDocs: Rule = (kind) => kind !== "docs";
const appOnly: Rule = (kind) => kind !== "docs" && kind !== "site";
const appOnOs =
  (only: string): Rule =>
  (kind, os) =>
    appOnly(kind, os) && os === only;

const EXPECTED: Record<string, { job: Rule; steps: Record<string, Rule> }> = {
  web: {
    job: always,
    steps: {
      "actions/checkout": always,
      "oven-sh/setup-bun": always,
      "bun install --frozen-lockfile": always,
      "bun run fmt:check": always,
      "bun run lint": unlessDocs,
      "bun run typecheck": appOnly,
      "bun run check:brand": always,
      "bun run check:website": unlessDocs,
      "bun run check:privacy": always,
      "bun run test": appOnly,
      "bunx vitest run scripts/website.test.ts scripts/policy.test.ts": unlessDocs,
      'bun run changeset status --since="origin/$BASE_REF"': always,
    },
  },
  rust: {
    job: always,
    steps: {
      "actions/checkout": appOnly,
      "oven-sh/setup-bun": appOnly,
      "bun install --frozen-lockfile": appOnly,
      "dtolnay/rust-toolchain": appOnly,
      "Swatinem/rust-cache": appOnly,
      "cargo fmt --all --check": appOnly,
      "cargo clippy --workspace --all-targets -- -D warnings": appOnly,
      "cargo test --workspace": appOnOs("macOS"),
      "cargo test --workspace --exclude desktop --no-fail-fast": appOnOs("Windows"),
    },
  },
  browser: {
    job: appOnly,
    steps: {
      "actions/checkout": always,
      "oven-sh/setup-bun": always,
      "bun install --frozen-lockfile": always,
      "bunx playwright install webkit chromium": always,
      "bun run test:browser": always,
      "actions/upload-artifact": always,
    },
  },
};

describe("the CI's skips, evaluated", () => {
  const jobs = parse(ci);
  const byName = Object.fromEntries(jobs.map((j) => [j.name, j]));

  it("finds the jobs and steps it expects", () => {
    expect(Object.keys(byName)).toEqual(["changes", "web", "rust", "browser"]);
    for (const name of Object.keys(EXPECTED))
      expect(byName[name].steps.length, name).toBeGreaterThan(5);
  });

  it("has no step nobody classified, and no classified step that is gone", () => {
    for (const [name, rules] of Object.entries(EXPECTED)) {
      expect(byName[name].steps.map((s) => s.key).toSorted(), name).toEqual(
        Object.keys(rules.steps).toSorted(),
      );
    }
  });

  for (const [name, rules] of Object.entries(EXPECTED)) {
    for (const kind of KINDS) {
      for (const os of name === "rust" ? ["macOS", "Windows"] : ["macOS"]) {
        const label = `${name} (${os}) when "What changed" says ${kind === "" ? "nothing" : kind}`;
        it(`${label}: the job and each step run exactly when they should`, () => {
          const job = byName[name];
          // the job itself, and its steps if the job runs
          expect(runs(job.cond, kind, os), `${name} job`).toBe(rules.job(kind, os));
          for (const step of job.steps) {
            const should = rules.steps[step.key]?.(kind, os);
            expect(runs(step.cond, kind, os), `${name}: ${step.key}`).toBe(should);
          }
        });
      }
    }
  }

  it("lets the Web and Rust jobs run even if the classifier job failed (so every required check still reports)", () => {
    for (const name of ["web", "rust"]) {
      expect(byName[name].cond, name).toContain("!cancelled()");
    }
    expect(byName.browser.cond).toContain("!cancelled()");
  });

  it("keeps the path filters on the test builds and CodeQL where they belong", () => {
    const ignored = (file: string) => {
      const text = readFileSync(resolve(__dirname, `../.github/workflows/${file}`), "utf8");
      return [...text.matchAll(/^\s+- "([^"]+)"$/gm)].map((m) => m[1]);
    };
    const codeql = ignored("codeql.yml");
    const build = ignored("build.yml");
    // CodeQL scans the website's and the scripts' JavaScript, so only docs-like paths are ignored
    expect(new Set(codeql)).toEqual(new Set(["docs/**", ".changeset/**", "*.md"]));
    // the test builds also skip the website, but never the app's scripts or the workflows
    expect(build).toEqual(
      expect.arrayContaining(["docs/**", ".changeset/**", "website/**", "*.md"]),
    );
    // (under scripts/, only the website's image script and its own checks,
    // which a site run tests)
    const siteScripts = new Set([
      "scripts/build-website-images.sh",
      "scripts/website.ts",
      "scripts/website.test.ts",
      "scripts/check-website.ts",
      "scripts/policy.ts",
      "scripts/policy.test.ts",
    ]);
    for (const pattern of [...codeql, ...build].filter((p) => !siteScripts.has(p))) {
      expect(pattern).not.toMatch(/^(scripts|\.github|src|src-tauri|crates)\b/);
    }
  });
});
