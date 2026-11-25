// The pure parts of the AppImage's own bill of materials
// (make-appimage-sbom.ts): the AppImage carries copies of system libraries
// and WebKit's helper programs, which the app's bill (sbom.ts) doesn't list,
// since the .deb and .rpm take them from the system instead. Each bundled
// file is traced to the Ubuntu package it was copied from, with that
// package's version and the licenses its copyright file names.

/** One line of `dpkg -S` output: a package (with its architecture) owns a path. */
export type Owned = { package: string; arch: string | null; path: string };

/**
 * The owners `dpkg -S` printed (run with LC_ALL=C), each package of a
 * shared path on its own. Diversion lines (`diversion by dash from:
 * /bin/sh`) say where a file was moved, not who owns it, and are skipped.
 */
export function owned(dpkgSearch: string): Owned[] {
  const found: Owned[] = [];
  for (const line of dpkgSearch.split("\n")) {
    if (line.startsWith("diversion by ") || line.startsWith("local diversion")) continue;
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
 * A path as Ubuntu 22.04's merged /usr sees it: `/lib/x` and `/usr/lib/x`
 * are the same file (likewise `bin`, `sbin`, `lib64`).
 */
export function samePath(path: string): string {
  return path.replace(/^\/usr\/(lib|lib64|bin|sbin)\//, "/$1/");
}

/**
 * The package a bundled file came from. An owner of exactly `systemPath`
 * (or its merged-/usr twin) wins; otherwise (linuxdeploy moves libraries
 * into `usr/lib`) the owners of a file of the same name, debug copies left
 * out. They must come to one package; of a package installed for several
 * architectures, the build's own (`hostArch`), then `all`. Anything else
 * would be a guess, so it is an error. Null when no package owns one.
 */
export function pickOwner(candidates: Owned[], systemPath: string, hostArch: string): Owned | null {
  const exact = candidates.filter((c) => samePath(c.path) === samePath(systemPath));
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
  if (pool.length === 0) return null;
  const archs = [...new Set(pool.map((c) => c.arch))];
  if (archs.length === 1) return pool[0];
  const chosen =
    pool.find((c) => c.arch === hostArch) ?? pool.find((c) => c.arch === "all") ?? null;
  if (!chosen) {
    throw new Error(
      `${systemPath}: ${packages[0]} is installed for ${archs.join(", ")}, not ${hostArch}`,
    );
  }
  return chosen;
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
    components: [...components, ...runtimeParts()].toSorted((a, b) => a.purl.localeCompare(b.purl)),
  };
}

/**
 * What the pinned AppImage runtime (type2-runtime 20251108) links in
 * statically: its build's Makefile (`-lsquashfuse -lzstd -lz -lfuse3
 * -lmimalloc`, musl's libc) and scripts. squashfuse and libfuse are built
 * from versions its scripts pin, and zlib's version is in the runtime
 * itself; zstd, mimalloc and musl are Alpine 3.21 packages its build
 * doesn't pin, so their versions aren't known and are left out rather than
 * guessed. Update with the runtime (scripts/appimage-tools.sh).
 */
export const RUNTIME_PARTS: readonly {
  name: string;
  version: string | null;
  license: string;
  source: string;
}[] = [
  {
    name: "squashfuse",
    version: "0.5.2",
    license: "BSD-2-Clause",
    source: "pinned by the runtime's build",
  },
  {
    name: "libfuse",
    version: "3.15.0",
    license: "LGPL-2.1-only",
    source: "pinned by the runtime's build",
  },
  { name: "zlib", version: "1.3.1", license: "Zlib", source: "named in the runtime" },
  {
    name: "zstd",
    version: null,
    license: "BSD-3-Clause OR GPL-2.0-only",
    source: "Alpine 3.21 package, version not pinned",
  },
  {
    name: "mimalloc",
    version: null,
    license: "MIT",
    source: "Alpine 3.21 package, version not pinned",
  },
  {
    name: "musl",
    version: null,
    license: "MIT",
    source: "Alpine 3.21 package, version not pinned",
  },
];

/** The runtime's parts as components of the AppImage's bill. */
export function runtimeParts() {
  return RUNTIME_PARTS.map((p) => {
    const purl = `pkg:generic/appimage-runtime/${p.name}${p.version ? `@${p.version}` : ""}`;
    return {
      type: "library",
      "bom-ref": purl,
      name: p.name,
      // Left out of the JSON when not known.
      version: p.version ?? undefined,
      purl,
      scope: "required",
      licenses: [{ expression: p.license }],
      properties: [
        { name: "appimage:part", value: "runtime (statically linked)" },
        { name: "appimage:source", value: p.source },
      ],
    };
  });
}
