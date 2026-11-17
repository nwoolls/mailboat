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
  /**
   * "required": linked or bundled into the app; "optional": bundled, but
   * reached only through an optional dependency; "excluded": only used to
   * build it (build scripts, proc macros, dev tools).
   */
  scope: "required" | "optional" | "excluded";
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

/** An SPDX operator. */
const isOp = (t: string | undefined) => t === "AND" || t === "OR" || t === "WITH";

/**
 * Whether `text` follows SPDX's expression grammar: a license (an
 * identifier, optionally `WITH` an exception), several joined by `AND` or
 * `OR`, in balanced parentheses. "SEE LICENSE IN LICENSE.md",
 * "(MIT OR Apache-2.0" and npm's "UNLICENSED" (not an SPDX identifier, a
 * statement that no license is given) aren't.
 */
function isExpression(text: string): boolean {
  if (text.trim().toUpperCase() === "UNLICENSED") return false;
  const tokens = text.match(/\(|\)|[^\s()]+/g) ?? [];
  const id = /^[A-Za-z0-9][A-Za-z0-9.+-]*$/;
  let at = 0;
  // license := id ["WITH" id] | "(" expression ")"
  const license = (): boolean => {
    if (tokens[at] === "(") {
      at++;
      if (!expression() || tokens[at] !== ")") return false;
      at++;
      return true;
    }
    const t = tokens[at];
    if (t === undefined || isOp(t) || !id.test(t)) return false;
    at++;
    if (tokens[at] === "WITH") {
      at++;
      const exception = tokens[at];
      if (exception === undefined || isOp(exception) || !id.test(exception)) return false;
      at++;
    }
    return true;
  };
  // expression := license (("AND" | "OR") license)*
  const expression = (): boolean => {
    if (!license()) return false;
    while (tokens[at] === "AND" || tokens[at] === "OR") {
      at++;
      if (!license()) return false;
    }
    return true;
  };
  return expression() && at === tokens.length;
}

// ---------------------------------------------------------------- Rust

/**
 * A package URL's version, percent-encoded as the purl specification asks
 * (`1.1.8+spec-1.1.0` is `1.1.8%2Bspec-1.1.0`).
 */
export function purlVersion(version: string): string {
  return encodeURIComponent(version);
}

/**
 * A crate as one line of `cargo tree --prefix none --format "{p}\t{l}"`.
 * `source` is set for one from neither crates.io nor the app's own
 * folders (a git dependency, another registry).
 */
export type TreeCrate = {
  name: string;
  version: string;
  local: boolean;
  source?: string;
  license?: string;
};

/**
 * The crates in `cargo tree` output, once each. A local crate (the app's
 * own, shown with its folder) is marked so; repeats (`(*)`) are dropped.
 */
export function parseTree(output: string): TreeCrate[] {
  const crates = new Map<string, TreeCrate>();
  for (const line of output.split("\n")) {
    const [spec, license] = line.split("\t");
    const m = spec?.match(/^(\S+) v(\S+)(?: \(([^)]*)\))?/);
    if (!m) continue;
    const [, name, version, paren] = m;
    // A folder: "/…" on macOS and Linux, "C:\…" on Windows. Not
    // "(proc-macro)", and not a git or registry source.
    const local = paren !== undefined && (paren.startsWith("/") || /^[A-Za-z]:\\/.test(paren));
    const source = paren !== undefined && !local && paren !== "proc-macro" ? paren : undefined;
    const key = `${name} ${version}`;
    if (!crates.has(key)) {
      crates.set(key, {
        name: name!,
        version: version!,
        local,
        source,
        license: license?.replace(/\s*\(\*\)\s*$/, "").trim() || undefined,
      });
    }
  }
  return [...crates.values()];
}

/** Each crate's checksum in `Cargo.lock`, by "name version". */
export function cargoChecksums(lock: string): Map<string, string> {
  const sums = new Map<string, string>();
  for (const block of lock.split("[[package]]").slice(1)) {
    // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- `key` is one of three constant names
    const field = (key: string) => block.match(new RegExp(`^${key} = "([^"]*)"`, "m"))?.[1];
    const name = field("name");
    const version = field("version");
    const checksum = field("checksum");
    if (name && version && checksum) sums.set(`${name} ${version}`, checksum);
  }
  return sums;
}

/**
 * The app's crates on every platform the release builds, from `cargo tree`
 * as the build resolves them (features and platforms included): `linked`
 * holds each platform's `-e normal,no-proc-macro` output (linked into the
 * app: "required"), `used` its `-e normal,build` output (also proc macros
 * and build scripts' crates: "excluded" when not linked). The app's own
 * local crates are the application itself, not components. Only
 * crates.io crates are described: one from another source (git, another
 * registry) would need its own package URL and has no `Cargo.lock`
 * checksum to go by, so it stops the run until that is written.
 */
export function cargoComponents(
  linked: string[],
  used: string[],
  checksums: Map<string, string>,
): Component[] {
  const key = (c: TreeCrate) => `${c.name} ${c.version}`;
  const shipped = new Set(linked.flatMap(parseTree).map(key));
  const all = new Map<string, TreeCrate>();
  for (const c of [...linked, ...used].flatMap(parseTree)) if (!all.has(key(c))) all.set(key(c), c);
  const out: Component[] = [];
  for (const c of all.values()) {
    if (c.local) continue;
    if (c.source) {
      throw new Error(`${c.name} ${c.version} comes from ${c.source}, which isn't crates.io`);
    }
    const purl = `pkg:cargo/${c.name}@${purlVersion(c.version)}`;
    const checksum = checksums.get(key(c));
    out.push({
      type: "library",
      "bom-ref": purl,
      name: c.name,
      version: c.version,
      purl,
      scope: shipped.has(key(c)) ? "required" : "excluded",
      licenses: licenses(c.license),
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
 * its dev dependencies, which only build and test it) are "required", or
 * "optional" when only an optional dependency reaches them.
 * `license(key)` reads an installed package's license, if it's there: a
 * platform's binary package that isn't installed on this computer has none.
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
  // From `starts`, through `dependencies` (and `optionalDependencies` if
  // asked), every key reached. Peer dependencies are the user's to supply:
  // one that ships is also somebody's dependency, and is reached that way.
  const reach = (starts: string[], optional: boolean): Set<string> => {
    const found = new Set<string>();
    const queue = [...starts];
    while (queue.length) {
      const key = queue.pop()!;
      if (found.has(key)) continue;
      found.add(key);
      const meta = lock.packages[key]?.[2] ?? {};
      for (const deps of [meta.dependencies, optional ? meta.optionalDependencies : undefined]) {
        for (const name of Object.keys(deps ?? {})) {
          const next = resolve(key, name);
          if (next) queue.push(next);
        }
      }
    }
    return found;
  };
  const roots = Object.keys(lock.workspaces[""]?.dependencies ?? {})
    .map((name) => resolve("", name))
    .filter((k): k is string => k !== undefined);
  const required = reach(roots, false);
  const optional = reach(roots, true);
  const scopeOf = (key: string): Component["scope"] =>
    required.has(key) ? "required" : optional.has(key) ? "optional" : "excluded";
  const rank = { required: 2, optional: 1, excluded: 0 };
  const out: Component[] = [];
  const seen = new Set<string>();
  for (const [key, entry] of Object.entries(lock.packages)) {
    const { name, version } = splitNameVersion(entry[0]);
    // A workspace or linked package has no registry version.
    if (!/^\d/.test(version)) continue;
    const purl = `pkg:npm/${name.replace(/^@/, "%40")}@${purlVersion(version)}`;
    if (seen.has(purl)) {
      // The same version installed twice: the wider scope of the two.
      const first = out.find((c) => c.purl === purl)!;
      if (rank[scopeOf(key)] > rank[first.scope]) first.scope = scopeOf(key);
      continue;
    }
    seen.add(purl);
    out.push({
      type: "library",
      "bom-ref": purl,
      name,
      version,
      purl,
      scope: scopeOf(key),
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
  /** The Rust target of the download this describes (`aarch64-apple-darwin`). */
  target: string;
  components: Component[];
  timestamp: string;
  serial: string;
}) {
  const app = `pkg:generic/${o.name.toLowerCase()}@${o.version}?target=${o.target}`;
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
        properties: [{ name: "build:target", value: o.target }],
      },
    },
    components: o.components.toSorted((a, b) => a.purl.localeCompare(b.purl)),
  };
}
