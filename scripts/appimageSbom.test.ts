import { describe, expect, it } from "vitest";
import { appimageBom, copyrightLicenses, owned, pickOwner } from "./appimageSbom";

describe("tracing a bundled file to its package", () => {
  // `dpkg -S` on Ubuntu 22.04, as it prints.
  const search = [
    "libgtk-3-0:arm64: /usr/lib/aarch64-linux-gnu/libgtk-3.so.0",
    "libgtk-3-0:arm64: /usr/lib/aarch64-linux-gnu/libgtk-3.so.0.2404.29",
  ].join("\n");

  it("reads each owner, a shared path's packages one by one, with their architecture", () => {
    expect(owned("libfoo1:amd64, libfoo1:i386: /usr/lib/libfoo.so.1")).toEqual([
      { package: "libfoo1", arch: "amd64", path: "/usr/lib/libfoo.so.1" },
      { package: "libfoo1", arch: "i386", path: "/usr/lib/libfoo.so.1" },
    ]);
  });

  it("names the package of a library moved into usr/lib by its name", () => {
    expect(pickOwner(owned(search), "/usr/lib/libgtk-3.so.0")).toEqual({
      package: "libgtk-3-0",
      arch: "arm64",
      path: "/usr/lib/aarch64-linux-gnu/libgtk-3.so.0",
    });
  });

  it("prefers the owner of the exact path, and leaves debug copies out", () => {
    const competing = owned(
      [
        "libfoo-dbg:amd64: /usr/lib/debug/libfoo.so.1",
        "libfoo1:amd64: /usr/lib/x86_64-linux-gnu/libfoo.so.1",
        "libfoo-extra:amd64: /opt/foo/libfoo.so.1",
      ].join("\n"),
    );
    expect(pickOwner(competing, "/usr/lib/x86_64-linux-gnu/libfoo.so.1")?.package).toBe("libfoo1");
    expect(() => pickOwner(competing, "/usr/lib/libfoo.so.1")).toThrow(
      /more than one package has it \(libfoo1, libfoo-extra\)/,
    );
    expect(
      pickOwner(owned("libfoo-dbg:amd64: /usr/lib/debug/libfoo.so.1"), "/usr/lib/libfoo.so.1"),
    ).toBeNull();
  });

  it("is null when no package owns it", () => {
    expect(pickOwner(owned(""), "/AppRun")).toBeNull();
    expect(pickOwner(owned(search), "/usr/lib/libgtk-3.so.1")).toBeNull();
  });
});

describe("the licenses in a Debian copyright file", () => {
  it("lists each License field once, in order", () => {
    const copyright = [
      "Format: https://www.debian.org/doc/packaging-manuals/copyright-format/1.0/",
      "",
      "Files: *",
      "License: LGPL-2.1+",
      "",
      "Files: gdk/*",
      "License: LGPL-2.1+",
      "",
      "Files: debian/*",
      "License: GPL-2+",
      "",
      "License: LGPL-2.1+",
      " On Debian systems, the full text ...",
    ].join("\n");
    expect(copyrightLicenses(copyright)).toEqual(["LGPL-2.1+", "GPL-2+"]);
  });

  it("finds none in a free-form file", () => {
    expect(copyrightLicenses("This package was debianized by someone.\n")).toEqual([]);
  });
});

describe("the AppImage's bill of materials", () => {
  it("lists each package with its version, licenses and files, and the tools by digest", () => {
    const doc = appimageBom({
      name: "App",
      version: "0.1.0",
      arch: "arm64",
      bundled: [
        {
          package: "libgtk-3-0",
          version: "3.24.33-1ubuntu2",
          licenses: ["LGPL-2.1+"],
          files: ["usr/lib/libgtk-3.so.0"],
        },
        { package: null, version: null, licenses: [], files: ["AppRun"], sha256: "ab12" },
      ],
      timestamp: "2026-11-24T00:00:00Z",
      serial: "00000000-0000-4000-8000-000000000000",
    });
    expect(doc.metadata.component.name).toBe("App");
    expect(doc.components.map((c) => c.purl)).toEqual([
      "pkg:deb/ubuntu/libgtk-3-0@3.24.33-1ubuntu2?arch=arm64&distro=ubuntu-22.04",
      "pkg:generic/appimage-tools/AppRun",
    ]);
    expect(doc.components[0].licenses).toEqual([{ license: { name: "LGPL-2.1+" } }]);
    expect(doc.components[1].hashes).toEqual([{ alg: "SHA-256", content: "ab12" }]);
  });
});
