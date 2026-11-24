// The pure parts of the AppImage's own bill of materials
// (make-appimage-sbom.ts): the AppImage carries copies of system libraries
// and WebKit's helper programs, which the app's bill (sbom.ts) doesn't list,
// since the .deb and .rpm take them from the system instead. Each bundled
// file is traced to the Ubuntu package it was copied from, with that
// package's version and the licenses its copyright file names.

/** One line of `dpkg -S` output: a package (with its architecture) owns a path. */
export type Owned = { package: string; arch: string | null; path: string };

/** The owners `dpkg -S` printed, each package of a shared path on its own. */
export function owned(dpkgSearch: string): Owned[] {
  const found: Owned[] = [];
  for (const line of dpkgSearch.split("\n")) {
    const at = line.lastIndexOf(": ");
    if (at === -1) continue;
    const path = line.slice(at + 2).trim();
    for (const entry of line.slice(0, at).split(",")) {
      const [pkg, arch] = entry.trim().split(":");
      if (pkg) found.push({ package: pkg, arch: arch ?? null, path });
    }
  }
  return found;
}

/**
 * The package a bundled file came from. An owner of exactly `systemPath`
 * wins; otherwise (linuxdeploy moves libraries into `usr/lib`) the owners of
 * a file of the same name, debug copies left out, which must be one package:
 * two would be a guess, so that is an error. Null when no package owns one.
 */
export function pickOwner(candidates: Owned[], systemPath: string): Owned | null {
  const exact = candidates.filter((c) => c.path === systemPath);
  const name = systemPath.split("/").pop();
  const pool = exact.length
    ? exact
    : candidates.filter(
        (c) => c.path.split("/").pop() === name && !c.path.startsWith("/usr/lib/debug/"),
      );
  const packages = [...new Set(pool.map((c) => c.package))];
  if (packages.length > 1) {
    throw new Error(`${systemPath}: more than one package has it (${packages.join(", ")})`);
  }
  return pool[0] ?? null;
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
  /** The package's architecture (`arm64`, `all`), when it has one. */
  arch?: string | null;
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
    const tool = b.files[0].split("/").pop()!;
    const purl = b.package
      ? `pkg:deb/ubuntu/${b.package}@${encodeURIComponent(b.version ?? "")}?arch=${b.arch ?? o.arch}&distro=ubuntu-22.04`
      : `pkg:generic/appimage-tools/${tool}${b.version ? `@${b.version}` : ""}`;
    return {
      type: b.package ? "library" : "application",
      "bom-ref": purl,
      name: b.package ?? tool,
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
