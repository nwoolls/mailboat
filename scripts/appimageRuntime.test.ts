import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  elfEnd,
  RUNTIME_RELEASE,
  RUNTIME_SHA256,
  runtimeProblem,
  sections,
} from "./appimageRuntime";

/**
 * A tiny 64-bit little-endian ELF: a header, some code bytes, a section
 * names table and the section headers (null, .text, .digest_md5,
 * .shstrtab), as a runtime is laid out.
 */
function elf(code: number[], digest: number[]): Uint8Array {
  const names = "\0.text\0.digest_md5\0.shstrtab\0";
  const body = [...code, ...digest];
  const namesAt = 64 + body.length;
  const shoff = namesAt + names.length;
  const b = new Uint8Array(shoff + 4 * 64);
  b.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]);
  const view = new DataView(b.buffer);
  view.setBigUint64(0x28, BigInt(shoff), true);
  view.setUint16(0x3a, 64, true);
  view.setUint16(0x3c, 4, true);
  view.setUint16(0x3e, 3, true);
  b.set(body, 64);
  b.set(
    [...names].map((c) => c.charCodeAt(0)),
    namesAt,
  );
  const section = (i: number, name: number, offset: number, size: number) => {
    view.setUint32(shoff + i * 64, name, true);
    view.setUint32(shoff + i * 64 + 4, 1, true);
    view.setBigUint64(shoff + i * 64 + 0x18, BigInt(offset), true);
    view.setBigUint64(shoff + i * 64 + 0x20, BigInt(size), true);
  };
  section(1, 1, 64, code.length);
  section(2, 7, 64 + code.length, digest.length);
  section(3, 19, namesAt, names.length);
  return b;
}

/** An AppImage: a runtime, then a file system (SquashFS's magic, `hsqs`). */
const withFiles = (runtime: Uint8Array, files: number[] = [0x68, 0x73, 0x71, 0x73, 0]) =>
  new Uint8Array([...runtime, ...files]);

describe("the AppImage's runtime", () => {
  const pinned = elf([1, 2, 3, 4], [0, 0, 0, 0]);

  it("reads where the ELF part ends and its sections", () => {
    expect(elfEnd(pinned)).toBe(pinned.length);
    expect(sections(pinned).map((s) => s.name)).toEqual(["", ".text", ".digest_md5", ".shstrtab"]);
  });

  it("is the pinned one, whatever appimagetool wrote into its digest section", () => {
    const built = withFiles(elf([1, 2, 3, 4], [9, 9, 9, 9]));
    expect(runtimeProblem(built, pinned)).toBeNull();
  });

  it("isn't when its code differs, or its length", () => {
    expect(runtimeProblem(withFiles(elf([1, 2, 3, 5], [0, 0, 0, 0])), pinned)).toMatch(
      /differs .* at byte 67/,
    );
    expect(runtimeProblem(withFiles(elf([1, 2, 3, 4, 5], [0, 0, 0, 0])), pinned)).toMatch(/bytes/);
  });

  it("isn't when nothing follows it: an AppImage cut off after its runtime", () => {
    expect(runtimeProblem(new Uint8Array(pinned), pinned)).toMatch(/no file system/);
    expect(runtimeProblem(withFiles(pinned, [0, 0, 0, 0]), pinned)).toMatch(/no file system/);
  });

  it("refuses a file that can't be read as an ELF, saying why", () => {
    expect(runtimeProblem(new Uint8Array([0x23, 0x21]), pinned)).toMatch(/too short/);
    // Section headers said to be past the end of the file.
    const lying = withFiles(pinned);
    new DataView(lying.buffer).setBigUint64(0x28, BigInt(lying.length), true);
    expect(runtimeProblem(lying, pinned)).toMatch(/past the end/);
    // A section that runs past the end.
    const long = new Uint8Array(pinned);
    const shoff = Number(new DataView(long.buffer).getBigUint64(0x28, true));
    new DataView(long.buffer).setBigUint64(shoff + 64 + 0x20, 10n ** 9n, true);
    expect(() => sections(long)).toThrow(/past the end/);
    expect(runtimeProblem(withFiles(pinned), long)).toMatch(/pinned runtime can't be read/);
  });
});

describe("the pinned runtime's digests", () => {
  it("are the ones the tools script downloads and checks, for the same release", () => {
    // Both processors the release builds for, not just whatever is listed.
    expect(Object.keys(RUNTIME_SHA256).toSorted()).toEqual(["aarch64", "x86_64"]);
    const script = readFileSync(resolve(__dirname, "appimage-tools.sh"), "utf8");
    for (const [arch, sha] of Object.entries(RUNTIME_SHA256)) {
      const block = script.slice(script.indexOf(`${arch})`));
      expect(/runtime=([0-9a-f]{64})/.exec(block)?.[1], arch).toBe(sha);
    }
    expect(script).toContain(`type2-runtime/releases/download/${RUNTIME_RELEASE}/`);
  });
});

describe("the runtime check, as the release runs it", () => {
  it("refuses a reference file that isn't the pinned runtime, before reading the AppImage", () => {
    const r = spawnSync(
      "bun",
      ["scripts/check-appimage-runtime.ts", "missing.AppImage", "package.json"],
      { encoding: "utf8", cwd: resolve(__dirname, "..") },
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/isn't the pinned runtime/);
  });
});
