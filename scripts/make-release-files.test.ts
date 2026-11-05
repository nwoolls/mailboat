import { generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

/** A minisign key pair like the updater's, made here for the test only. */
function newKey() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  const keyId = randomBytes(8);
  const pub = `untrusted comment: minisign public key\n${Buffer.concat([Buffer.from("Ed"), keyId, raw]).toString("base64")}\n`;
  return { privateKey, keyId, pubkey: Buffer.from(pub).toString("base64") };
}

type Key = ReturnType<typeof newKey>;

/** What Tauri writes to a `.sig` file: base64 of a minisign signature, version in its comment. */
function sigFile(file: Buffer, key: Key, version: string | null): string {
  const sig = sign(null, file, key.privateKey as KeyObject);
  const comment = `timestamp:1\tfile:x${version === null ? "" : `\tversion:${version}`}`;
  const global = sign(
    null,
    Buffer.concat([sig, Buffer.from(comment)]),
    key.privateKey as KeyObject,
  );
  const text =
    `untrusted comment: signature from tauri secret key\n` +
    `${Buffer.concat([Buffer.from("Ed"), key.keyId, sig]).toString("base64")}\n` +
    `trusted comment: ${comment}\n${global.toString("base64")}\n`;
  return Buffer.from(text).toString("base64");
}

const PAYLOADS = ["App.app.tar.gz", "App_0.1.0_x64-setup.exe", "App_0.1.0_arm64-setup.exe"];

let dir: string;
let key: Key;

/** A folder of build outputs as the workflow's jobs leave them. */
function setup(
  opts: { signedBy?: Key; signedFor?: string | null; dropSig?: string; changelog?: string } = {},
) {
  dir = mkdtempSync(join(tmpdir(), "release-files-"));
  key = newKey();
  mkdirSync(join(dir, "from"));
  const from = (name: string) => join(dir, "from", name);
  for (const name of PAYLOADS) {
    const bytes = Buffer.from(`bytes of ${name}`);
    writeFileSync(from(name), bytes);
    if (name !== opts.dropSig) {
      const signedFor = opts.signedFor === undefined ? "0.1.0" : opts.signedFor;
      writeFileSync(from(`${name}.sig`), sigFile(bytes, opts.signedBy ?? key, signedFor));
    }
  }
  writeFileSync(from("App_0.1.0_aarch64.dmg"), "a disk image");
  writeFileSync(from("App.app.zip"), "the checking zip: not published");
  writeFileSync(
    join(dir, "tauri.conf.json"),
    JSON.stringify({ plugins: { updater: { pubkey: key.pubkey } } }),
  );
  writeFileSync(
    join(dir, "CHANGELOG.md"),
    opts.changelog ?? "# Changelog\n\n## 0.1.0\n\nFirst release.\n",
  );
}

function run() {
  const result = spawnSync(
    "bun",
    [
      "scripts/make-release-files.ts",
      "--version",
      "0.1.0",
      "--repo",
      "owner/name",
      "--from",
      join(dir, "from"),
      "--to",
      join(dir, "to"),
      "--notes",
      join(dir, "notes.md"),
      "--changelog",
      join(dir, "CHANGELOG.md"),
      "--conf",
      join(dir, "tauri.conf.json"),
    ],
    { encoding: "utf8" },
  );
  return { code: result.status, out: `${result.stdout}${result.stderr}` };
}

describe("making a release's files", () => {
  beforeEach(() => setup());

  it("publishes the right files, a manifest that points at them, checksums and notes", () => {
    const { code, out } = run();
    expect(code, out).toBe(0);
    expect(readdirSync(join(dir, "to")).toSorted()).toEqual([
      "App.app.tar.gz",
      "App.app.tar.gz.sig",
      "App_0.1.0_aarch64.dmg",
      "App_0.1.0_arm64-setup.exe",
      "App_0.1.0_arm64-setup.exe.sig",
      "App_0.1.0_x64-setup.exe",
      "App_0.1.0_x64-setup.exe.sig",
      "SHA256SUMS",
      "latest.json",
    ]);
    const manifest = JSON.parse(readFileSync(join(dir, "to", "latest.json"), "utf8"));
    expect(manifest.version).toBe("0.1.0");
    expect(Object.keys(manifest.platforms)).toEqual([
      "darwin-aarch64",
      "windows-x86_64",
      "windows-aarch64",
    ]);
    expect(manifest.platforms["windows-x86_64"].url).toBe(
      "https://github.com/owner/name/releases/download/v0.1.0/App_0.1.0_x64-setup.exe",
    );
    expect(
      readFileSync(join(dir, "to", "SHA256SUMS"), "utf8")
        .trim()
        .split("\n"),
    ).toHaveLength(8);
    expect(readFileSync(join(dir, "notes.md"), "utf8")).toBe("First release.\n");
  });
});

describe("a release that must not be made", () => {
  it("is refused when a signature is by another key", () => {
    setup({ signedBy: newKey() });
    const { code, out } = run();
    expect(code).toBe(1);
    expect(out).toMatch(/signed with a different key/);
  });

  it("is refused when a signature is for another version, or records none", () => {
    setup({ signedFor: "0.0.9" });
    expect(run().out).toMatch(/signed for version 0\.0\.9/);
    setup({ signedFor: null });
    expect(run().out).toMatch(/none recorded/);
  });

  it("is refused when a platform's signature is missing", () => {
    setup({ dropSig: "App_0.1.0_arm64-setup.exe" });
    const { code, out } = run();
    expect(code).toBe(1);
    expect(out).toMatch(/arm64-setup\.exe/);
  });

  it("is refused when the changelog has no section for the version, and makes nothing", () => {
    setup({ changelog: "# Changelog\n\n## 0.0.9\n\nOld.\n" });
    const { code, out } = run();
    expect(code).toBe(1);
    expect(out).toMatch(/no section "## 0\.1\.0"/);
    expect(() => readdirSync(join(dir, "to"))).toThrow();
  });
});
