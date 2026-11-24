import { generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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

const LINUX = [
  "App_0.1.0_amd64.AppImage",
  "App_0.1.0_amd64.deb",
  "App-0.1.0-1.x86_64.rpm",
  "App_0.1.0_aarch64.AppImage",
  "App_0.1.0_arm64.deb",
  "App-0.1.0-1.aarch64.rpm",
];
const PAYLOADS = [
  "App.app.tar.gz",
  "App_0.1.0_x64-setup.exe",
  "App_0.1.0_arm64-setup.exe",
  ...LINUX,
];
/** One bill of materials per download (Linux: one per processor). */
const SBOMS = [
  "App_0.1.0_aarch64.cdx.json",
  "App_0.1.0_x64.cdx.json",
  "App_0.1.0_arm64.cdx.json",
  "App_0.1.0_linux_amd64.cdx.json",
  "App_0.1.0_linux_arm64.cdx.json",
  "App_0.1.0_linux_amd64.AppImage.cdx.json",
  "App_0.1.0_linux_arm64.AppImage.cdx.json",
];
const LINUX_STABLE = [
  "App_amd64.AppImage",
  "App_amd64.deb",
  "App-x86_64.rpm",
  "App_aarch64.AppImage",
  "App_arm64.deb",
  "App-aarch64.rpm",
];

let dir: string;
let key: Key;

/** A folder of build outputs as the workflow's jobs leave them. */
function setup(
  opts: {
    signedBy?: Key;
    signedFor?: string | null;
    dropSig?: string;
    changelog?: string;
    sboms?: string[];
  } = {},
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
  for (const name of opts.sboms ?? SBOMS) writeFileSync(from(name), "{}");
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
    { encoding: "utf8", cwd: join(__dirname, "..") },
  );
  return { code: result.status, out: `${result.stdout}${result.stderr}` };
}

describe("making a release's files", () => {
  beforeEach(() => setup());

  it("publishes the right files, a manifest that points at them, checksums and notes", () => {
    const { code, out } = run();
    expect(code, out).toBe(0);
    expect(readdirSync(join(dir, "to")).toSorted()).toEqual(
      [
        "App.app.tar.gz",
        "App.app.tar.gz.sig",
        "App_0.1.0_aarch64.dmg",
        "App_0.1.0_arm64-setup.exe",
        "App_0.1.0_arm64-setup.exe.sig",
        "App_0.1.0_x64-setup.exe",
        "App_0.1.0_x64-setup.exe.sig",
        ...SBOMS,
        ...LINUX,
        ...LINUX.map((f) => `${f}.sig`),
        "App_aarch64.dmg",
        "App_arm64-setup.exe",
        "App_x64-setup.exe",
        ...LINUX_STABLE,
        "SHA256SUMS",
        "latest.json",
      ].toSorted(),
    );
    const manifest = JSON.parse(readFileSync(join(dir, "to", "latest.json"), "utf8"));
    expect(manifest.version).toBe("0.1.0");
    expect(Object.keys(manifest.platforms)).toEqual([
      "darwin-aarch64",
      "windows-x86_64",
      "windows-aarch64",
      "linux-x86_64-appimage",
      "linux-x86_64-deb",
      "linux-x86_64-rpm",
      "linux-aarch64-appimage",
      "linux-aarch64-deb",
      "linux-aarch64-rpm",
    ]);
    expect(manifest.platforms["linux-aarch64-deb"].url).toBe(
      "https://github.com/owner/name/releases/download/v0.1.0/App_0.1.0_arm64.deb",
    );
    expect(manifest.platforms["windows-x86_64"].url).toBe(
      "https://github.com/owner/name/releases/download/v0.1.0/App_0.1.0_x64-setup.exe",
    );
    expect(
      readFileSync(join(dir, "to", "SHA256SUMS"), "utf8")
        .trim()
        .split("\n"),
    ).toHaveLength(14 + 4 + 3 * LINUX.length);
    expect(readFileSync(join(dir, "notes.md"), "utf8")).toBe("First release.\n");
  });

  it("copies the installers under version-free names, with the same bytes, and keeps them out of the manifest", () => {
    expect(run().code).toBe(0);
    const to = (f: string) => readFileSync(join(dir, "to", f));
    for (const [stable, versioned] of [
      ["App_aarch64.dmg", "App_0.1.0_aarch64.dmg"],
      ["App_x64-setup.exe", "App_0.1.0_x64-setup.exe"],
      ["App_arm64-setup.exe", "App_0.1.0_arm64-setup.exe"],
      ...LINUX_STABLE.map((name, i) => [name, LINUX[i]]),
    ]) {
      expect(to(stable).equals(to(versioned)), stable).toBe(true);
    }
    // the updater still points at the versioned files, and the sums list the copies
    const manifest = readFileSync(join(dir, "to", "latest.json"), "utf8");
    expect(manifest).not.toContain("App_x64-setup.exe");
    expect(manifest).not.toContain("App_arm64-setup.exe");
    const sums = readFileSync(join(dir, "to", "SHA256SUMS"), "utf8");
    for (const stable of [
      "App_aarch64.dmg",
      "App_x64-setup.exe",
      "App_arm64-setup.exe",
      ...LINUX_STABLE,
    ]) {
      expect(manifest).not.toContain(`/${stable}"`);
      expect(sums).toContain(`  ${stable}\n`);
    }
    // the update tarball and the signatures get no copy
    expect(
      readdirSync(join(dir, "to")).filter((f) => f.includes("tar.gz") || f.endsWith(".sig")),
    ).toHaveLength(4 + LINUX.length);
  });
});

describe("a release that must not be made", () => {
  it("is refused, making nothing, when an installer's name has no version to take out", () => {
    setup();
    renameSync(join(dir, "from", "App_0.1.0_aarch64.dmg"), join(dir, "from", "App_aarch64.dmg"));
    const { code, out } = run();
    expect(code).toBe(1);
    expect(out).toContain("doesn't contain");
    expect(out).toContain("App_aarch64.dmg");
    expect(() => readdirSync(join(dir, "to"))).toThrow();
  });

  it("is refused, making nothing, when a version-free name would overwrite another file", () => {
    setup();
    // a doubled version: its version-free name is the other disk image's own name
    writeFileSync(join(dir, "from", "App_0.1.0_0.1.0_aarch64.dmg"), "another disk image");
    const { code, out } = run();
    expect(code).toBe(1);
    expect(out).toContain("would be copied over another file");
    expect(() => readdirSync(join(dir, "to"))).toThrow();
  });

  it("is refused when the version in the tag is not the one in the file names (a build-metadata version)", () => {
    setup();
    for (const f of readdirSync(join(dir, "from")))
      renameSync(join(dir, "from", f), join(dir, "from", f.replace("_0.1.0_", "_0.1.0+build.5_")));
    const { code, out } = run();
    expect(code, out).toBe(1);
    expect(out).toContain("doesn't contain the version (0.1.0)");
  });

  it("is refused, making nothing, when one of the installers is missing", () => {
    setup();
    rmSync(join(dir, "from", "App_0.1.0_aarch64.dmg"));
    const { code, out } = run();
    expect(code).toBe(1);
    expect(out).toContain("no installer ending in .dmg");
    expect(() => readdirSync(join(dir, "to"))).toThrow();
  });

  it("is refused, making nothing, without one bill of materials per download for this version", () => {
    for (const sboms of [
      [],
      // The single file releases had before 0.3.0.
      ["App_0.1.0.cdx.json"],
      SBOMS.slice(1),
      SBOMS.map((f) => f.replace("0.1.0", "0.0.9")),
      [...SBOMS, "Other_0.1.0_x64.cdx.json"],
    ]) {
      setup({ sboms });
      const { code, out } = run();
      expect(code, sboms.join()).toBe(1);
      expect(out).toMatch(/software bill of materials/);
      expect(() => readdirSync(join(dir, "to"))).toThrow();
    }
  });

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
