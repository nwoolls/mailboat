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
  // DASA 3.1.1: position-independent, read from the header rows only (the
  // output's first line is the file's path, which could hold "PIE"). One
  // architecture: `codesign -d` shows only the native slice, so another
  // slice could lack what this checks (review).
  const headers = machHeaders(o.header);
  if (headers.length === 0) problems.push("DASA 3.1.1: no Mach-O header found");
  else if (headers.length > 1) {
    problems.push(`one architecture expected, found ${headers.length} (a universal binary)`);
  }
  if (headers.some((row) => !row.includes("PIE"))) {
    problems.push("DASA 3.1.1: not position-independent (no PIE flag)");
  }
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
  let before: string;
  do {
    before = flat;
    flat = flat.replace(/<dict>(?:(?!<dict>)[\s\S])*?<\/dict>/g, "");
  } while (before !== flat);
  return [...flat.matchAll(/<key>([^<]*)<\/key>/g)].map((m) => m[1]!);
}

/** The paths of `otool -l`'s `LC_RPATH` load commands. */
export function rpaths(loadCommands: string): string[] {
  // Each `LC_RPATH` counts, whatever its path reads as (review: an empty
  // one was missed).
  return loadCommands.split(/(?=^Load command )/m).flatMap((command) => {
    if (!/^\s*cmd LC_RPATH\s*$/m.test(command)) return [];
    const path = /^\s*path (.*?)\s*\(offset/m.exec(command)?.[1]?.trim();
    return [path ? path : "(empty)"];
  });
}

/** Each Mach-O header row's flags in `otool -hv` (one row per architecture). */
export function machHeaders(header: string): string[][] {
  return header
    .split("\n")
    .filter((line) => /^\s*MH_(?:MAGIC|CIGAM)(?:_64)?\s/.test(line))
    .map((line) => line.trim().split(/\s+/).slice(7));
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

/**
 * What's wrong with the Linux program, from `readelf -h -l -d -W`. DASA has
 * no Linux test cases, so these are the protections the Mac and Windows
 * checks ask for, as Linux names them: a 64-bit, position-independent
 * program (ASLR), a stack that can't run code (DEP), full RELRO (the
 * dynamic linker's tables read-only once loaded, with every symbol bound
 * at start), and no RPATH or RUNPATH (no library loaded from a folder the
 * program names). `runpath` is the one RUNPATH allowed, for the AppImage:
 * linuxdeploy sets `$ORIGIN/../lib` so the program loads the libraries
 * bundled next to it, inside the read-only image.
 */
export function elfProblems(readelf: string, runpath?: string): string[] {
  const problems: string[] = [];
  const field = (name: string) => new RegExp(`^\\s*${name}:\\s*(.+)$`, "m").exec(readelf)?.[1];
  if (field("Class") !== "ELF64") problems.push(`not a 64-bit build (class: ${field("Class")})`);
  const flags1 = /\(FLAGS_1\)\s+Flags:([^\n]*)/.exec(readelf)?.[1].trim().split(/\s+/) ?? [];
  if (!field("Type")?.startsWith("DYN") || !flags1.includes("PIE")) {
    problems.push(`not position-independent (type: ${field("Type") ?? "unknown"})`);
  }
  // A segment row: its name, five numbers, then its flags (R, W, E).
  const segment = (name: string) =>
    new RegExp(`^\\s*${name}\\s+(?:0x[0-9a-f]+\\s+){5}([RWE ]+?)\\s+0x`, "m").exec(readelf);
  const stack = segment("GNU_STACK");
  if (!stack) problems.push("no GNU_STACK segment, so the stack may run code");
  else if (stack[1].includes("E")) problems.push("the stack can run code");
  const bindNow = /\(FLAGS\)\s+[^\n]*\bBIND_NOW\b/.test(readelf) || flags1.includes("NOW");
  if (!segment("GNU_RELRO") || !bindNow) problems.push("no full RELRO (GNU_RELRO and BIND_NOW)");
  if (/\(RPATH\)/.test(readelf)) problems.push("has a RPATH");
  const runpaths = [...readelf.matchAll(/\(RUNPATH\)[^\n]*\[([^\]]*)\]/g)].map((m) => m[1]);
  if (/\(RUNPATH\)/.test(readelf) && !(runpaths.length === 1 && runpaths[0] === runpath)) {
    problems.push("has a RUNPATH");
  }
  return problems;
}
