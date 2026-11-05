// Whether a Windows executable carries an Authenticode signature: its PE
// header's certificate table (data directory 4) is there and points inside
// the file. This says a signature is present, not that it is valid; the
// release workflow's check is that the signing step ran on every file.

const MZ = 0x5a4d;
const PE = 0x00004550;
const CERTIFICATE_TABLE = 4;

/** The size in bytes of the certificate table, or 0 when the file isn't signed. */
export function certificateTableSize(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 0x40 || view.getUint16(0, true) !== MZ) {
    throw new Error("not a Windows executable (no MZ header)");
  }
  const pe = view.getUint32(0x3c, true);
  if (pe + 24 > bytes.length || view.getUint32(pe, true) !== PE) {
    throw new Error("not a Windows executable (no PE header)");
  }
  const optional = pe + 24;
  const magic = view.getUint16(optional, true);
  // PE32 keeps its data directories 96 bytes in, PE32+ 112.
  const directories = optional + (magic === 0x20b ? 112 : magic === 0x10b ? 96 : NaN);
  if (Number.isNaN(directories)) throw new Error("unknown PE format");
  const entry = directories + CERTIFICATE_TABLE * 8;
  if (entry + 8 > bytes.length) throw new Error("PE header is cut short");
  const offset = view.getUint32(entry, true);
  const size = view.getUint32(entry + 4, true);
  if (offset === 0 || size === 0) return 0;
  if (offset + size > bytes.length) throw new Error("certificate table points outside the file");
  return size;
}

export function isSigned(bytes: Uint8Array): boolean {
  return certificateTableSize(bytes) > 0;
}
