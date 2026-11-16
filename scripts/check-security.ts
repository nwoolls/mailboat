// Fails when a security setting a script can check has regressed
// (`scripts/security.ts` has the rules and the test cases they back). Run by
// `bun run check`, `check:quick` and CI, with the other checks.
import { readFileSync } from "node:fs";
import { checkSecurity } from "./security";

/** Not text. */
const BINARY = /\.(png|jpe?g|gif|icns|ico|car|pdf|woff2?|webp|xlsx|docx|zip|gz)$/i;

const r = Bun.spawnSync(["git", "ls-files", "-z"], { stdout: "pipe", stderr: "pipe" });
if (r.exitCode !== 0) {
  console.error(`check:security: git ls-files failed: ${r.stderr.toString().trim()}`);
  process.exit(1);
}
const files = new Map<string, string>();
for (const file of r.stdout.toString().split("\0").filter(Boolean)) {
  if (BINARY.test(file)) continue;
  try {
    const text = readFileSync(file, "utf8");
    if (!text.includes("\0")) files.set(file, text);
  } catch {
    // Deleted in the working tree and not committed yet: nothing to check.
  }
}

const findings = checkSecurity(files);
for (const f of findings) {
  console.error(`check:security: ${f.rule}: ${f.file}${f.line ? `:${f.line}` : ""}: ${f.message}`);
}
if (findings.length) {
  console.error(
    `check:security: ${findings.length} problem(s). A reviewed exception carries "security-ok: <why>" on its line.`,
  );
  process.exit(1);
}
console.log(`check:security: ${files.size} files checked, nothing found`);
