import { describe, expect, it } from "vitest";
import { certificateTableSize, isSigned } from "./peSignature";

/** A minimal PE file: headers only, with the certificate table entry set. */
function pe(opts: { magic?: number; offset?: number; size?: number; length?: number } = {}) {
  const magic = opts.magic ?? 0x20b;
  const bytes = new Uint8Array(opts.length ?? 1024);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, 0x5a4d, true);
  view.setUint32(0x3c, 0x80, true);
  view.setUint32(0x80, 0x00004550, true);
  const optional = 0x80 + 24;
  view.setUint16(optional, magic, true);
  const directories = optional + (magic === 0x20b ? 112 : 96);
  view.setUint32(directories + 4 * 8, opts.offset ?? 0, true);
  view.setUint32(directories + 4 * 8 + 4, opts.size ?? 0, true);
  return bytes;
}

describe("a Windows executable's signature", () => {
  it("is absent when the certificate table is empty", () => {
    expect(isSigned(pe())).toBe(false);
    expect(certificateTableSize(pe())).toBe(0);
  });

  it("is present when the certificate table points inside the file", () => {
    expect(certificateTableSize(pe({ offset: 600, size: 200 }))).toBe(200);
    expect(isSigned(pe({ magic: 0x10b, offset: 600, size: 200 }))).toBe(true);
  });

  it("is refused when the table points outside the file", () => {
    expect(() => certificateTableSize(pe({ offset: 1000, size: 200 }))).toThrow(/outside/);
  });

  it("is refused for something that isn't a Windows executable", () => {
    expect(() => isSigned(new Uint8Array(1024))).toThrow(/MZ/);
    const noPe = pe();
    new DataView(noPe.buffer).setUint32(0x80, 0, true);
    expect(() => isSigned(noPe)).toThrow(/PE header/);
    expect(() => isSigned(pe({ magic: 0x1234 }))).toThrow(/unknown PE format/);
  });
});
