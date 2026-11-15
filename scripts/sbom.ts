// The release's software bill of materials (CycloneDX 1.5 JSON, DASA
// 1.5.1): every Rust crate and JavaScript package the app is built from,
// with its version, package URL, license and the hash its lockfile pins.
// Made by our own code from the lockfiles, not by a third-party generator,
// so nothing new runs in the release (owner, 2026-11-15). `make-sbom.ts`
// runs it; this file is the logic, tested in `sbom.test.ts`.

/** A CycloneDX component: one crate or package. */
export type Component = {
  type: "library" | "application";
  "bom-ref": string;
  name: string;
  version: string;
  purl: string;
  /** "required": in what ships; "excluded": only used to build it. */
  scope: "required" | "excluded";
  licenses?: { expression: string }[] | { license: { name: string } }[];
  hashes?: { alg: "SHA-256" | "SHA-512"; content: string }[];
};

/** A license as a CycloneDX licenses list: an SPDX expression when it is one. */
export function licenses(text: string | undefined): Component["licenses"] {
  const value = text?.trim();
  if (!value) return undefined;
  // Cargo's old form, "MIT/Apache-2.0", means either.
  const expression = value.replace(/\s*\/\s*/g, " OR ");
  return isExpression(expression) ? [{ expression }] : [{ license: { name: value } }];
}

/**
 * Whether `text` is shaped like an SPDX expression: identifiers joined by
 * OR, AND or WITH, with parentheses. "SEE LICENSE IN LICENSE.md" isn't.
 */
function isExpression(text: string): boolean {
  const tokens = text.replace(/[()]/g, " ").trim().split(/\s+/);
  const id = /^[A-Za-z0-9][A-Za-z0-9.+-]*$/;
  const op = /^(OR|AND|WITH)$/;
  return (
    tokens.every((t, i) => (i % 2 === 0 ? id.test(t) && !op.test(t) : op.test(t))) &&
    tokens.length % 2 === 1
  );
}

// ---------------------------------------------------------------- Rust

/** What `cargo metadata --format-version 1` says that this uses. */
export type CargoMetadata = {
  packages: {
    id: string;
    name: string;
    version: string;
    license: string | null;
    source: string | null;
  }[];
  resolve: {
    root: string | null;
    nodes: {
      id: string;
      deps: { pkg: string; dep_kinds: { kind: "dev" | "build" | null }[] }[];
    }[];
  };
};

/** Each crate's checksum in `Cargo.lock`, by "name version". */
export function cargoChecksums(lock: string): Map<string, string> {
  const sums = new Map<string, string>();
  for (const block of lock.split("[[package]]").slice(1)) {
    const field = (key: string) => block.match(new RegExp(`^${key} = "([^"]*)"`, "m"))?.[1];
    const name = field("name");
    const version = field("version");
    const checksum = field("checksum");
    if (name && version && checksum) sums.set(`${name} ${version}`, checksum);
  }
  return sums;
}

/**
 * The crates `root` is built from on any of the platforms `metadata` holds
 * (one `cargo metadata --filter-platform` each), leaving out dev-only
 * ones. A crate only build scripts use is "excluded".
 */
export function cargoComponents(
  metadata: CargoMetadata[],
  checksums: Map<string, string>,
  root: string,
): Component[] {
  const required = new Set<string>();
  const used = new Set<string>();
  const packages = new Map<string, CargoMetadata["packages"][number]>();
  for (const one of metadata) {
    for (const p of one.packages) packages.set(p.id, p);
    const edges = new Map(one.resolve.nodes.map((n) => [n.id, n.deps]));
    const rootId = one.packages.find((p) => p.name === root && p.source === null)?.id;
    if (!rootId) throw new Error(`cargo metadata has no local crate "${root}"`);
    // Everything reachable through normal and build edges is used; through
    // normal edges alone, from the root, it ships.
    // Each platform walks on its own, then joins the rest: a crate already
    // found for one platform doesn't stop the walk for another.
    const walk = (start: string, into: Set<string>, kinds: (k: string | null) => boolean) => {
      const seen = new Set<string>();
      const queue = [start];
      while (queue.length) {
        const id = queue.pop()!;
        if (seen.has(id)) continue;
        seen.add(id);
        into.add(id);
        for (const dep of edges.get(id) ?? []) {
          if (dep.dep_kinds.some((k) => kinds(k.kind))) queue.push(dep.pkg);
        }
      }
    };
    walk(rootId, required, (k) => k === null);
    walk(rootId, used, (k) => k !== "dev");
  }
  const out: Component[] = [];
  for (const id of used) {
    const p = packages.get(id)!;
    if (p.name === root && p.source === null) continue;
    const checksum = checksums.get(`${p.name} ${p.version}`);
    out.push({
      type: "library",
      "bom-ref": `pkg:cargo/${p.name}@${p.version}`,
      name: p.name,
      version: p.version,
      purl: `pkg:cargo/${p.name}@${p.version}`,
      scope: required.has(id) ? "required" : "excluded",
      licenses: licenses(p.license ?? undefined),
      hashes: checksum ? [{ alg: "SHA-256", content: checksum }] : undefined,
    });
  }
  return out;
}

// ---------------------------------------------------------- JavaScript

/** A `bun.lock`, parsed (it allows trailing commas: `Bun.JSONC`). */
export type BunLock = {
  workspaces: Record<
    string,
    { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
  >;
  /** By key ("name", or "parent/name" for a copy nested under another). */
  packages: Record<string, [string, string?, PackageMeta?, string?]>;
};
type PackageMeta = {
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

/** "@scope/name@1.2.3" as name and version. */
function splitNameVersion(text: string): { name: string; version: string } {
  const at = text.lastIndexOf("@");
  return { name: text.slice(0, at), version: text.slice(at + 1) };
}

/** A lock key's package names, outermost first: "a/@s/b" is ["a", "@s/b"]. */
function keyNames(key: string): string[] {
  const parts = key.split("/");
  const names: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    names.push(parts[i]!.startsWith("@") ? `${parts[i]}/${parts[++i]}` : parts[i]!);
  }
  return names;
}

/** A lock key's install folder: "a/@s/b" is node_modules/a/node_modules/@s/b. */
export function installPath(key: string): string {
  return keyNames(key)
    .map((n) => `node_modules/${n}`)
    .join("/");
}

/** "sha512-<base64>" as hex. */
function integrityHex(integrity: string | undefined): Component["hashes"] {
  const match = integrity?.match(/^sha512-(.+)$/);
  if (!match) return undefined;
  return [{ alg: "SHA-512", content: Buffer.from(match[1]!, "base64").toString("hex") }];
}

/**
 * Every package in `lock`. Those the app's own dependencies reach (not
 * its dev dependencies, which only build and test it) are "required".
 * `license(key)` reads an installed package's license, if it's there.
 */
export function npmComponents(
  lock: BunLock,
  license: (key: string) => string | undefined,
): Component[] {
  // The key a dependency of `from` resolves to: the nearest nested copy,
  // else the top-level one, as Node finds it.
  const resolve = (from: string, name: string): string | undefined => {
    const outer = from ? keyNames(from) : [];
    for (let depth = outer.length; depth >= 0; depth--) {
      const key = [...outer.slice(0, depth), name].join("/");
      if (lock.packages[key]) return key;
    }
    return undefined;
  };
  const required = new Set<string>();
  const queue = Object.keys(lock.workspaces[""]?.dependencies ?? {})
    .map((name) => resolve("", name))
    .filter((k): k is string => k !== undefined);
  while (queue.length) {
    const key = queue.pop()!;
    if (required.has(key)) continue;
    required.add(key);
    const meta = lock.packages[key]?.[2] ?? {};
    for (const deps of [meta.dependencies, meta.optionalDependencies, meta.peerDependencies]) {
      for (const name of Object.keys(deps ?? {})) {
        const next = resolve(key, name);
        if (next) queue.push(next);
      }
    }
  }
  const out: Component[] = [];
  const seen = new Set<string>();
  for (const [key, entry] of Object.entries(lock.packages)) {
    const { name, version } = splitNameVersion(entry[0]);
    // A workspace or linked package has no registry version.
    if (!/^\d/.test(version)) continue;
    const purl = `pkg:npm/${name.replace(/^@/, "%40")}@${version}`;
    if (seen.has(purl)) {
      // The same version installed twice: required if either copy is.
      if (required.has(key)) out.find((c) => c.purl === purl)!.scope = "required";
      continue;
    }
    seen.add(purl);
    out.push({
      type: "library",
      "bom-ref": purl,
      name,
      version,
      purl,
      scope: required.has(key) ? "required" : "excluded",
      licenses: licenses(license(key)),
      hashes: integrityHex(entry[3]),
    });
  }
  return out;
}

// --------------------------------------------------------------- The BOM

/** The whole document: the app, then its components sorted by package URL. */
export function bom(o: {
  name: string;
  version: string;
  components: Component[];
  timestamp: string;
  serial: string;
}) {
  const app = `pkg:generic/${o.name.toLowerCase()}@${o.version}`;
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
      },
    },
    components: o.components.toSorted((a, b) => a.purl.localeCompare(b.purl)),
  };
}
