import { describe, expect, it } from "vitest";
import {
  bom,
  type BunLock,
  cargoChecksums,
  cargoComponents,
  installPath,
  licenses,
  npmComponents,
  parseTree,
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
  // `cargo tree --prefix none --format "{p}\t{l}"` per platform: what is
  // linked (normal edges, no proc macros), then what is used to build.
  const macLinked = [
    "desktop v0.0.0 (/src/app/src-tauri)\tGPL-3.0-only",
    "mail-core v0.0.0 (/src/app/crates/core)\tGPL-3.0-only",
    "alpha v1.0.0\tMIT",
    "alpha v1.0.0\tMIT (*)",
    "toml v1.1.8+spec-1.1.0\tMIT OR Apache-2.0",
  ].join("\n");
  const macUsed = [
    macLinked,
    "derive v1.0.0 (proc-macro)\tMIT/Apache-2.0",
    "cc v1.2.0\tMIT OR Apache-2.0",
  ].join("\n");
  // Windows links a crate only it uses (and its folders look different).
  const winLinked = [
    "desktop v0.0.0 (C:\\src\\app\\src-tauri)\tGPL-3.0-only",
    "alpha v1.0.0\tMIT",
    "winonly v0.5.0\tMIT",
  ].join("\n");

  it("reads each crate's checksum from Cargo.lock", () => {
    expect(cargoChecksums(lock)).toEqual(new Map([["alpha 1.0.0", "aaaa"]]));
  });

  it("reads cargo tree's lines once each, knowing the app's own crates by their folder", () => {
    expect(parseTree(macUsed)).toEqual([
      { name: "desktop", version: "0.0.0", local: true, license: "GPL-3.0-only" },
      { name: "mail-core", version: "0.0.0", local: true, license: "GPL-3.0-only" },
      { name: "alpha", version: "1.0.0", local: false, license: "MIT" },
      { name: "toml", version: "1.1.8+spec-1.1.0", local: false, license: "MIT OR Apache-2.0" },
      { name: "derive", version: "1.0.0", local: false, license: "MIT/Apache-2.0" },
      { name: "cc", version: "1.2.0", local: false, license: "MIT OR Apache-2.0" },
    ]);
    expect(parseTree(winLinked)[0]!.local).toBe(true);
  });

  it("lists every platform's crates, linked ones as shipped and the rest as build-only", () => {
    const sums = new Map([["alpha 1.0.0", "aaaa"]]);
    const found = cargoComponents([macLinked, winLinked], [macUsed, winLinked], sums);
    const byName = Object.fromEntries(found.map((c) => [c.name, c]));
    // The app's own crates are the application, not components.
    expect(Object.keys(byName).toSorted()).toEqual(["alpha", "cc", "derive", "toml", "winonly"]);
    expect(byName.alpha).toMatchObject({
      purl: "pkg:cargo/alpha@1.0.0",
      scope: "required",
      licenses: [{ expression: "MIT" }],
      hashes: [{ alg: "SHA-256", content: "aaaa" }],
    });
    // Review: proc macros and build scripts' crates don't ship.
    expect(byName.derive!.scope).toBe("excluded");
    expect(byName.cc!.scope).toBe("excluded");
    expect(byName.winonly!.scope).toBe("required");
    // Review: a version's "+" is percent-encoded in the package URL.
    expect(byName.toml!.purl).toBe("pkg:cargo/toml@1.1.8%2Bspec-1.1.0");
    expect(byName.toml!.version).toBe("1.1.8+spec-1.1.0");
  });
});

describe("JavaScript packages", () => {
  const sha = Buffer.from("hash").toString("base64");
  const lock: BunLock = {
    workspaces: {
      "": {
        dependencies: { react: "^19", "@scope/ui": "^1" },
        devDependencies: { vite: "^8", "@types/ui": "^1" },
      },
    },
    packages: {
      react: ["react@19.0.0", "", {}, `sha512-${sha}`],
      "@scope/ui": [
        "@scope/ui@1.0.0",
        "",
        {
          dependencies: { tslib: "^1" },
          optionalDependencies: { menu: "^1" },
          peerDependencies: { "@types/ui": "^1" },
        },
        `sha512-${sha}`,
      ],
      menu: ["menu@1.0.0", "", {}, `sha512-${sha}`],
      "@types/ui": ["@types/ui@1.0.0", "", {}, `sha512-${sha}`],
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
      "pkg:npm/%40types/ui@1.0.0",
      "pkg:npm/menu@1.0.0",
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
    // Review: reached only through an optional dependency, it's optional;
    // a peer the app supplies from its dev dependencies doesn't ship.
    expect(byPurl["pkg:npm/menu@1.0.0"]!.scope).toBe("optional");
    expect(byPurl["pkg:npm/%40types/ui@1.0.0"]!.scope).toBe("excluded");
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
