import { describe, expect, it } from "vitest";
import {
  elfProblems,
  entitlementKeys,
  machHeaders,
  macProblems,
  peProblems,
  rpaths,
} from "./binaryChecks";

// Shaped like the tools' real output (codesign 2026, otool, llvm-readobj 21),
// cut to the lines the checks read; no signing identity in them.
const HARDENED =
  "CodeDirectory v=20500 size=512 flags=0x10000(runtime) hashes=5+7 location=embedded";
const ADHOC =
  "CodeDirectory v=20400 size=1079 flags=0x20002(adhoc,linker-signed) hashes=30+0 location=embedded";
const PIE_HEADER = [
  "      magic  cputype cpusubtype  caps    filetype ncmds sizeofcmds      flags",
  "MH_MAGIC_64    ARM64        ALL  0x00     EXECUTE    38       5520   NOUNDEFS DYLDLINK TWOLEVEL PIE MH_HAS_TLV_DESCRIPTORS",
].join("\n");
const NO_RPATH =
  "Load command 12\n          cmd LC_LOAD_DYLIB\n      cmdsize 56\n         name /usr/lib/libSystem.B.dylib (offset 24)\n";
const WITH_RPATH = `${NO_RPATH}Load command 13\n          cmd LC_RPATH\n      cmdsize 32\n         path @loader_path/../lib (offset 12)\n`;
const plist = (keys: string[]) =>
  `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict>${keys
    .map((k) => `<key>${k}</key><true/>`)
    .join("")}</dict></plist>`;

const good = { codesign: HARDENED, entitlements: "", header: PIE_HEADER, loadCommands: NO_RPATH };

describe("a macOS binary", () => {
  it("passes when hardened, with no entitlements, PIE and no RPATH", () => {
    expect(macProblems(good)).toEqual([]);
  });

  it("fails without the hardened runtime, as an ad hoc build is", () => {
    expect(macProblems({ ...good, codesign: ADHOC })).toEqual([
      "DASA 3.3.1: not signed with the hardened runtime (flags: adhoc,linker-signed)",
    ]);
    expect(macProblems({ ...good, codesign: "code object is not signed at all" })[0]).toMatch(
      /DASA 3\.3\.1: no code signature/,
    );
  });

  it("fails with an entitlement not reviewed, reading only the outer keys", () => {
    expect(
      macProblems({
        ...good,
        entitlements: plist(["com.apple.security.cs.disable-library-validation"]),
      }),
    ).toEqual([
      "DASA 3.3.2: entitlement not reviewed: com.apple.security.cs.disable-library-validation",
    ]);
    expect(
      entitlementKeys(
        '<plist version="1.0"><dict><key>a</key><dict><key>nested</key><true/></dict><key>b</key><true/></dict></plist>',
      ),
    ).toEqual(["a", "b"]);
  });

  it("reads PIE from the header rows, not the file's path, and wants one architecture", () => {
    // Review: a binary under `PIE.app` passed on its path alone.
    const noPie = `/tmp/PIE.app/Contents/MacOS/x:\n${PIE_HEADER.replace(" PIE", "")}`;
    expect(macProblems({ ...good, header: noPie })).toEqual([
      "DASA 3.1.1: not position-independent (no PIE flag)",
    ]);
    expect(machHeaders(PIE_HEADER)).toEqual([
      ["NOUNDEFS", "DYLDLINK", "TWOLEVEL", "PIE", "MH_HAS_TLV_DESCRIPTORS"],
    ]);
    // A universal binary: another slice could lack what codesign shows.
    const universal = `${PIE_HEADER}\nMH_MAGIC_64  X86_64        ALL  0x00     EXECUTE    20       2000   NOUNDEFS DYLDLINK TWOLEVEL`;
    expect(macProblems({ ...good, header: universal })).toEqual([
      "one architecture expected, found 2 (a universal binary)",
      "DASA 3.1.1: not position-independent (no PIE flag)",
    ]);
    expect(macProblems({ ...good, header: "not a Mach-O file" })).toEqual([
      "DASA 3.1.1: no Mach-O header found",
    ]);
  });

  it("fails without PIE, and with an RPATH", () => {
    expect(macProblems({ ...good, header: PIE_HEADER.replace(" PIE", "") })).toEqual([
      "DASA 3.1.1: not position-independent (no PIE flag)",
    ]);
    expect(rpaths(WITH_RPATH)).toEqual(["@loader_path/../lib"]);
    expect(macProblems({ ...good, loadCommands: WITH_RPATH })).toEqual([
      "DASA 1.5.2: an RPATH: @loader_path/../lib",
    ]);
    // Review: an RPATH with an empty path counts too.
    const empty = `${NO_RPATH}Load command 13\n          cmd LC_RPATH\n      cmdsize 16\n         path  (offset 12)\n`;
    expect(rpaths(empty)).toEqual(["(empty)"]);
  });
});

/** `llvm-readobj --file-headers` for a binary with these DLL characteristics. */
const headers = (machine: string, flags: string[]) =>
  [
    `  Machine: IMAGE_FILE_MACHINE_${machine} (0xAA64)`,
    "  Characteristics [ (0x22)",
    "    IMAGE_FILE_EXECUTABLE_IMAGE (0x2)",
    "  DLLCharacteristics [ (0xC160)",
    ...flags.map((f) => `    IMAGE_DLL_CHARACTERISTICS_${f} (0x40)`),
  ].join("\n");

describe("a Windows binary", () => {
  const all = ["DYNAMIC_BASE", "GUARD_CF", "HIGH_ENTROPY_VA", "NX_COMPAT", "TERMINAL_SERVER_AWARE"];

  it("passes with every flag on, on x64 or ARM64", () => {
    expect(peProblems(headers("ARM64", all))).toEqual([]);
    expect(peProblems(headers("AMD64", all))).toEqual([]);
  });

  it("names each flag that is off, and a 32-bit build", () => {
    expect(
      peProblems(
        headers(
          "ARM64",
          all.filter((f) => f !== "GUARD_CF"),
        ),
      ),
    ).toEqual(["DASA 2.1.2: GUARD_CF is off"]);
    expect(peProblems(headers("ARM64", ["GUARD_CF"]))).toEqual([
      "DASA 2.1.1: DYNAMIC_BASE is off",
      "DASA 2.1.1: NX_COMPAT is off",
      "DASA 2.1.3: HIGH_ENTROPY_VA is off",
    ]);
    expect(peProblems(headers("I386", all))).toEqual([
      "DASA 2.1.4: not a 64-bit build (machine: I386)",
    ]);
  });
});

describe("a Linux binary", () => {
  // `readelf -h -l -d -W` of the app as `scripts/linux.sh build` made it,
  // cut to the rows the check reads and a few around them.
  const readelf = (o: { type?: string; stack?: string; flags1?: string; extra?: string } = {}) =>
    [
      "ELF Header:",
      "  Class:                             ELF64",
      `  Type:                              ${o.type ?? "DYN (Position-Independent Executable file)"}`,
      "  Machine:                           AArch64",
      "Program Headers:",
      "  Type           Offset   VirtAddr           PhysAddr           FileSiz  MemSiz   Flg Align",
      "  INTERP         0x000270 0x0000000000000270 0x0000000000000270 0x00001b 0x00001b R   0x1",
      `  GNU_STACK      0x000000 0x0000000000000000 0x0000000000000000 0x000000 0x000000 ${o.stack ?? "RW "} 0x10`,
      "  GNU_RELRO      0x1e25b20 0x0000000001e35b20 0x0000000001e35b20 0x0f44e0 0x0f44e0 R   0x1",
      "Dynamic section at offset 0x1f19bf8 contains 38 entries:",
      " 0x0000000000000001 (NEEDED)             Shared library: [libc.so.6]",
      " 0x000000000000001e (FLAGS)              BIND_NOW",
      ` 0x000000006ffffffb (FLAGS_1)            Flags: ${o.flags1 ?? "NOW PIE"}`,
      o.extra ?? "",
    ].join("\n");

  it("passes when 64-bit, position-independent, with a stack that can't run code, full RELRO and no RPATH", () => {
    expect(elfProblems(readelf())).toEqual([]);
  });

  it("names each protection that's missing", () => {
    expect(elfProblems(readelf({ type: "EXEC (Executable file)", flags1: "NOW" }))).toEqual([
      "not position-independent (type: EXEC (Executable file))",
    ]);
    expect(elfProblems(readelf({ stack: "RWE" }))).toEqual(["the stack can run code"]);
    expect(
      elfProblems(
        readelf({ extra: " 0x000000000000001d (RUNPATH)            Library runpath: [$ORIGIN]" }),
      ),
    ).toEqual(["has a RUNPATH"]);
    const appimage = readelf({
      extra: " 0x000000000000001d (RUNPATH)            Library runpath: [$ORIGIN/../lib]",
    });
    expect(elfProblems(appimage, "$ORIGIN/../lib")).toEqual([]);
    expect(elfProblems(appimage)).toEqual(["has a RUNPATH"]);
    expect(
      elfProblems(appimage.replace("$ORIGIN/../lib", "$ORIGIN/../lib:/tmp"), "$ORIGIN/../lib"),
    ).toEqual(["has a RUNPATH"]);
    expect(
      elfProblems(
        readelf()
          .replace(/^.*\(FLAGS\).*$/m, "")
          .replace("Flags: NOW PIE", "Flags: PIE"),
      ),
    ).toEqual(["no full RELRO (GNU_RELRO and BIND_NOW)"]);
  });
});
