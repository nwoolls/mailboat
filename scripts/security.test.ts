import { describe, expect, it } from "vitest";
import { checkSecurity, REVIEWED_INNER_HTML, REVIEWED_UNSAFE } from "./security";

/** A small tree that passes every rule, shaped like the repository. */
function good(): Map<string, string> {
  const files = new Map<string, string>([
    [
      "src-tauri/capabilities/default.json",
      JSON.stringify({
        windows: ["main"],
        permissions: ["core:event:default", "core:window:allow-start-dragging"],
      }),
    ],
    [
      "src-tauri/tauri.conf.json",
      JSON.stringify({
        app: {
          security: {
            csp: "default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'",
            dangerousDisableAssetCspModification: ["style-src"],
          },
        },
        plugins: {
          updater: { pubkey: "x".repeat(60), endpoints: ["https://updates.x.example/latest.json"] },
        },
      }),
    ],
    [
      "src-tauri/Cargo.toml",
      '[dependencies]\ntauri = { version = "2", features = ["macos-private-api"] }\n',
    ],
    ["Cargo.toml", "[workspace]\n\n[profile.release]\nstrip = true\n"],
    [
      ".cargo/config.toml",
      '[target.x86_64-pc-windows-msvc]\nrustflags = ["-Ccontrol-flow-guard"]\n\n[target.aarch64-pc-windows-msvc]\nrustflags = ["-Ccontrol-flow-guard"]\n',
    ],
    [
      "website/_headers",
      "/*\n  Content-Security-Policy: default-src 'self'; frame-ancestors 'none'\n  Strict-Transport-Security: max-age=63072000\n  X-Content-Type-Options: nosniff\n",
    ],
    [
      "src/features/reader/ui/Frame.tsx",
      '// Never `allow-scripts` (a comment may say so).\nexport const F = () => <iframe sandbox="allow-same-origin" srcDoc="" />;\n',
    ],
    [
      "crates/core/src/net.rs",
      [
        'pub const LOOPBACK: &str = "http://127.0.0.1:1";',
        'pub const LINKS: &str = "http://email-link.localhost/open";',
        'fn upgrade(s: &str) -> Option<&str> { s.strip_prefix("http://") }',
        "#[cfg(test)]",
        "mod tests {",
        '    const SITE: &str = "http://a.example/";',
        '    fn shell() { let _ = std::process::Command::new("sh"); }',
        "}",
      ].join("\n"),
    ],
  ]);
  for (const [file, count] of Object.entries(REVIEWED_UNSAFE)) {
    files.set(file, Array.from({ length: count }, () => "unsafe { f() };").join("\n"));
  }
  for (const [file, count] of Object.entries(REVIEWED_INNER_HTML)) {
    files.set(
      file,
      Array.from({ length: count }, () => "<div dangerouslySetInnerHTML={x} />").join("\n"),
    );
  }
  return files;
}

/** The rules that fire after `change`. */
function rulesAfter(change: (files: Map<string, string>) => void): string[] {
  const files = good();
  change(files);
  return checkSecurity(files).map((f) => f.rule);
}

const add = (file: string, text: string) => (files: Map<string, string>) =>
  files.set(file, `${files.get(file) ?? ""}\n${text}`);
const edit = (file: string, f: (json: any) => void) => (files: Map<string, string>) => {
  const json = JSON.parse(files.get(file)!);
  f(json);
  files.set(file, JSON.stringify(json));
};

describe("the security check", () => {
  it("passes a tree that keeps every reviewed setting", () => {
    expect(checkSecurity(good())).toEqual([]);
  });

  // Each forbidden pattern, planted: the rule that guards it fires.
  const planted: [string, string, (files: Map<string, string>) => void][] = [
    [
      "a new Tauri permission",
      "DASA 1.4.1",
      edit("src-tauri/capabilities/default.json", (c) => c.permissions.push("shell:allow-open")),
    ],
    [
      "a second capability file",
      "DASA 1.4.1",
      (f) => f.set("src-tauri/capabilities/extra.json", "{}"),
    ],
    [
      "scripts from inline code",
      "CASA 5.1.7",
      edit(
        "src-tauri/tauri.conf.json",
        (c) =>
          (c.app.security.csp = c.app.security.csp.replace(
            "script-src 'self'",
            "script-src 'self' 'unsafe-inline'",
          )),
      ),
    ],
    [
      "no object-src",
      "CASA 5.1.7",
      edit(
        "src-tauri/tauri.conf.json",
        (c) => (c.app.security.csp = c.app.security.csp.replace("; object-src 'none'", "")),
      ),
    ],
    [
      "the script CSP left unmodified",
      "CASA 5.1.7",
      edit("src-tauri/tauri.conf.json", (c) =>
        c.app.security.dangerousDisableAssetCspModification.push("script-src"),
      ),
    ],
    [
      "an unsigned updater",
      "DASA 1.6.2",
      edit("src-tauri/tauri.conf.json", (c) => delete c.plugins.updater.pubkey),
    ],
    [
      "an HTTP update endpoint",
      "DASA 1.6.1",
      edit("src-tauri/tauri.conf.json", (c) =>
        c.plugins.updater.endpoints.push("http://updates.x.example/latest.json"),
      ),
    ],
    [
      "insecure update transport",
      "DASA 1.6.1",
      edit(
        "src-tauri/tauri.conf.json",
        (c) => (c.plugins.updater.dangerousInsecureTransportProtocol = true),
      ),
    ],
    [
      "devtools",
      "DASA 1.8.2",
      (f) => f.set("src-tauri/Cargo.toml", 'tauri = { version = "2", features = ["devtools"] }\n'),
    ],
    ["symbols kept", "DASA 1.8.2", (f) => f.set("Cargo.toml", "[workspace]\n")],
    [
      "no Control Flow Guard on ARM64",
      "DASA 2.1.2",
      (f) =>
        f.set(
          ".cargo/config.toml",
          '[target.x86_64-pc-windows-msvc]\nrustflags = ["-Ccontrol-flow-guard"]\n',
        ),
    ],
    ["eval", "CASA 5.1.3", add("src/features/reader/ui/Frame.tsx", "eval(text);")],
    [
      "new Function",
      "CASA 5.1.3",
      add("src/features/reader/ui/Frame.tsx", "const run = new Function(text);"),
    ],
    ["innerHTML", "CASA 5.1.7", add("src/features/reader/ui/Frame.tsx", "el.innerHTML = html;")],
    [
      "a frame with scripts",
      "DASA 1.4.1",
      add("src/features/reader/ui/Frame.tsx", 'const s = "allow-scripts allow-same-origin";'),
    ],
    [
      "a frame without a sandbox",
      "DASA 1.4.1",
      add("src/features/reader/ui/Frame.tsx", 'export const G = () => <iframe srcDoc="" />;'),
    ],
    [
      "another dangerouslySetInnerHTML",
      "CASA 5.1.7",
      add("src/features/compose/ui/Preview.tsx", "<div dangerouslySetInnerHTML={x} />"),
    ],
    ["another unsafe", "DASA 1.4.1", add("src-tauri/src/print.rs", "unsafe { g() };")],
    [
      "unsafe somewhere new",
      "DASA 1.4.1",
      add("crates/core/src/net.rs", "fn f() { unsafe { g() } }"),
    ],
    [
      "unchecked certificates",
      "DASA 1.1.2",
      add("crates/core/src/net.rs", "let c = builder.danger_accept_invalid_certs(true);"),
    ],
    [
      "a shell",
      "DASA 1.4.2",
      (f) =>
        f.set("crates/core/src/run.rs", 'fn r() { std::process::Command::new("sh").arg("-c"); }'),
    ],
    [
      "cmd on Windows",
      "DASA 1.4.2",
      (f) => f.set("crates/core/src/run.rs", 'fn r() { Command::new("cmd").arg("/c"); }'),
    ],
    [
      "plain HTTP to a host",
      "DASA 1.1.1",
      (f) => f.set("crates/core/src/run.rs", 'const U: &str = "http://api.x.example/v1";'),
    ],
    [
      "a Google client secret",
      "DASA 1.2.4",
      (f) => f.set("docs/notes.md", `secret: GOCSPX-${"a".repeat(28)}`),
    ],
    [
      "a private key",
      "DASA 1.2.4",
      (f) => f.set("keys/app.pem", "-----BEGIN PRIVATE KEY-----\nabc\n"),
    ],
    [
      "a minisign secret key",
      "DASA 1.2.4",
      (f) => f.set("keys/app.key", "untrusted comment: rsign encrypted secret key\nabc\n"),
    ],
    [
      "no HSTS on the website",
      "CASA 4.1.1",
      (f) =>
        f.set("website/_headers", f.get("website/_headers")!.replace(/.*Strict-Transport.*\n/, "")),
    ],
    [
      "no frame-ancestors",
      "CASA 5.1.7",
      (f) =>
        f.set(
          "website/_headers",
          f.get("website/_headers")!.replace("; frame-ancestors 'none'", ""),
        ),
    ],
    [
      "no nosniff",
      "CASA 5.1.7",
      (f) => f.set("website/_headers", f.get("website/_headers")!.replace(/.*nosniff.*\n/, "")),
    ],
    [
      "a marker without a reason",
      "marker",
      add("crates/core/src/net.rs", "let x = 1; // security-ok"),
    ],
  ];
  for (const [what, rule, change] of planted) {
    it(`catches ${what} (${rule})`, () => {
      expect(rulesAfter(change)).toContain(rule);
    });
  }

  it("lets a reviewed exception through when it says why", () => {
    expect(
      rulesAfter(
        add(
          "crates/core/src/net.rs",
          'const U: &str = "http://demo/x"; // security-ok: only parsed',
        ),
      ),
    ).toEqual([]);
    expect(
      rulesAfter(
        add("src/features/reader/ui/Frame.tsx", "eval(x); // security-ok: test of the marker"),
      ),
    ).toEqual([]);
  });

  it("leaves tests and comments alone", () => {
    expect(
      rulesAfter(
        add(
          "crates/core/tests/live.rs",
          'const U: &str = "http://a.example/"; fn s() { Command::new("sh"); }',
        ),
      ),
    ).toEqual([]);
    expect(
      rulesAfter(add("src/features/reader/ui/Frame.tsx", "// we never call eval() here")),
    ).toEqual([]);
    expect(rulesAfter(add("crates/core/src/net.rs", "// unsafe isn't used here"))).toEqual([]);
    // CSS's 'unsafe-inline' is a word in a string, not Rust's `unsafe`.
    expect(
      rulesAfter(add("crates/core/src/net.rs", "const P: &str = \"style-src 'unsafe-inline'\";")),
    ).toEqual([]);
  });
});
