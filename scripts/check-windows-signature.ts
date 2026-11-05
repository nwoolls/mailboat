// Checks that a Windows installer is signed, and so are the app and the
// uninstaller inside it (the part people actually run). Used by the release
// workflow, which fails when any is unsigned. Needs 7-Zip (`7zz` or `7z`) to
// open the installer.
//
//   bun scripts/check-windows-signature.ts <installer.exe>
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import brand from "../brand.json";
import { isSigned } from "./peSignature";

const installer = process.argv[2];
if (!installer) {
  console.error("usage: bun scripts/check-windows-signature.ts <installer.exe>");
  process.exit(2);
}

const failures: string[] = [];
function check(label: string, path: string) {
  const signed = isSigned(readFileSync(path));
  console.log(`${signed ? "signed  " : "UNSIGNED"}  ${label}`);
  if (!signed) failures.push(label);
}

check("installer", installer);

const sevenZip = ["7zz", "7z"].find((tool) => Bun.which(tool));
if (!sevenZip) {
  console.error("7-Zip (7zz or 7z) is needed to look inside the installer");
  process.exit(1);
}
const folder = mkdtempSync(join(tmpdir(), "installer-"));
try {
  const out = Bun.spawnSync([sevenZip, "x", "-y", `-o${folder}`, installer]);
  if (out.exitCode !== 0) {
    console.error(`${sevenZip} could not open the installer`);
    failures.push("the installer could not be opened");
  }
  // process.exit would skip the cleanup below, so failures are collected and
  // the exit comes after it.
  for (const name of out.exitCode === 0 ? [`${brand.shortName}.exe`, "uninstall.exe"] : []) {
    try {
      check(`${name} (inside)`, join(folder, name));
    } catch (error) {
      console.error(`${name}: ${error instanceof Error ? error.message : String(error)}`);
      failures.push(name);
    }
  }
} finally {
  rmSync(folder, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`Problems: ${failures.join(", ")}`);
  process.exit(1);
}
console.log("Everything checked is signed.");
