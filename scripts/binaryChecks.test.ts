import { describe, expect, it } from "vitest";
import { entitlementKeys, macProblems, peProblems, rpaths } from "./binaryChecks";

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

  it("fails without PIE, and with an RPATH", () => {
    expect(macProblems({ ...good, header: PIE_HEADER.replace(" PIE", "") })).toEqual([
      "DASA 3.1.1: not position-independent (no PIE flag)",
    ]);
    expect(rpaths(WITH_RPATH)).toEqual(["@loader_path/../lib"]);
    expect(macProblems({ ...good, loadCommands: WITH_RPATH })).toEqual([
      "DASA 1.5.2: an RPATH: @loader_path/../lib",
    ]);
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
