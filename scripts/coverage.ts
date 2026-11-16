// Test coverage, measured on demand (`bun run coverage`), not enforced: a
// minimum that fails CI tends to reward tests written for the number.
//
// TypeScript: Vitest's V8 coverage, printed by area (`coverageAreas.ts`).
// Rust: `cargo llvm-cov` over the core crate, where the app's sync, storage,
// sanitizing and auth live, when it is installed:
//
//   rustup component add llvm-tools-preview && cargo install cargo-llvm-cov --locked
//
// Line and branch counts are printed; Rust's branch counts need the nightly
// compiler, so its regions are printed instead.

import { readFileSync } from "node:fs";
import { type FileSummary, groupCoverage, percent } from "./coverageAreas";

// Measuring slows the code down (a screensaver test that takes a second
// went past Vitest's 5-second limit with the whole suite running), so the
// limit is raised for this run only.
const vitest = Bun.spawnSync(
  ["bunx", "vitest", "run", "--coverage.enabled", "--testTimeout=30000"],
  {
    stdout: "inherit",
    stderr: "inherit",
  },
);
if (vitest.exitCode !== 0) {
  console.error("coverage: the Vitest run failed");
  process.exit(vitest.exitCode ?? 1);
}
const summary = JSON.parse(readFileSync("coverage/coverage-summary.json", "utf8")) as Record<
  string,
  FileSummary
>;
console.log("\nTypeScript (Vitest)      files   lines    branches");
for (const a of groupCoverage(summary, process.cwd())) {
  console.log(
    `  ${a.area.padEnd(42)} ${String(a.files).padStart(4)}  ${percent(a.lines).padStart(7)}  ${percent(a.branches).padStart(7)}`,
  );
}

const llvmCov = Bun.spawnSync(["cargo", "llvm-cov", "--version"], {
  stdout: "pipe",
  stderr: "pipe",
});
if (llvmCov.exitCode !== 0) {
  console.log("\nRust: cargo-llvm-cov isn't installed (see the top of scripts/coverage.ts).");
  process.exit(0);
}
const rust = Bun.spawnSync(["cargo", "llvm-cov", "-p", "mail-core", "--summary-only", "--json"], {
  stdout: "pipe",
  stderr: "inherit",
});
if (rust.exitCode !== 0) {
  console.error("coverage: cargo llvm-cov failed");
  process.exit(rust.exitCode ?? 1);
}
const totals = JSON.parse(rust.stdout.toString()).data[0].totals as Record<
  string,
  { count: number; covered: number }
>;
const share = (k: string) => percent({ total: totals[k]!.count, covered: totals[k]!.covered });
console.log(
  `\nRust (crates/core)        lines ${share("lines")}, regions ${share("regions")}, functions ${share("functions")}`,
);
