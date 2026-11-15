import { describe, expect, it } from "vitest";
import {
  bom,
  type BunLock,
  type CargoMetadata,
  cargoChecksums,
  cargoComponents,
  installPath,
  licenses,
  npmComponents,
} from "./sbom";

describe("licenses", () => {
  it("keeps SPDX expressions, and reads Cargo's old slash as OR", () => {
    expect(licenses("MIT")).toEqual([{ expression: "MIT" }]);
    expect(licenses("MIT/Apache-2.0")).toEqual([{ expression: "MIT OR Apache-2.0" }]);
    expect(licenses("(MIT OR Apache-2.0) AND Unicode-3.0")).toEqual([
      { expression: "(MIT OR Apache-2.0) AND Unicode-3.0" },
    ]);
    expect(licenses("Apache-2.0 WITH LLVM-exception")).toEqual([
      { expression: "Apache-2.0 WITH LLVM-exception" },
    ]);
  });

  it("names anything else, and has nothing to say for nothing", () => {
    expect(licenses("SEE LICENSE IN LICENSE.md")).toEqual([
      { license: { name: "SEE LICENSE IN LICENSE.md" } },
    ]);
    expect(licenses(undefined)).toBeUndefined();
    expect(licenses("  ")).toBeUndefined();
  });
});

/** A crate as `cargo metadata` lists it (the app and its core are local). */
const pkg = (name: string, license: string | null = "MIT") => ({
  id: `${name}-id`,
  name,
  version: "1.0.0",
  license,
  source: name === "desktop" || name === "mail-core" ? null : "registry+…",
});
const dep = (name: string, kind: "dev" | "build" | null = null) => ({
  pkg: `${name}-id`,
  dep_kinds: [{ kind }],
});

describe("Rust crates", () => {
  const lock = `
version = 4

[[package]]
name = "alpha"
version = "1.0.0"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "aaaa"

[[package]]
name = "desktop"
version = "0.0.0"
`;
  // macOS: alpha (normal), cc (build only), tester (dev only), mail-core.
  const mac: CargoMetadata = {
    packages: ["desktop", "mail-core", "alpha", "cc", "tester"].map((n) => pkg(n)),
    resolve: {
      root: null,
      nodes: [
        { id: "desktop-id", deps: [dep("mail-core"), dep("cc", "build"), dep("tester", "dev")] },
        { id: "mail-core-id", deps: [dep("alpha")] },
      ],
    },
  };
  // Windows adds a crate only it uses, through mail-core.
  const windows: CargoMetadata = {
    packages: ["desktop", "mail-core", "alpha", "winonly"].map((n) => pkg(n)),
    resolve: {
      root: null,
      nodes: [
        { id: "desktop-id", deps: [dep("mail-core")] },
        { id: "mail-core-id", deps: [dep("alpha"), dep("winonly")] },
      ],
    },
  };

  it("reads each crate's checksum from Cargo.lock", () => {
    expect(cargoChecksums(lock)).toEqual(new Map([["alpha 1.0.0", "aaaa"]]));
  });

  it("lists every platform's crates, build-only ones as such, and no dev-only ones", () => {
    const sums = new Map([["alpha 1.0.0", "aaaa"]]);
    const found = cargoComponents([mac, windows], sums, "desktop");
    const byName = Object.fromEntries(found.map((c) => [c.name, c]));
    // Review of the first version: a crate only the second platform uses
    // was missed, because the walk stopped at a root already seen.
    expect(Object.keys(byName).toSorted()).toEqual(["alpha", "cc", "mail-core", "winonly"]);
    expect(byName.alpha).toMatchObject({
      purl: "pkg:cargo/alpha@1.0.0",
      scope: "required",
      licenses: [{ expression: "MIT" }],
      hashes: [{ alg: "SHA-256", content: "aaaa" }],
    });
    expect(byName.cc!.scope).toBe("excluded");
    expect(byName.winonly!.scope).toBe("required");
    expect(byName["mail-core"]!.hashes).toBeUndefined();
  });

  it("fails without the app's own crate", () => {
    expect(() => cargoComponents([mac], new Map(), "elsewhere")).toThrow(/no local crate/);
  });
});

describe("JavaScript packages", () => {
  const sha = Buffer.from("hash").toString("base64");
  const lock: BunLock = {
    workspaces: {
      "": {
        dependencies: { react: "^19", "@scope/ui": "^1" },
        devDependencies: { vite: "^8" },
      },
    },
    packages: {
      react: ["react@19.0.0", "", {}, `sha512-${sha}`],
      "@scope/ui": ["@scope/ui@1.0.0", "", { dependencies: { tslib: "^1" } }, `sha512-${sha}`],
      // The UI library has its own copy of tslib, nested under it.
      "@scope/ui/tslib": ["tslib@1.0.0", "", {}, `sha512-${sha}`],
      tslib: ["tslib@2.0.0", "", {}, `sha512-${sha}`],
      vite: ["vite@8.0.0", "", { dependencies: { tslib: "^2" } }, `sha512-${sha}`],
      desktop: ["desktop@workspace:."],
    },
  };

  it("finds a nested package's install folder", () => {
    expect(installPath("react")).toBe("node_modules/react");
    expect(installPath("@scope/ui/tslib")).toBe("node_modules/@scope/ui/node_modules/tslib");
    expect(installPath("a/@s/b")).toBe("node_modules/a/node_modules/@s/b");
  });

  it("marks what the app's own dependencies reach as shipped, the rest as build-only", () => {
    const found = npmComponents(lock, (key) => (key === "vite" ? undefined : "MIT"));
    const byPurl = Object.fromEntries(found.map((c) => [c.purl, c]));
    expect(Object.keys(byPurl).toSorted()).toEqual([
      "pkg:npm/%40scope/ui@1.0.0",
      "pkg:npm/react@19.0.0",
      "pkg:npm/tslib@1.0.0",
      "pkg:npm/tslib@2.0.0",
      "pkg:npm/vite@8.0.0",
    ]);
    expect(byPurl["pkg:npm/react@19.0.0"]!.scope).toBe("required");
    // The nested copy is the UI library's; the top-level one only vite's.
    expect(byPurl["pkg:npm/tslib@1.0.0"]!.scope).toBe("required");
    expect(byPurl["pkg:npm/tslib@2.0.0"]!.scope).toBe("excluded");
    expect(byPurl["pkg:npm/vite@8.0.0"]).toMatchObject({ scope: "excluded", licenses: undefined });
    expect(byPurl["pkg:npm/react@19.0.0"]!.hashes).toEqual([
      { alg: "SHA-512", content: Buffer.from("hash").toString("hex") },
    ]);
  });
});

describe("the document", () => {
  it("is CycloneDX 1.5 for the app, with its components in order", () => {
    const doc = bom({
      name: "App",
      version: "1.2.3",
      timestamp: "2026-11-15T00:00:00.000Z",
      serial: "00000000-0000-4000-8000-000000000000",
      components: [
        {
          type: "library",
          "bom-ref": "b",
          name: "b",
          version: "1",
          purl: "pkg:npm/b@1",
          scope: "required",
        },
        {
          type: "library",
          "bom-ref": "a",
          name: "a",
          version: "1",
          purl: "pkg:cargo/a@1",
          scope: "required",
        },
      ],
    });
    expect(doc).toMatchObject({
      bomFormat: "CycloneDX",
      specVersion: "1.5",
      serialNumber: "urn:uuid:00000000-0000-4000-8000-000000000000",
      metadata: {
        component: { type: "application", name: "App", version: "1.2.3" },
      },
    });
    expect(doc.components.map((c) => c.name)).toEqual(["a", "b"]);
  });
});
