import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkSecurity, parseToml, REVIEWED_INNER_HTML, REVIEWED_UNSAFE } from "./security";

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
          updater: {
            pubkey: "x".repeat(60),
            endpoints: ["https://updates.x.example/latest.json"],
            requireSignedVersion: true,
          },
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
      "/*\n  Content-Security-Policy: default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'\n  Strict-Transport-Security: max-age=63072000\n  X-Content-Type-Options: nosniff\n",
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
/** Puts `text` at the start of `file`: in Rust, before its test module. */
const prepend = (file: string, text: string) => (files: Map<string, string>) =>
  files.set(file, `${text}\n${files.get(file) ?? ""}`);
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
      (f) =>
        f.set(
          "src-tauri/Cargo.toml",
          '[dependencies]\ntauri = { version = "2", features = ["devtools"] }\n',
        ),
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
    ["another unsafe", "unsafe (reviewed)", add("src-tauri/src/print.rs", "unsafe { g() };")],
    [
      "unsafe somewhere new",
      "unsafe (reviewed)",
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
      "hsts",
      (f) =>
        f.set("website/_headers", f.get("website/_headers")!.replace(/.*Strict-Transport.*\n/, "")),
    ],
    [
      "no frame-ancestors",
      "framing",
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
    // From review: ways round the first version's rules.
    [
      "a script-src-elem override",
      "CASA 5.1.7",
      edit(
        "src-tauri/tauri.conf.json",
        (c) => (c.app.security.csp += "; script-src-elem * 'unsafe-inline'"),
      ),
    ],
    [
      "a wide-open website CSP",
      "CASA 5.1.7",
      (f) =>
        f.set(
          "website/_headers",
          f.get("website/_headers")!.replace("default-src 'self'", "default-src * 'unsafe-inline'"),
        ),
    ],
    [
      "framing allowed",
      "framing",
      (f) =>
        f.set(
          "website/_headers",
          f.get("website/_headers")!.replace("frame-ancestors 'none'", "frame-ancestors *"),
        ),
    ],
    [
      "a CSP in a platform config",
      "CASA 5.1.7",
      (f) =>
        f.set(
          "src-tauri/tauri.macos.conf.json",
          JSON.stringify({ app: { security: { csp: null } } }),
        ),
    ],
    [
      "an updater in a platform config",
      "DASA 1.6.2",
      (f) =>
        f.set(
          "src-tauri/tauri.windows.conf.json",
          JSON.stringify({ plugins: { updater: { endpoints: [] } } }),
        ),
    ],
    [
      "an inline capability",
      "DASA 1.4.1",
      edit(
        "src-tauri/tauri.conf.json",
        (c) =>
          (c.app.security.capabilities = [{ identifier: "x", permissions: ["shell:default"] }]),
      ),
    ],
    [
      "a window with devtools",
      "DASA 1.8.2",
      (f) =>
        f.set(
          "src-tauri/tauri.windows.conf.json",
          JSON.stringify({ app: { windows: [{ devtools: true }] } }),
        ),
    ],
    [
      "devtools in a multi-line feature list",
      "DASA 1.8.2",
      (f) =>
        f.set(
          "src-tauri/Cargo.toml",
          '[dependencies]\ntauri = { version = "2", features = [\n  "macos-private-api",\n  "devtools",\n] }\n',
        ),
    ],
    [
      "Control Flow Guard turned off",
      "DASA 2.1.2",
      (f) =>
        f.set(
          ".cargo/config.toml",
          f
            .get(".cargo/config.toml")!
            .replaceAll('"-Ccontrol-flow-guard"', '"-Ccontrol-flow-guard=no"'),
        ),
    ],
    [
      "Control Flow Guard only in a comment",
      "DASA 2.1.2",
      (f) =>
        f.set(
          ".cargo/config.toml",
          '# rustflags = ["-Ccontrol-flow-guard"]\n[target.x86_64-pc-windows-msvc]\n[target.aarch64-pc-windows-msvc]\n',
        ),
    ],
    [
      "an unsigned version allowed",
      "DASA 1.6.2",
      edit("src-tauri/tauri.conf.json", (c) => (c.plugins.updater.requireSignedVersion = false)),
    ],
    [
      "requireSignedVersion removed",
      "DASA 1.6.2",
      edit("src-tauri/tauri.conf.json", (c) => delete c.plugins.updater.requireSignedVersion),
    ],
    [
      "Function without new",
      "CASA 5.1.3",
      add("src/features/reader/ui/Frame.tsx", "Function(text)();"),
    ],
    ["window.eval", "CASA 5.1.3", add("src/features/reader/ui/Frame.tsx", "window.eval(text);")],
    [
      "eval after a // inside a string",
      "CASA 5.1.3",
      add("src/features/reader/ui/Frame.tsx", "const url = 'https://x.example'; eval(text);"),
    ],
    [
      "a sandbox that isn't one",
      "DASA 1.4.1",
      add(
        "src/features/reader/ui/Frame.tsx",
        "export const H = () => <iframe sandbox={undefined} />;",
      ),
    ],
    [
      "a frame made with createElement",
      "DASA 1.4.1",
      add("src/features/reader/ui/Frame.tsx", 'const f = document.createElement("iframe");'),
    ],
    [
      "a shell after a single test function",
      "DASA 1.4.2",
      (f) =>
        f.set(
          "crates/core/src/run.rs",
          '#[cfg(test)]\nfn a_test() {}\n\npub fn run() { std::process::Command::new("sh"); }',
        ),
    ],
    [
      "two unsafe on one line",
      "unsafe (reviewed)",
      (f) =>
        f.set(
          "src-tauri/src/print.rs",
          f
            .get("src-tauri/src/print.rs")!
            .replace("unsafe { f() };", "unsafe { f() }; unsafe { g() };"),
        ),
    ],
    // From the second review.
    [
      "a capability that remote sites can call",
      "DASA 1.4.1",
      edit(
        "src-tauri/capabilities/default.json",
        (c) => (c.remote = { urls: ["https://evil.example/*"] }),
      ),
    ],
    [
      "plain HTTP to a host filled in later",
      "DASA 1.1.1",
      (f) =>
        f.set(
          "crates/core/src/run.rs",
          'fn u(host: &str) -> String { format!("http://{host}/v1") }',
        ),
    ],
    [
      "plain HTTP with a positional host",
      "DASA 1.1.1",
      (f) => f.set("crates/core/src/run.rs", 'fn u(h: &str) -> String { format!("http://{}", h) }'),
    ],
    [
      "powershell.exe",
      "DASA 1.4.2",
      (f) => f.set("crates/core/src/run.rs", 'fn r() { Command::new("powershell.exe"); }'),
    ],
    [
      "a shell after a test module, in production code",
      "DASA 1.4.2",
      (f) =>
        f.set(
          "crates/core/src/run.rs",
          '#[cfg(test)]\nmod tests {\n    fn t() {}\n}\n\npub fn run() { std::process::Command::new("sh"); }',
        ),
    ],
    [
      "framing by the site itself",
      "framing",
      (f) =>
        f.set(
          "website/_headers",
          f.get("website/_headers")!.replace("frame-ancestors 'none'", "frame-ancestors 'self'"),
        ),
    ],
    [
      "certificate checks off through a variable",
      "DASA 1.1.2",
      add("crates/core/src/net.rs", "let c = builder.danger_accept_invalid_certs(insecure);"),
    ],
    // From the second round.
    [
      "a permissive script-src given first, before the reviewed one",
      "CASA 5.1.7",
      (f) =>
        f.set(
          "website/_headers",
          f
            .get("website/_headers")!
            .replace(
              "Content-Security-Policy: ",
              "Content-Security-Policy: script-src * 'unsafe-inline'; ",
            ),
        ),
    ],
    [
      "framing allowed first, before the reviewed frame-ancestors",
      "framing",
      (f) =>
        f.set(
          "website/_headers",
          f
            .get("website/_headers")!
            .replace("Content-Security-Policy: ", "Content-Security-Policy: frame-ancestors *; "),
        ),
    ],
    [
      "Control Flow Guard turned off with a split -C",
      "DASA 2.1.2",
      (f) =>
        f.set(
          ".cargo/config.toml",
          f
            .get(".cargo/config.toml")!
            .replaceAll(
              '["-Ccontrol-flow-guard"]',
              '["-Ccontrol-flow-guard", "-C", "control-flow-guard=no"]',
            ),
        ),
    ],
    [
      "devtools for one platform only",
      "DASA 1.8.2",
      (f) =>
        f.set(
          "src-tauri/Cargo.toml",
          `${f.get("src-tauri/Cargo.toml")}\n[target.'cfg(windows)'.dependencies]\ntauri = { version = "2", features = ["devtools"] }\n`,
        ),
    ],
    // From the second round's second review.
    ...[
      'Command::new("PowerShell.exe")',
      'Command::new("cmd.EXE")',
      'Command::new(r"sh")',
      'Command::new(r#"powershell.exe"#)',
      'Command::new("C:\\\\Windows\\\\System32\\\\cmd.exe")',
      'Command::new("/usr/local/bin/bash")',
    ].map((call): [string, string, (f: Map<string, string>) => void] => [
      `the shell ${call}`,
      "DASA 1.4.2",
      (f) => f.set("crates/core/src/run.rs", `fn r() { ${call}; }`),
    ]),
    [
      "window.Function",
      "CASA 5.1.3",
      add("src/features/reader/ui/Frame.tsx", "window.Function(text)();"),
    ],
    [
      "globalThis.Function",
      "CASA 5.1.3",
      add("src/features/reader/ui/Frame.tsx", "globalThis.Function(text)();"),
    ],
    [
      "an IFRAME made in capitals",
      "DASA 1.4.1",
      add("src/features/reader/ui/Frame.tsx", 'document.createElement("IFRAME");'),
    ],
    [
      "HTTP in capitals",
      "DASA 1.1.1",
      (f) => f.set("crates/core/src/run.rs", 'const U: &str = "HTTP://evil.x.example/";'),
    ],
    [
      "HTTP in capitals, host filled in later",
      "DASA 1.1.1",
      (f) => f.set("crates/core/src/run.rs", 'fn u(h: &str) -> String { format!("HTTP://{h}") }'),
    ],
    [
      "a wildcard host in default-src",
      "CASA 5.1.7",
      (f) =>
        f.set(
          "website/_headers",
          f.get("website/_headers")!.replace("default-src 'self'", "default-src https://*"),
        ),
    ],
    [
      "blob: in default-src",
      "CASA 5.1.7",
      (f) =>
        f.set(
          "website/_headers",
          f.get("website/_headers")!.replace("default-src 'self'", "default-src blob:"),
        ),
    ],
  ];
  for (const [what, rule, change] of planted) {
    it(`catches ${what} (${rule})`, () => {
      expect(rulesAfter(change)).toContain(rule);
    });
  }

  it("lets a reviewed exception through when it says why", () => {
    // In production code (before the test module), so only the marker
    // lets it through: without it, the same line fails.
    const line = 'const U: &str = "http://demo/x";';
    expect(rulesAfter(prepend("crates/core/src/net.rs", line))).toContain("DASA 1.1.1");
    expect(
      rulesAfter(prepend("crates/core/src/net.rs", `${line} // security-ok: only parsed`)),
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
    // Review: block comments, strings and raw strings aren't code.
    expect(
      rulesAfter(add("src/features/reader/ui/Frame.tsx", "/*\n  we never call eval(text)\n*/")),
    ).toEqual([]);
    expect(
      rulesAfter(add("crates/core/src/net.rs", "/* an unsafe block\n   would be unsafe */")),
    ).toEqual([]);
    expect(
      rulesAfter(
        prepend("crates/core/src/net.rs", 'const S: &str = r#"no unsafe "here" either"#;'),
      ),
    ).toEqual([]);
    // Review: safe values of the dangerous switches, and the bare prefix.
    expect(
      rulesAfter(
        prepend(
          "crates/core/src/net.rs",
          "fn t(b: B) -> B { b.danger_accept_invalid_certs(false) }",
        ),
      ),
    ).toEqual([]);
    expect(
      rulesAfter(
        edit(
          "src-tauri/tauri.conf.json",
          (c) => (c.plugins.updater.dangerousInsecureTransportProtocol = false),
        ),
      ),
    ).toEqual([]);
    // A frame with a comparison or an arrow function among its attributes is read whole.
    expect(
      rulesAfter(
        add(
          "src/features/reader/ui/Frame.tsx",
          'export const K = () => <iframe title={n > 0 ? "a" : "b"} sandbox="allow-same-origin" />;',
        ),
      ),
    ).toEqual([]);
    // The loopback address in IPv6 is this computer too.
    expect(
      rulesAfter(prepend("crates/core/src/net.rs", 'const L: &str = "http://[::1]:8080/";')),
    ).toEqual([]);
    // A frame in a comment isn't a frame, and a reviewed one says why.
    expect(rulesAfter(add("src/features/reader/ui/Frame.tsx", '// <iframe srcDoc="" />'))).toEqual(
      [],
    );
    expect(
      rulesAfter(
        add(
          "src/features/reader/ui/Frame.tsx",
          'const L = <iframe srcDoc="" />; // security-ok: a test of the marker',
        ),
      ),
    ).toEqual([]);
    // A frame with an arrow function among its attributes is still read whole.
    expect(
      rulesAfter(
        add(
          "src/features/reader/ui/Frame.tsx",
          'export const J = () => <iframe onLoad={() => ready()} sandbox="allow-same-origin" />;',
        ),
      ),
    ).toEqual([]);
  });

  it("finds nothing in the repository as it is", () => {
    // Review: the first version failed on its own patterns, which only
    // showed once the file was committed.
    const run = spawnSync("bun", ["scripts/check-security.ts"], { encoding: "utf8" });
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
  });
});

describe("the TOML reader", () => {
  it("reads what the checked files use", () => {
    expect(
      parseToml(
        [
          "# a comment",
          "[workspace]",
          'members = ["crates/core", "src-tauri"] # trailing',
          "",
          "[workspace.package]",
          'version = "0.0.0"',
          "",
          "[dependencies]",
          'tauri = { version = "2", features = [',
          '  "macos-private-api",',
          "] }",
          "\"quoted.key\" = 'literal string'",
          "",
          "[target.x86_64-pc-windows-msvc]",
          'rustflags = ["-Ccontrol-flow-guard"]',
          "",
          "[profile.release]",
          "strip = true",
          "opt-level = 3",
        ].join("\n"),
      ),
    ).toEqual({
      workspace: { members: ["crates/core", "src-tauri"], package: { version: "0.0.0" } },
      dependencies: {
        tauri: { version: "2", features: ["macos-private-api"] },
        "quoted.key": "literal string",
      },
      target: { "x86_64-pc-windows-msvc": { rustflags: ["-Ccontrol-flow-guard"] } },
      profile: { release: { strip: true, "opt-level": 3 } },
    });
  });

  it("refuses what it doesn't read, so the check fails closed", () => {
    for (const text of [
      "__proto__ = { polluted = true }",
      "[a.__proto__]\nb = 1",
      "a = { constructor = 1 }",
      'a = """x"""',
      "[[bin]]\nname = 'x'",
      "a = 1979-05-27",
      "a = 1\na = 2",
      "a = [1,",
    ]) {
      expect(() => parseToml(text), text).toThrow(/TOML/);
    }
  });

  it("reads an inline table broken across lines, as Cargo does", () => {
    expect(parseToml('tokio = { version = "1", features = [\n  "rt",\n]\n}\n')).toEqual({
      tokio: { version: "1", features: ["rt"] },
    });
  });

  it("parses the repository's own Cargo files", () => {
    for (const file of [
      "Cargo.toml",
      "src-tauri/Cargo.toml",
      ".cargo/config.toml",
      "crates/core/Cargo.toml",
    ]) {
      expect(() => parseToml(readFileSync(file, "utf8")), file).not.toThrow();
    }
  });
});
