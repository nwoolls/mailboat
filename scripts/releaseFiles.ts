// The pure parts of making a release's files (the command that uses them is
// make-release-files.ts, run by the release workflow): which build outputs are
// update payloads and for which platform, the `latest.json` the app's updater
// reads, the checksums file, and the release notes from CHANGELOG.md.

/** The platforms the updater has a payload for, as its manifest names them. */
export type Platform = "darwin-aarch64" | "windows-x86_64" | "windows-aarch64";

export const PLATFORMS: readonly Platform[] = [
  "darwin-aarch64",
  "windows-x86_64",
  "windows-aarch64",
];

/** How each payload's name ends, as Tauri names them, and its platform. */
const PAYLOADS: readonly (readonly [ending: string, platform: Platform])[] = [
  [".app.tar.gz", "darwin-aarch64"],
  ["_x64-setup.exe", "windows-x86_64"],
  ["_arm64-setup.exe", "windows-aarch64"],
];

/**
 * Which platform's update payload a build output is, or null if it isn't one:
 * the Mac app's tarball, and each Windows installer (the updater runs the
 * installer itself).
 * It reads the build's own versioned names; the version-free copies of the
 * installers (see `stableName`) are made afterwards, in another folder, and
 * are never passed through here.
 */
export function platformOf(file: string): Platform | null {
  return PAYLOADS.find(([ending]) => file.endsWith(ending))?.[1] ?? null;
}

/**
 * Whether a build output goes on the release: the disk image, each update
 * payload with its signature, each Windows installer, and the software bill
 * of materials (`*.cdx.json`). Not the ditto zip the Mac job keeps for
 * checking.
 */
export function publishable(file: string): boolean {
  if (file.endsWith(".dmg") || isSbom(file)) return true;
  const payload = file.endsWith(".sig") ? file.slice(0, -".sig".length) : file;
  return platformOf(payload) !== null;
}

/**
 * The name a person's download link can rely on: the installer's file name
 * with the version taken out (`App_0.1.0_x64-setup.exe` is `App_x64-setup.exe`),
 * so `releases/latest/download/<this name>` is always the newest one. Only the
 * disk image and the two Windows installers have one. The update files keep
 * their versioned names, because the manifest points at them.
 */
export function stableName(file: string, version: string): string | null {
  const marker = `_${version}_`;
  if (!isInstaller(file) || !file.includes(marker)) return null;
  return file.replace(marker, "_");
}

/** A software bill of materials (`make-sbom.ts`). */
export function isSbom(file: string): boolean {
  return file.endsWith(".cdx.json");
}

/**
 * The downloads that each get a software bill of materials: the update
 * platforms it covers, its Rust target, the word its files end with
 * (`App_0.1.0_aarch64.dmg`, `App_0.1.0_x64-setup.exe`), so each bill of
 * materials sits beside the download it describes, and the system that
 * makes it (`host`, as `process.platform` names it): the crates a build
 * script uses follow the computer that builds, so each is made where its
 * download is built (the Mac's and Windows' on a Mac, Windows cross-built
 * there).
 */
export const SBOM_DOWNLOADS = [
  {
    platforms: ["darwin-aarch64"],
    target: "aarch64-apple-darwin",
    suffix: "aarch64",
    host: "darwin",
  },
  {
    platforms: ["windows-x86_64"],
    target: "x86_64-pc-windows-msvc",
    suffix: "x64",
    host: "darwin",
  },
  {
    platforms: ["windows-aarch64"],
    target: "aarch64-pc-windows-msvc",
    suffix: "arm64",
    host: "darwin",
  },
] as const satisfies readonly {
  platforms: readonly Platform[];
  target: string;
  suffix: string;
  host: string;
  arch?: string;
}[];

/**
 * The bills of materials made on this kind of computer (`process.platform`
 * and `process.arch`): the build tools' crates depend on it.
 */
export function sbomDownloadsBuiltOn(platform: string, arch: string) {
  return SBOM_DOWNLOADS.filter((d) => d.host === platform && (!("arch" in d) || d.arch === arch));
}

/** A download's bill of materials: `App_0.1.0_aarch64.cdx.json`. */
export function sbomName(app: string, version: string, download: { suffix: string }): string {
  return `${app}_${version}_${download.suffix}.cdx.json`;
}

/**
 * What's wrong with a release's bills of materials, or null: there must be
 * one per download for this version (`SBOM_DOWNLOADS`), and no others.
 */
export function sbomProblem(files: string[], app: string, version: string): string | null {
  const sboms = files.filter(isSbom).toSorted();
  const want = SBOM_DOWNLOADS.map((d) => sbomName(app, version, d)).toSorted();
  if (sboms.length === want.length && sboms.every((f, i) => f === want[i])) return null;
  return `expected a software bill of materials for each download of ${version} (${want.join(", ")}), found: ${sboms.join(", ") || "none"}`;
}

/** The disk image and the two Windows installers: what a person downloads. */
export function isInstaller(file: string): boolean {
  return INSTALLER_ENDINGS.some((ending) => file.endsWith(ending));
}

/** How the three installers' names end; a release must have one of each. */
export const INSTALLER_ENDINGS = [".dmg", "_x64-setup.exe", "_arm64-setup.exe"] as const;

const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
/** What a minisign signature file holds once its line breaks are taken off: base64. */
const SIGNATURE = /^[A-Za-z0-9+/]+=*$/;

export function isVersion(text: string): boolean {
  return SEMVER.test(text);
}

/** A version's numeric core and pre-release parts (build metadata dropped). */
function split(v: string) {
  const [core, pre] = v.split("+")[0].split("-", 2);
  return { core: core.split(".").map(Number), pre: pre === undefined ? null : pre.split(".") };
}

/**
 * Semver order: negative when `a` is older than `b`. A pre-release is older
 * than its release (0.2.0-beta.2 < 0.2.0), numeric parts compare as numbers,
 * and 0.2.0-beta.2 < 0.2.0-beta.10.
 */
export function compareVersions(a: string, b: string): number {
  const x = split(a);
  const y = split(b);
  for (let i = 0; i < 3; i++) {
    if (x.core[i] !== y.core[i]) return x.core[i] < y.core[i] ? -1 : 1;
  }
  if (x.pre === null || y.pre === null) return x.pre === y.pre ? 0 : x.pre === null ? 1 : -1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn) return Number(p) < Number(q) ? -1 : 1;
    if (pn !== qn) return pn ? -1 : 1;
    return p < q ? -1 : 1;
  }
  return 0;
}

/** A pre-release (0.2.0-beta.1) is published as one, so it isn't "latest". */
export function isPrerelease(version: string): boolean {
  return version.includes("-");
}

/** The tag for a version: `v` and the version, nothing else. */
export function tagFor(version: string): string {
  return `v${version}`;
}

/** The address a release asset is downloaded from, which `latest.json` points at. */
export function assetUrl(repo: string, version: string, file: string): string {
  return `https://github.com/${repo}/releases/download/${tagFor(version)}/${encodeURIComponent(file)}`;
}

export type Manifest = {
  version: string;
  pub_date: string;
  platforms: Record<Platform, { signature: string; url: string }>;
};

/**
 * The manifest the app's updater reads (`latest.json`). Every platform must be
 * there exactly once, with its signature, or nothing is made: a manifest that
 * left a platform out would tell those people there is no update. It carries
 * no release notes: the app shows none, because only the download is signed.
 */
export function buildManifest(input: {
  version: string;
  repo: string;
  pubDate: Date;
  files: { file: string; signature: string }[];
}): Manifest {
  if (!isVersion(input.version)) throw new Error(`"${input.version}" isn't a version like 1.2.3`);
  if (!REPO.test(input.repo)) throw new Error(`"${input.repo}" isn't a repository like owner/name`);
  const found = new Map<Platform, { signature: string; url: string }>();
  for (const { file, signature } of input.files) {
    const platform = platformOf(file);
    if (platform === null) continue;
    if (found.has(platform)) throw new Error(`Two files are the update for ${platform}`);
    const clean = signature.replace(/\s+/g, "");
    if (!SIGNATURE.test(clean)) throw new Error(`The signature for ${file} isn't base64 text`);
    found.set(platform, { signature: clean, url: assetUrl(input.repo, input.version, file) });
  }
  const missing = PLATFORMS.filter((p) => !found.has(p));
  if (missing.length > 0) throw new Error(`No update file for ${missing.join(", ")}`);
  return {
    version: input.version,
    pub_date: input.pubDate.toISOString(),
    platforms: Object.fromEntries(
      PLATFORMS.map((p) => [p, found.get(p)!]),
    ) as Manifest["platforms"],
  };
}

/** SHA256SUMS: one `hash  file` line per file, in file-name order, as `shasum -c` reads. */
export function checksumLines(entries: { file: string; sha256: string }[]): string {
  const sorted = entries.toSorted((a, b) => a.file.localeCompare(b.file));
  return sorted.map((e) => `${e.sha256}  ${e.file}`).join("\n") + "\n";
}

/**
 * The section of CHANGELOG.md for one version (the lines under its `## `
 * heading, up to the next one), trimmed, or null if there is none or it is empty.
 */
export function changelogSection(changelog: string, version: string): string | null {
  const lines = changelog.split("\n");
  const start = lines.findIndex((l) => l.trim() === `## ${version}`);
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith("## "));
  const section = (end === -1 ? rest : rest.slice(0, end)).join("\n").trim();
  return section === "" ? null : section;
}

/**
 * Why a tag can't release this version, or null if it can: the tag is `v` and
 * the version in package.json, and CHANGELOG.md has a section for it (so the
 * release notes are written before anything is built).
 */
export function tagProblem(tag: string, version: string, changelog: string): string | null {
  if (!isVersion(version)) return `package.json's version "${version}" isn't a version like 1.2.3`;
  if (tag !== tagFor(version)) {
    return `The tag is ${tag}, but package.json says ${version}: the tag for that is ${tagFor(version)}`;
  }
  if (changelogSection(changelog, version) === null) {
    return `CHANGELOG.md has no section "## ${version}": write the release notes before tagging`;
  }
  return null;
}

/**
 * The in-toto lines Scorecard looks for in a release (`*.intoto.jsonl`)
 * from the Sigstore bundle `actions/attest-build-provenance` writes: one
 * bundle per line, each holding its signed statement as a DSSE envelope
 * (`payload`, `payloadType`, `signatures`). Each envelope becomes a line of
 * compact JSON, as tools reading in-toto files expect. A line without a
 * whole envelope is an error, so a changed bundle format can't publish an
 * empty or broken file.
 */
export function intotoLines(bundle: string): string {
  const lines = bundle.split("\n").filter((line) => line.trim() !== "");
  if (lines.length === 0) throw new Error("the attestation bundle is empty");
  return lines
    .map((line, i) => {
      const envelope = JSON.parse(line)?.dsseEnvelope;
      if (
        typeof envelope?.payload !== "string" ||
        typeof envelope?.payloadType !== "string" ||
        !Array.isArray(envelope?.signatures) ||
        envelope.signatures.length === 0 ||
        !envelope.signatures.every(
          (s: { sig?: unknown } | null) => typeof s?.sig === "string" && s.sig !== "",
        )
      ) {
        throw new Error(`line ${i + 1} of the attestation bundle has no signed DSSE envelope`);
      }
      return JSON.stringify({
        payloadType: envelope.payloadType,
        payload: envelope.payload,
        signatures: envelope.signatures,
      });
    })
    .map((line) => `${line}\n`)
    .join("");
}
