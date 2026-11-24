// The pure parts of the AppImage's own bill of materials
// (make-appimage-sbom.ts): the AppImage carries copies of system libraries
// and WebKit's helper programs, which the app's bill (sbom.ts) doesn't list,
// since the .deb and .rpm take them from the system instead. Each bundled
// file is traced to the Ubuntu package it was copied from, with that
// package's version and the licenses its copyright file names.

/** The package that owns `path`, from `dpkg -S` output, or null. */
export function owner(dpkgSearch: string, path: string): string | null {
  for (const line of dpkgSearch.split("\n")) {
    const at = line.lastIndexOf(": ");
    if (at === -1) continue;
    const packages = line.slice(0, at);
    const owned = line.slice(at + 2).trim();
    if (owned === path || owned.endsWith(`/${path.split("/").pop()}`)) {
      // `pkg:arch` (several when shared, comma-separated): the first.
      return packages.split(",")[0].trim().split(":")[0];
    }
  }
  return null;
}

/**
 * The licenses a Debian copyright file names (`License:` fields, the
 * machine-readable format), each once, in order. An older free-form file
 * names none.
 */
export function copyrightLicenses(copyright: string): string[] {
  const found: string[] = [];
  for (const line of copyright.split("\n")) {
    const m = /^License:\s*(\S.*)$/.exec(line);
    if (m && !found.includes(m[1].trim())) found.push(m[1].trim());
  }
  return found;
}

export type Bundled = {
  /** The Ubuntu package, or null for a file of the AppImage's own tools. */
  package: string | null;
  version: string | null;
  licenses: string[];
  /** The files in the AppImage it accounts for. */
  files: string[];
  /** For a tools file: its SHA-256. */
  sha256?: string;
};

/** The AppImage's bill: the app, then each package or tools file. */
export function appimageBom(o: {
  name: string;
  version: string;
  arch: string;
  bundled: Bundled[];
  timestamp: string;
  serial: string;
}) {
  const app = `pkg:generic/${o.name.toLowerCase()}@${o.version}?type=appimage&arch=${o.arch}`;
  const components = o.bundled.map((b) => {
    const purl = b.package
      ? `pkg:deb/ubuntu/${b.package}@${encodeURIComponent(b.version ?? "")}?arch=${o.arch}&distro=ubuntu-22.04`
      : `pkg:generic/appimage-tools/${b.files[0].split("/").pop()}`;
    return {
      type: b.package ? "library" : "application",
      "bom-ref": purl,
      name: b.package ?? b.files[0].split("/").pop()!,
      ...(b.version ? { version: b.version } : {}),
      purl,
      scope: "required",
      ...(b.licenses.length ? { licenses: b.licenses.map((name) => ({ license: { name } })) } : {}),
      ...(b.sha256 ? { hashes: [{ alg: "SHA-256", content: b.sha256 }] } : {}),
      properties: b.files.map((value) => ({ name: "appimage:file", value })),
    };
  });
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    serialNumber: `urn:uuid:${o.serial}`,
    version: 1,
    metadata: {
      timestamp: o.timestamp,
      component: {
        type: "application",
        "bom-ref": app,
        name: o.name,
        version: o.version,
        licenses: [{ expression: "GPL-3.0-only" }],
        properties: [{ name: "build:package", value: "appimage" }],
      },
    },
    components: components.toSorted((a, b) => a.purl.localeCompare(b.purl)),
  };
}
