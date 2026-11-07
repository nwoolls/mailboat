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

/**
 * Which platform's update payload a build output is, or null if it isn't one:
 * the Mac app's tarball, and each Windows installer (the updater runs the
 * installer itself).
 */
export function platformOf(file: string): Platform | null {
  if (file.endsWith(".app.tar.gz")) return "darwin-aarch64";
  if (file.endsWith("_x64-setup.exe")) return "windows-x86_64";
  if (file.endsWith("_arm64-setup.exe")) return "windows-aarch64";
  return null;
}

/**
 * Whether a build output goes on the release: the disk image, each update
 * payload with its signature, and each Windows installer. Not the ditto zip
 * the Mac job keeps for checking.
 */
export function publishable(file: string): boolean {
  if (file.endsWith(".dmg")) return true;
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
  const installer =
    file.endsWith(".dmg") || file.endsWith("_x64-setup.exe") || file.endsWith("_arm64-setup.exe");
  const marker = `_${version}_`;
  if (!installer || !file.includes(marker)) return null;
  return file.replace(marker, "_");
}

const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
/** What a minisign signature file holds once its line breaks are taken off: base64. */
const SIGNATURE = /^[A-Za-z0-9+/]+=*$/;

export function isVersion(text: string): boolean {
  return SEMVER.test(text);
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
