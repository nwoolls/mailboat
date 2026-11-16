// What the release's built binaries must have (DASA v2.2.0), read from the
// output of the platform's own tools, so `check-binaries.ts` can fail a
// release that lost one. Tested against real output in
// `binaryChecks.test.ts`.

/**
 * Entitlements the macOS app may have (DASA 3.3.2). It asks for none:
 * `tauri.macos.conf.json` names no entitlements file. A new one means
 * adding it here, which a pull request review sees.
 */
export const REVIEWED_ENTITLEMENTS: readonly string[] = [];

/**
 * What's wrong with one macOS binary, from `codesign -d --verbose=4`
 * (its stderr), `codesign -d --entitlements - --xml`, `otool -hv` and
 * `otool -l`.
 */
export function macProblems(o: {
  codesign: string;
  entitlements: string;
  header: string;
  loadCommands: string;
}): string[] {
  const problems: string[] = [];
  // DASA 3.3.1: the hardened runtime, shown in the code directory's flags.
  const flags = /^CodeDirectory .*?\bflags=0x[0-9a-f]+\(([^)]*)\)/m.exec(o.codesign)?.[1];
  if (flags === undefined) problems.push("DASA 3.3.1: no code signature found");
  else if (!flags.split(",").includes("runtime")) {
    problems.push(`DASA 3.3.1: not signed with the hardened runtime (flags: ${flags})`);
  }
  // DASA 3.3.2: only reviewed entitlements.
  for (const key of entitlementKeys(o.entitlements)) {
    if (!REVIEWED_ENTITLEMENTS.includes(key))
      problems.push(`DASA 3.3.2: entitlement not reviewed: ${key}`);
  }
  // DASA 3.1.1: position-independent.
  if (!/\bPIE\b/.test(o.header))
    problems.push("DASA 3.1.1: not position-independent (no PIE flag)");
  // DASA 1.5.2: no run-path search, so no folder a user could write to is
  // searched for libraries. Today's binaries have none at all.
  for (const path of rpaths(o.loadCommands)) problems.push(`DASA 1.5.2: an RPATH: ${path}`);
  return problems;
}

/** The top-level keys of an entitlements plist. */
export function entitlementKeys(plist: string): string[] {
  const dict = /<plist[^>]*>\s*<dict>([\s\S]*)<\/dict>\s*<\/plist>/.exec(plist)?.[1] ?? "";
  // Only the outer dict's keys: drop nested dicts first.
  let flat = dict;
  for (let before = ""; before !== flat;) {
    before = flat;
    flat = flat.replace(/<dict>(?:(?!<dict>)[\s\S])*?<\/dict>/g, "");
  }
  return [...flat.matchAll(/<key>([^<]*)<\/key>/g)].map((m) => m[1]!);
}

/** The paths of `otool -l`'s `LC_RPATH` load commands. */
export function rpaths(loadCommands: string): string[] {
  return [...loadCommands.matchAll(/cmd LC_RPATH[\s\S]*?\bpath (.+?) \(offset/g)].map((m) => m[1]!);
}

/**
 * What's wrong with one Windows binary, from `llvm-readobj --file-headers`.
 * DASA 2.1.1: ASLR and DEP; 2.1.2: Control Flow Guard; 2.1.3: high-entropy
 * ASLR; 2.1.4: a 64-bit build (SafeSEH is for 32-bit only).
 */
export function peProblems(headers: string): string[] {
  const problems: string[] = [];
  const machine = /Machine: IMAGE_FILE_MACHINE_(\w+)/.exec(headers)?.[1];
  if (machine !== "AMD64" && machine !== "ARM64") {
    problems.push(`DASA 2.1.4: not a 64-bit build (machine: ${machine ?? "unknown"})`);
  }
  for (const [rule, flag] of [
    ["DASA 2.1.1", "DYNAMIC_BASE"],
    ["DASA 2.1.1", "NX_COMPAT"],
    ["DASA 2.1.2", "GUARD_CF"],
    ["DASA 2.1.3", "HIGH_ENTROPY_VA"],
  ] as const) {
    if (!new RegExp(`\\bIMAGE_DLL_CHARACTERISTICS_${flag}\\b`).test(headers)) {
      problems.push(`${rule}: ${flag} is off`);
    }
  }
  return problems;
}
