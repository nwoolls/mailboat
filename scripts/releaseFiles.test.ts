import { describe, expect, it } from "vitest";
import {
  appimageSbomName,
  assetUrl,
  buildManifest,
  changelogSection,
  checksumLines,
  compareVersions,
  intotoLines,
  isInstaller,
  isPrerelease,
  isSbom,
  isVersion,
  PLATFORMS,
  platformOf,
  publishable,
  SBOM_DOWNLOADS,
  sbomName,
  stableName,
  tagFor,
  tagProblem,
} from "./releaseFiles";
import { releaseNotesUrl } from "../src/features/updates/model/update";

describe("which build outputs are update payloads", () => {
  it("knows each platform's by its name", () => {
    expect(platformOf("App.app.tar.gz")).toBe("darwin-aarch64");
    expect(platformOf("App_0.1.0_x64-setup.exe")).toBe("windows-x86_64");
    expect(platformOf("App_0.1.0_arm64-setup.exe")).toBe("windows-aarch64");
    // Linux: each kind of package for each processor, as Tauri names them.
    expect(platformOf("App_0.1.0_amd64.AppImage")).toBe("linux-x86_64-appimage");
    expect(platformOf("App_0.1.0_amd64.deb")).toBe("linux-x86_64-deb");
    expect(platformOf("App-0.1.0-1.x86_64.rpm")).toBe("linux-x86_64-rpm");
    expect(platformOf("App_0.1.0_aarch64.AppImage")).toBe("linux-aarch64-appimage");
    expect(platformOf("App_0.1.0_arm64.deb")).toBe("linux-aarch64-deb");
    expect(platformOf("App-0.1.0-1.aarch64.rpm")).toBe("linux-aarch64-rpm");
  });

  it("is null for anything else, signatures and disk images included", () => {
    for (const file of [
      "App.app.zip",
      "App_0.1.0_aarch64.dmg",
      "App.app.tar.gz.sig",
      "x.exe",
      "App_0.1.0_amd64.deb.sig",
    ]) {
      expect(platformOf(file)).toBeNull();
    }
  });
});

describe("what goes on the release", () => {
  it("is the disk image, each payload and its signature", () => {
    for (const file of [
      "App_0.1.0_aarch64.dmg",
      "App.app.tar.gz",
      "App.app.tar.gz.sig",
      "App_0.1.0_x64-setup.exe",
      "App_0.1.0_x64-setup.exe.sig",
      "App_0.1.0_arm64-setup.exe",
      "App_0.1.0_arm64-setup.exe.sig",
      "App_0.1.0_aarch64.cdx.json",
      "App_0.1.0_x64.cdx.json",
      "App_0.1.0_arm64.cdx.json",
      "App_0.1.0_amd64.deb",
      "App_0.1.0_amd64.deb.sig",
      "App-0.1.0-1.aarch64.rpm.sig",
      "App_0.1.0_linux_arm64.cdx.json",
    ]) {
      expect(publishable(file)).toBe(true);
    }
  });

  it("is not the checking zip, or a signature of something else", () => {
    expect(publishable("App.app.zip")).toBe(false);
    expect(publishable("App_0.1.0_aarch64.dmg.sig")).toBe(false);
    expect(publishable("notes.txt")).toBe(false);
  });
});

describe("a bill of materials per download", () => {
  it("names each after the download it describes, and covers every platform once", () => {
    const downloads = [
      "App_0.1.0_aarch64.dmg",
      "App_0.1.0_x64-setup.exe",
      "App_0.1.0_arm64-setup.exe",
    ];
    for (const d of SBOM_DOWNLOADS) {
      const name = sbomName("App", "0.1.0", d);
      // The Mac's and Windows' share the download's name up to the
      // platform's word; Linux's three packages of a processor share one.
      if (d.host === "darwin")
        expect(downloads.some((f) => f.startsWith(name.replace(".cdx.json", "")))).toBe(true);
      else expect(name).toMatch(/^App_0\.1\.0_linux_(amd64|arm64)\.cdx\.json$/);
      expect(isSbom(name) && publishable(name)).toBe(true);
      // Never mistaken for an update file or an installer.
      expect(platformOf(name)).toBeNull();
      expect(stableName(name, "0.1.0")).toBeNull();
    }
    // Each Linux processor's AppImage has a bill of its own; nothing else does.
    expect(SBOM_DOWNLOADS.map((d) => appimageSbomName("App", "0.1.0", d))).toEqual([
      null,
      null,
      null,
      "App_0.1.0_linux_amd64.AppImage.cdx.json",
      "App_0.1.0_linux_arm64.AppImage.cdx.json",
    ]);
    expect(SBOM_DOWNLOADS.flatMap((d) => d.platforms).toSorted()).toEqual(
      [...PLATFORMS].toSorted(),
    );
  });
});

describe("names a download link can rely on", () => {
  it("takes the version out of the disk image and the two Windows installers", () => {
    expect(stableName("App_0.1.0_aarch64.dmg", "0.1.0")).toBe("App_aarch64.dmg");
    expect(stableName("App_0.1.0_x64-setup.exe", "0.1.0")).toBe("App_x64-setup.exe");
    expect(stableName("App_0.1.0_arm64-setup.exe", "0.1.0")).toBe("App_arm64-setup.exe");
    expect(stableName("App_0.2.0-beta.1_x64-setup.exe", "0.2.0-beta.1")).toBe("App_x64-setup.exe");
  });

  it("takes the version out of the Linux packages, the .rpm's way included", () => {
    expect(stableName("App_0.1.0_amd64.AppImage", "0.1.0")).toBe("App_amd64.AppImage");
    expect(stableName("App_0.1.0_arm64.deb", "0.1.0")).toBe("App_arm64.deb");
    expect(stableName("App-0.1.0-1.x86_64.rpm", "0.1.0")).toBe("App-x86_64.rpm");
    expect(stableName("App-0.2.0-beta.1-1.aarch64.rpm", "0.2.0-beta.1")).toBe("App-aarch64.rpm");
    expect(stableName("App-0.1.0-1.x86_64.rpm", "0.2.0")).toBeNull();
    expect(stableName("App_0.1.0_amd64.deb.sig", "0.1.0")).toBeNull();
  });

  it("knows which files are the installers a person downloads", () => {
    expect(isInstaller("App_0.1.0_aarch64.dmg")).toBe(true);
    expect(isInstaller("App_0.1.0_x64-setup.exe")).toBe(true);
    expect(isInstaller("App_0.1.0_arm64-setup.exe")).toBe(true);
    for (const file of [
      "App.app.tar.gz",
      "App_0.1.0_x64-setup.exe.sig",
      "App.app.zip",
      "notes.txt",
    ]) {
      expect(isInstaller(file), file).toBe(false);
    }
  });

  it("gives nothing to the update files, the signatures, or a file for another version", () => {
    expect(stableName("App.app.tar.gz", "0.1.0")).toBeNull();
    expect(stableName("App.app.tar.gz.sig", "0.1.0")).toBeNull();
    expect(stableName("App_0.1.0_x64-setup.exe.sig", "0.1.0")).toBeNull();
    expect(stableName("App_0.1.0_aarch64.dmg", "0.2.0")).toBeNull();
    expect(stableName("App_aarch64.dmg", "0.1.0")).toBeNull();
    expect(stableName("notes.txt", "0.1.0")).toBeNull();
  });
});

describe("versions and tags", () => {
  it("accepts versions like 1.2.3 and pre-releases, and nothing looser", () => {
    for (const v of ["0.1.0", "1.2.3", "0.2.0-beta.1", "1.0.0+build.5"])
      expect(isVersion(v)).toBe(true);
    for (const v of ["1.2", "v1.2.3", "1.2.3.4", "", "latest"]) expect(isVersion(v)).toBe(false);
  });

  it("makes the tag and says which are pre-releases", () => {
    expect(tagFor("0.1.0")).toBe("v0.1.0");
    expect(isPrerelease("0.2.0-beta.1")).toBe(true);
    expect(isPrerelease("0.2.0")).toBe(false);
  });
});

const files = [
  { file: "App.app.tar.gz", signature: "AAAA\nBBBB==\n" },
  { file: "App_0.1.0_x64-setup.exe", signature: "CCCC" },
  { file: "App_0.1.0_arm64-setup.exe", signature: "DDDD" },
  { file: "App_0.1.0_aarch64.dmg", signature: "ignored" },
  ...[
    "App_0.1.0_amd64.AppImage",
    "App_0.1.0_amd64.deb",
    "App-0.1.0-1.x86_64.rpm",
    "App_0.1.0_aarch64.AppImage",
    "App_0.1.0_arm64.deb",
    "App-0.1.0-1.aarch64.rpm",
  ].map((file) => ({
    file,
    signature: "EEEE",
  })),
];
const input = {
  version: "0.1.0",
  repo: "owner/name",
  pubDate: new Date("2026-11-05T12:00:00Z"),
  files,
};

describe("the update manifest", () => {
  it("lists every platform with its signature (line breaks removed) and its release address", () => {
    const m = buildManifest(input);
    expect(m.version).toBe("0.1.0");
    expect(m.pub_date).toBe("2026-11-05T12:00:00.000Z");
    expect(Object.keys(m.platforms)).toEqual([...PLATFORMS]);
    expect(m.platforms["linux-x86_64-rpm"].url).toBe(
      "https://github.com/owner/name/releases/download/v0.1.0/App-0.1.0-1.x86_64.rpm",
    );
    expect(m.platforms["darwin-aarch64"]).toEqual({
      signature: "AAAABBBB==",
      url: "https://github.com/owner/name/releases/download/v0.1.0/App.app.tar.gz",
    });
    expect(m.platforms["windows-x86_64"].url).toBe(
      "https://github.com/owner/name/releases/download/v0.1.0/App_0.1.0_x64-setup.exe",
    );
  });

  it("carries no release notes", () => {
    expect(Object.keys(buildManifest(input))).toEqual(["version", "pub_date", "platforms"]);
  });

  it("is refused when a platform has no file, or two do", () => {
    expect(() => buildManifest({ ...input, files: files.slice(0, 2) })).toThrow(/windows-aarch64/);
    expect(() =>
      buildManifest({
        ...input,
        files: [...files, { file: "Other.app.tar.gz", signature: "EEEE" }],
      }),
    ).toThrow(/Two files/);
  });

  it("is refused for a signature that isn't base64, a bad version or a bad repository", () => {
    const bad = files.map((f) =>
      f.file.startsWith("App.app") ? { ...f, signature: "not base64!" } : f,
    );
    expect(() => buildManifest({ ...input, files: bad })).toThrow(/base64/);
    for (const blank of ["", " \n"]) {
      const empty = files.map((f) =>
        f.file.startsWith("App.app") ? { ...f, signature: blank } : f,
      );
      expect(() => buildManifest({ ...input, files: empty })).toThrow(/base64/);
    }
    expect(() => buildManifest({ ...input, version: "v0.1.0" })).toThrow(/version/);
    expect(() => buildManifest({ ...input, repo: "no-slash" })).toThrow(/repository/);
  });

  it("escapes a file name in its address", () => {
    expect(assetUrl("o/r", "1.0.0", "a b.exe")).toBe(
      "https://github.com/o/r/releases/download/v1.0.0/a%20b.exe",
    );
  });
});

describe("the checksums file", () => {
  it("has a line per file in name order, ending with a newline", () => {
    expect(
      checksumLines([
        { file: "b.exe", sha256: "22" },
        { file: "a.dmg", sha256: "11" },
      ]),
    ).toBe("11  a.dmg\n22  b.exe\n");
  });
});

describe("the release notes", () => {
  const changelog =
    "# Changelog\n\n## 0.2.0\n\n### Minor Changes\n\n- New thing.\n\n## 0.1.0\n\nFirst.\n";

  it("is the version's section, without its heading", () => {
    expect(changelogSection(changelog, "0.2.0")).toBe("### Minor Changes\n\n- New thing.");
    expect(changelogSection(changelog, "0.1.0")).toBe("First.");
  });

  it("is null for a version with no section, or an empty one", () => {
    expect(changelogSection(changelog, "0.3.0")).toBeNull();
    expect(changelogSection("## 0.1.0\n\n## 0.0.9\nx", "0.1.0")).toBeNull();
    expect(changelogSection("# Changelog\n", "0.1.0")).toBeNull();
  });

  it("doesn't match a version that only starts the same", () => {
    expect(changelogSection("## 0.1.0-beta.1\n\nx\n", "0.1.0")).toBeNull();
  });
});

describe("whether a tag can release", () => {
  const changelog = "# Changelog\n\n## 0.1.0\n\nFirst.\n";

  it("can when it is v and the version, and the changelog has the section", () => {
    expect(tagProblem("v0.1.0", "0.1.0", changelog)).toBeNull();
  });

  it("can't when the tag and the version differ, saying which tag would do", () => {
    expect(tagProblem("v0.2.0", "0.1.0", changelog)).toMatch(/the tag for that is v0\.1\.0/);
    expect(tagProblem("0.1.0", "0.1.0", changelog)).toMatch(/the tag for that is v0\.1\.0/);
  });

  it("can't without release notes, or for something that isn't a version", () => {
    expect(tagProblem("v0.1.0", "0.1.0", "# Changelog\n")).toMatch(/no section/);
    expect(tagProblem("vlatest", "latest", changelog)).toMatch(/isn't a version/);
  });
});

describe("version order", () => {
  it("follows semver, so a Beta install moves up and never down", () => {
    const order = [
      "0.2.0-beta.1",
      "0.2.0-beta.2",
      "0.2.0-beta.10",
      "0.2.0",
      "0.2.1-beta.1",
      "0.10.0",
      "1.0.0",
    ];
    for (let i = 0; i < order.length; i++) {
      for (let j = 0; j < order.length; j++) {
        expect(Math.sign(compareVersions(order[i], order[j]))).toBe(Math.sign(i - j));
      }
    }
  });
});

describe("the release's in-toto file", () => {
  // Shaped like `actions/attest-build-provenance`'s bundle: made-up values.
  const envelope = {
    payload: Buffer.from('{"_type":"https://in-toto.io/Statement/v1"}').toString("base64"),
    payloadType: "application/vnd.in-toto+json",
    signatures: [{ sig: "c2ln" }],
  };
  const bundleLine = (dsse: unknown) =>
    JSON.stringify({
      mediaType: "application/vnd.dev.sigstore.bundle.v0.3+json",
      verificationMaterial: { certificate: { rawBytes: "Y2VydA==" } },
      dsseEnvelope: dsse,
    });

  it("is each bundle line's DSSE envelope, compact, one per line", () => {
    const out = intotoLines(`${bundleLine(envelope)}
${bundleLine(envelope)}
`);
    const lines = out.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[2]).toBe("");
    expect(JSON.parse(lines[0]!)).toEqual(envelope);
    expect(lines[0]).not.toContain(" ");
    // Only the envelope: the certificate stays in the Sigstore bundle.
    expect(out).not.toContain("verificationMaterial");
  });

  it("refuses a bundle with no envelope, or one without its signature", () => {
    expect(() => intotoLines("")).toThrow(/empty/);
    expect(() => intotoLines(bundleLine(undefined))).toThrow(/line 1/);
    expect(() => intotoLines(bundleLine({ ...envelope, signatures: [] }))).toThrow(/line 1/);
    // Review: a signature entry without its signature.
    for (const signatures of [[{}], [null], ["x"], [{ keyid: "k" }], [{ sig: "" }]]) {
      expect(() => intotoLines(bundleLine({ ...envelope, signatures }))).toThrow(/line 1/);
    }
    expect(() => intotoLines(`${bundleLine(envelope)}\n${bundleLine({ payload: "x" })}`)).toThrow(
      /line 2/,
    );
  });
});

describe("the update notice's What's new link", () => {
  it("is offered for exactly the versions a release can be tagged with", () => {
    // `releaseNotesUrl` keeps its own copy of the pattern (the app can't
    // import this script); this keeps the two the same (review).
    const repo = "https://github.example/owner/app";
    for (const v of [
      "0.3.0",
      "0.3.0-beta.1",
      "0.3.1-beta-hotfix.1",
      "1.0.0-rc-1",
      "0.3.1+build.4",
      "latest",
      "0.3",
      "1.0.0?q=1",
      "1.0.0/../x",
    ])
      expect(releaseNotesUrl(repo, v) !== null, v).toBe(isVersion(v));
  });
});
