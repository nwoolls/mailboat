import { describe, expect, it } from "vitest";
import { certificateTableSize, isSigned } from "./peSignature";

/** A minimal PE file: headers only, with the certificate table entry set. */
function pe(
  opts: {
    magic?: number;
    offset?: number;
    size?: number;
    length?: number;
    /** What the WIN_CERTIFICATE header at the offset says; PKCS#7 by default. */
    cert?: { length?: number; revision?: number; type?: number };
  } = {},
) {
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
  const offset = opts.offset ?? 0;
  if (offset > 0 && offset + 8 <= bytes.length) {
    view.setUint32(offset, opts.cert?.length ?? opts.size ?? 0, true);
    view.setUint16(offset + 4, opts.cert?.revision ?? 0x0200, true);
    view.setUint16(offset + 6, opts.cert?.type ?? 0x0002, true);
  }
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

  it("is refused when the table doesn't hold PKCS#7 signed data", () => {
    // Wrong type, an old revision, or a length longer than the table.
    for (const cert of [
      { type: 0x0001 },
      { revision: 0x0100 },
      { length: 400 },
      // Too short to hold even the 8-byte header.
      { length: 0 },
      { length: 7 },
    ]) {
      expect(() => certificateTableSize(pe({ offset: 600, size: 200, cert }))).toThrow(/PKCS#7/);
    }
    expect(() => certificateTableSize(pe({ offset: 600, size: 4 }))).toThrow(/too small/);
  });

  it("is refused, with a clear message, when the file is cut short", () => {
    // Ends exactly where the optional header would start, and just inside it.
    expect(() => isSigned(pe().slice(0, 0x80 + 24))).toThrow(/cut short/);
    expect(() => isSigned(pe().slice(0, 0x80 + 25))).toThrow(/cut short/);
  });

  it("treats the table's address as a file offset, not an RVA", () => {
    // The header sits at the offset the entry gives, wherever any section is.
    expect(certificateTableSize(pe({ offset: 900, size: 100, length: 1024 }))).toBe(100);
  });

  it("is refused for something that isn't a Windows executable", () => {
    expect(() => isSigned(new Uint8Array(1024))).toThrow(/MZ/);
    const noPe = pe();
    new DataView(noPe.buffer).setUint32(0x80, 0, true);
    expect(() => isSigned(noPe)).toThrow(/PE header/);
    expect(() => isSigned(pe({ magic: 0x1234 }))).toThrow(/unknown PE format/);
  });
});
