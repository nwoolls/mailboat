// Verifies a minisign signature, the format Tauri signs updates in, the way
// the app's updater does before it installs anything. The release workflow
// uses it so a signature made with the wrong key, or for the wrong version,
// is found before a release is published, not when the first person updates.
//
// A key or signature "file" is a few lines of text, and the updater (and
// `tauri.conf.json`, and `latest.json`) carry it as base64 of that text.
import { createHash, createPublicKey, verify } from "node:crypto";

/** What wraps a raw Ed25519 public key to make one Node can read (DER, SPKI). */
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

const TRUSTED = "trusted comment: ";

function textLines(base64: string): string[] {
  return Buffer.from(base64.trim(), "base64").toString("utf8").split("\n");
}

function algorithm(bytes: Buffer): "Ed" | "ED" {
  const name = bytes.subarray(0, 2).toString("latin1");
  if (name !== "Ed" && name !== "ED") throw new Error("unknown signature algorithm");
  return name;
}

export type Verified = {
  /** The trusted comment, which the signature covers. */
  trustedComment: string;
  /** The `version:` field of the trusted comment, if the signer recorded one. */
  version: string | null;
};

/**
 * Checks that `signature` (base64 of a minisign signature file) is a valid
 * signature of `file` by the key `pubkey` (base64 of a minisign public key
 * file), including its trusted comment. Throws, saying why, if not.
 */
export function verifyMinisign(input: {
  file: Uint8Array;
  signature: string;
  pubkey: string;
}): Verified {
  const pubLines = textLines(input.pubkey);
  const pub = Buffer.from(pubLines[1] ?? "", "base64");
  if (pub.length !== 42 || algorithm(pub) !== "Ed") throw new Error("not a minisign public key");
  const keyId = pub.subarray(2, 10);
  const key = createPublicKey({
    key: Buffer.concat([SPKI_PREFIX, pub.subarray(10)]),
    format: "der",
    type: "spki",
  });

  const sigLines = textLines(input.signature);
  const sig = Buffer.from(sigLines[1] ?? "", "base64");
  const comment = sigLines[2] ?? "";
  const global = Buffer.from(sigLines[3] ?? "", "base64");
  if (sig.length !== 74 || global.length !== 64 || !comment.startsWith(TRUSTED)) {
    throw new Error("not a minisign signature");
  }
  if (!sig.subarray(2, 10).equals(keyId)) throw new Error("signed with a different key");

  // "ED" signs a BLAKE2b-512 hash of the file; "Ed" signs the file itself.
  const message =
    algorithm(sig) === "ED"
      ? createHash("blake2b512").update(input.file).digest()
      : Buffer.from(input.file);
  if (!verify(null, message, key, sig.subarray(10))) {
    throw new Error("the signature doesn't match the file");
  }
  const trustedComment = comment.slice(TRUSTED.length);
  const covered = Buffer.concat([sig.subarray(10), Buffer.from(trustedComment, "utf8")]);
  if (!verify(null, covered, key, global)) throw new Error("the signature's comment was altered");

  const version = trustedComment.split("\t").find((f) => f.startsWith("version:"));
  return { trustedComment, version: version ? version.slice("version:".length) : null };
}
