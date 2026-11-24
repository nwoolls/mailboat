import { describe, expect, it } from "vitest";
import { elfEnd, runtimeProblem, sections } from "./appimageRuntime";

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
    view.setBigUint64(shoff + i * 64 + 0x18, BigInt(offset), true);
    view.setBigUint64(shoff + i * 64 + 0x20, BigInt(size), true);
  };
  section(1, 1, 64, code.length);
  section(2, 7, 64 + code.length, digest.length);
  section(3, 19, namesAt, names.length);
  return b;
}

const withFiles = (runtime: Uint8Array, files: number[]) => new Uint8Array([...runtime, ...files]);

describe("the AppImage's runtime", () => {
  const pinned = elf([1, 2, 3, 4], [0, 0, 0, 0]);

  it("reads where the ELF part ends and its sections", () => {
    expect(elfEnd(pinned)).toBe(pinned.length);
    expect(sections(pinned).map((s) => s.name)).toEqual(["", ".text", ".digest_md5", ".shstrtab"]);
  });

  it("is the pinned one, whatever appimagetool wrote into its digest section", () => {
    const built = withFiles(elf([1, 2, 3, 4], [9, 9, 9, 9]), [0x68, 0x73, 0x71, 0x73]);
    expect(runtimeProblem(built, pinned)).toBeNull();
  });

  it("isn't when its code differs, or its length", () => {
    expect(runtimeProblem(withFiles(elf([1, 2, 3, 5], [0, 0, 0, 0]), [0]), pinned)).toMatch(
      /differs .* at byte 67/,
    );
    expect(runtimeProblem(withFiles(elf([1, 2, 3, 4, 5], [0, 0, 0, 0]), [0]), pinned)).toMatch(
      /bytes/,
    );
  });

  it("refuses what isn't a 64-bit ELF", () => {
    expect(() => elfEnd(new Uint8Array([0x23, 0x21]))).toThrow(/ELF/);
  });
});
