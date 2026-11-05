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

/** Says whether the file is signed; false, with the reason, if it can't be read as one. */
function check(label: string, path: string): boolean {
  try {
    const signed = isSigned(readFileSync(path));
    console.log(`${signed ? "signed  " : "UNSIGNED"}  ${label}`);
    if (!signed) failures.push(label);
    return true;
  } catch (error) {
    console.error(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    failures.push(label);
    return false;
  }
}

// Without a readable installer there is nothing to look inside.
const readable = check("installer", installer);

const sevenZip = ["7zz", "7z"].find((tool) => Bun.which(tool));
if (!sevenZip) {
  console.error("7-Zip (7zz or 7z) is needed to look inside the installer");
  process.exit(1);
}
const folder = mkdtempSync(join(tmpdir(), "installer-"));
try {
  const out = readable ? Bun.spawnSync([sevenZip, "x", "-y", `-o${folder}`, installer]) : undefined;
  if (out && out.exitCode !== 0) {
    const why = out.stderr.toString().trim().split("\n").slice(-5).join(" | ");
    console.error(`${sevenZip} could not open the installer (exit ${out.exitCode}): ${why}`);
    failures.push("the installer could not be opened");
  }
  // process.exit would skip the cleanup below, so failures are collected and
  // the exit comes after it.
  if (out && out.exitCode === 0) {
    for (const name of [`${brand.shortName}.exe`, "uninstall.exe"]) {
      check(`${name} (inside)`, join(folder, name));
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
