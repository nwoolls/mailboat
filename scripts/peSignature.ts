// Whether a Windows executable carries an Authenticode signature: its PE
// header's certificate table (data directory 4) is there and points inside
// the file. This says a signature is present, not that it is valid; the
// release workflow's check is that the signing step ran on every file.

const MZ = 0x5a4d;
const PE = 0x00004550;
const CERTIFICATE_TABLE = 4;

const WIN_CERT_REVISION_2 = 0x0200;
const WIN_CERT_PKCS_SIGNED_DATA = 0x0002;

/**
 * The size in bytes of the certificate table, or 0 when the file isn't signed.
 * This entry is the one PE data directory that holds a plain file offset, not
 * an RVA. At that offset is a WIN_CERTIFICATE header (length, revision, type),
 * which must say it holds PKCS#7 signed data (what Authenticode signing writes).
 */
export function certificateTableSize(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 0x40 || view.getUint16(0, true) !== MZ) {
    throw new Error("not a Windows executable (no MZ header)");
  }
  const pe = view.getUint32(0x3c, true);
  if (pe + 4 > bytes.length || view.getUint32(pe, true) !== PE) {
    throw new Error("not a Windows executable (no PE header)");
  }
  const optional = pe + 24;
  if (optional + 2 > bytes.length) throw new Error("PE header is cut short");
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
  if (size < 8) throw new Error("certificate table is too small to hold a certificate");
  const length = view.getUint32(offset, true);
  const revision = view.getUint16(offset + 4, true);
  const type = view.getUint16(offset + 6, true);
  // The length covers the 8-byte header too, so it can't be less than that.
  const fits = length >= 8 && length <= size;
  if (revision !== WIN_CERT_REVISION_2 || type !== WIN_CERT_PKCS_SIGNED_DATA || !fits) {
    throw new Error("the certificate table doesn't hold PKCS#7 signed data");
  }
  return size;
}

export function isSigned(bytes: Uint8Array): boolean {
  return certificateTableSize(bytes) > 0;
}
