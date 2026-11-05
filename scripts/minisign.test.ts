import { describe, expect, it } from "vitest";
import fixture from "./fixtures/minisign.json";
import { verifyMinisign } from "./minisign";

const file = new TextEncoder().encode(fixture.file);
const good = { file, signature: fixture.signature, pubkey: fixture.pubkey };

/** A signature file with one line replaced, as base64 again. */
function altered(signature: string, line: number, text: string): string {
  const lines = Buffer.from(signature, "base64").toString("utf8").split("\n");
  lines[line] = text;
  return Buffer.from(lines.join("\n")).toString("base64");
}

describe("a minisign signature", () => {
  it("verifies for the file and key it was made with, and gives its version", () => {
    const verified = verifyMinisign(good);
    expect(verified.version).toBe("1.2.3");
    expect(verified.trustedComment).toBe("timestamp:1700000000\tfile:hello.txt\tversion:1.2.3");
  });

  it("gives no version when the signer recorded none", () => {
    const verified = verifyMinisign({ ...good, signature: fixture.signatureWithoutVersion });
    expect(verified.version).toBeNull();
  });

  it("is refused for a changed file", () => {
    expect(() =>
      verifyMinisign({ ...good, file: new TextEncoder().encode("hello, update!\n") }),
    ).toThrow(/doesn't match the file/);
  });

  it("is refused for another key", () => {
    // The key's id is in the signature, and the key is a different one.
    const other = Buffer.from(fixture.pubkey, "base64").toString("utf8").split("\n");
    const pub = Buffer.from(other[1]!, "base64");
    pub[3] = (pub[3]! + 1) % 256;
    other[1] = pub.toString("base64");
    const pubkey = Buffer.from(other.join("\n")).toString("base64");
    expect(() => verifyMinisign({ ...good, pubkey })).toThrow(/different key/);
  });

  it("is refused when its trusted comment is changed (the version can't be swapped)", () => {
    const signature = altered(
      fixture.signature,
      2,
      "trusted comment: timestamp:1700000000\tfile:hello.txt\tversion:9.9.9",
    );
    expect(() => verifyMinisign({ ...good, signature })).toThrow(/comment was altered/);
  });

  it("is refused for text that isn't a signature or a key", () => {
    expect(() => verifyMinisign({ ...good, signature: "AAAA" })).toThrow(
      /not a minisign signature/,
    );
    expect(() => verifyMinisign({ ...good, pubkey: "AAAA" })).toThrow(/not a minisign public key/);
  });
});
