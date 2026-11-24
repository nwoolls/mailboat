// The AppImage's runtime: the program at its front that mounts the rest and
// starts the app. appimagetool copies the runtime it's given (or downloads
// one), then writes a digest, the update information and a signature into
// three of its sections. These read a 64-bit little-endian ELF from its
// bytes, so the release can check the runtime is the pinned one and can
// unpack the rest without running it.

type Section = { name: string; offset: number; size: number };

function u16(b: Uint8Array, at: number): number {
  return b[at] | (b[at + 1] << 8);
}
function u32(b: Uint8Array, at: number): number {
  return (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16)) + b[at + 3] * 2 ** 24;
}
function u64(b: Uint8Array, at: number): number {
  return u32(b, at) + u32(b, at + 4) * 2 ** 32;
}

function header(b: Uint8Array) {
  const elf = b[0] === 0x7f && b[1] === 0x45 && b[2] === 0x4c && b[3] === 0x46;
  if (!elf || b[4] !== 2 || b[5] !== 1) throw new Error("not a 64-bit little-endian ELF");
  return {
    shoff: u64(b, 0x28),
    shentsize: u16(b, 0x3a),
    shnum: u16(b, 0x3c),
    shstrndx: u16(b, 0x3e),
  };
}

/**
 * Where the ELF part ends: its section headers are the last thing in it, so
 * the AppImage's file system starts here.
 */
export function elfEnd(b: Uint8Array): number {
  const h = header(b);
  return h.shoff + h.shentsize * h.shnum;
}

/** The sections, by name, with where they are in the file. */
export function sections(b: Uint8Array): Section[] {
  const h = header(b);
  const at = (i: number) => h.shoff + i * h.shentsize;
  const names = at(h.shstrndx);
  const namesOffset = u64(b, names + 0x18);
  const list: Section[] = [];
  for (let i = 0; i < h.shnum; i++) {
    const s = at(i);
    let end = namesOffset + u32(b, s);
    let name = "";
    while (b[end] !== 0 && end < b.length) name += String.fromCharCode(b[end++]);
    list.push({ name, offset: u64(b, s + 0x18), size: u64(b, s + 0x20) });
  }
  return list;
}

/** What appimagetool writes into the runtime after copying it. */
export const WRITTEN_SECTIONS = [".digest_md5", ".upd_info", ".sha256_sig", ".sig_key"];

/**
 * Why the AppImage's runtime isn't `runtime`, or null when it is: the same
 * length, and the same bytes outside the sections appimagetool fills in.
 */
export function runtimeProblem(appimage: Uint8Array, runtime: Uint8Array): string | null {
  const length = elfEnd(runtime);
  if (elfEnd(appimage) !== length) {
    return `its runtime is ${elfEnd(appimage)} bytes, the pinned one ${length}`;
  }
  const skip = sections(runtime).filter((s) => WRITTEN_SECTIONS.includes(s.name));
  for (let i = 0; i < length; i++) {
    if (skip.some((s) => i >= s.offset && i < s.offset + s.size)) continue;
    if (appimage[i] !== runtime[i]) return `its runtime differs from the pinned one at byte ${i}`;
  }
  return null;
}
