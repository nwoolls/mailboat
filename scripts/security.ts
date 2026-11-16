// The security settings a script can check, so they can't quietly regress
// (`bun run check:security`, docs/ROADMAP.md → 0.3.0 → Security assessment).
// Each rule names the test case it backs, from CASA v2.1.1 and DASA v2.2.0
// (github.com/appdefensealliance/ASA-WG), so the evidence for the lab can
// point at it. What needs judgment (what a notification may
// show, the written answers) stays with a person.
//
// A reviewed exception carries `security-ok: <why>` on its line, like
// `privacy-ok`; a marker without a reason fails. What was reviewed as a
// whole (the capability, the `unsafe` places) is listed here, so changing
// it means changing this file, which a pull request review sees.

/** One problem found: the rule's ID, where, and what. */
export type Finding = { rule: string; file: string; line?: number; message: string };

/** The repository's files: path to text. */
export type Files = ReadonlyMap<string, string>;

/**
 * The Tauri capability's reviewed permissions: the web side, which shows
 * untrusted email, can do nothing else (DASA 1.4.1).
 */
export const REVIEWED_PERMISSIONS = ["core:event:default", "core:window:allow-start-dragging"];

/**
 * Where Rust's `unsafe` is reviewed, and how many times each file uses it
 * (DASA 1.4.1, by review): the macOS bridges in the app layer and the Windows
 * security calls in the core. A new one means updating this list.
 */
export const REVIEWED_UNSAFE: Record<string, number> = {
  "crates/core/src/mcp/mod.rs": 1,
  "crates/core/src/owner_only.rs": 7,
  "src-tauri/src/dock.rs": 3,
  "src-tauri/src/email_menu.rs": 16,
  "src-tauri/src/mail_handler.rs": 1,
  "src-tauri/src/notifications.rs": 6,
  "src-tauri/src/print.rs": 3,
  "src-tauri/src/trackpad.rs": 2,
};

/**
 * Where React renders HTML it didn't build (CASA 5.1.7), and how many
 * times: the AI panel shows the writing assistant's HTML, which Rust has
 * cleaned to plain formatting tags (`ai::format`).
 */
export const REVIEWED_INNER_HTML: Record<string, number> = {
  "src/features/ai/ui/AssistantPanel.tsx": 1,
};

const MARKER = /security-ok:\s*\S/;
const BARE_MARKER = /security-ok(?!:\s*\S)/;

/** A Rust or TypeScript line without its `//` comment, or "" for a comment line. */
function code(line: string): string {
  const trimmed = line.trim();
  if (trimmed.startsWith("*") || trimmed.startsWith("/*")) return "";
  // Not inside a string: a `//` after an odd number of quotes is in one.
  const at = line.indexOf("//");
  if (at === -1) return line;
  const before = line.slice(0, at);
  if ((before.match(/"/g)?.length ?? 0) % 2 === 1) return line;
  return before;
}

/**
 * A Rust file's lines that aren't tests: none in a `tests` folder, and
 * none from its first `#[cfg(test)]` (Clippy keeps test modules last).
 */
function rustAppLines(file: string, text: string): { line: number; text: string }[] {
  if (/(^|\/)tests\//.test(file)) return [];
  const lines = text.split("\n");
  const end = lines.findIndex((l) => /^\s*#\[cfg\((all\()?test\b/.test(l));
  return lines.slice(0, end === -1 ? undefined : end).map((t, i) => ({ line: i + 1, text: t }));
}

const isRust = (f: string) =>
  f.endsWith(".rs") && (f.startsWith("crates/") || f.startsWith("src-tauri/"));
const isAppTs = (f: string) =>
  f.startsWith("src/") && /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f);

function json(files: Files, path: string, findings: Finding[], rule: string): any {
  const text = files.get(path);
  if (text === undefined) {
    findings.push({ rule, file: path, message: "missing" });
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    findings.push({ rule, file: path, message: "isn't valid JSON" });
    return undefined;
  }
}

/** Every rule over `files`. */
export function checkSecurity(files: Files): Finding[] {
  const findings: Finding[] = [];
  const push = (rule: string, file: string, message: string, line?: number) =>
    findings.push({ rule, file, line, message });

  // Markers: a reviewed exception says why.
  for (const [file, text] of files) {
    if (file === "scripts/security.ts" || file === "scripts/security.test.ts") continue;
    text.split("\n").forEach((l, i) => {
      if (BARE_MARKER.test(l) && !MARKER.test(l)) {
        push("marker", file, "`security-ok` needs a reason: `security-ok: <why>`", i + 1);
      }
    });
  }

  // DASA 1.4.1: the web side gets only the reviewed permissions.
  const capabilities = [...files.keys()].filter((f) => f.startsWith("src-tauri/capabilities/"));
  if (capabilities.join() !== "src-tauri/capabilities/default.json") {
    push(
      "DASA 1.4.1",
      "src-tauri/capabilities/",
      `only default.json is reviewed, found: ${capabilities.join(", ")}`,
    );
  }
  const capability = json(files, "src-tauri/capabilities/default.json", findings, "DASA 1.4.1");
  if (capability) {
    const got = JSON.stringify(capability.permissions);
    if (got !== JSON.stringify(REVIEWED_PERMISSIONS)) {
      push(
        "DASA 1.4.1",
        "src-tauri/capabilities/default.json",
        `permissions are ${got}, reviewed: ${JSON.stringify(REVIEWED_PERMISSIONS)}`,
      );
    }
    if (JSON.stringify(capability.windows) !== '["main"]') {
      push(
        "DASA 1.4.1",
        "src-tauri/capabilities/default.json",
        "applies to windows other than main",
      );
    }
  }

  const conf = json(files, "src-tauri/tauri.conf.json", findings, "CASA 5.1.7");
  if (conf) {
    // CASA 5.1.7: the content security policy keeps scripts to the app's own.
    const csp: string = conf.app?.security?.csp ?? "";
    const directive = (name: string) =>
      csp
        .split(";")
        .map((d) => d.trim())
        .find((d) => d.split(/\s+/)[0] === name);
    for (const [name, value] of [
      ["script-src", "script-src 'self'"],
      ["object-src", "object-src 'none'"],
      ["base-uri", "base-uri 'none'"],
      ["form-action", "form-action 'none'"],
    ]) {
      if (directive(name!) !== value) {
        push(
          "CASA 5.1.7",
          "src-tauri/tauri.conf.json",
          `the CSP's ${name} is "${directive(name!) ?? "missing"}", must be "${value}"`,
        );
      }
    }
    const loosened = conf.app?.security?.dangerousDisableAssetCspModification;
    if (loosened !== undefined && JSON.stringify(loosened) !== '["style-src"]') {
      push(
        "CASA 5.1.7",
        "src-tauri/tauri.conf.json",
        `dangerousDisableAssetCspModification is ${JSON.stringify(loosened)}, reviewed: ["style-src"]`,
      );
    }
    // DASA 1.6.2 and 1.6.1: updates are signed and come over HTTPS.
    const updater = conf.plugins?.updater;
    if (typeof updater?.pubkey !== "string" || updater.pubkey.length < 40) {
      push(
        "DASA 1.6.2",
        "src-tauri/tauri.conf.json",
        "the updater has no public key to check updates against",
      );
    }
    const endpoints: unknown[] = updater?.endpoints ?? [];
    if (
      !endpoints.length ||
      !endpoints.every((e) => typeof e === "string" && e.startsWith("https://"))
    ) {
      push("DASA 1.6.1", "src-tauri/tauri.conf.json", "every updater endpoint must be HTTPS");
    }
    if (updater && "dangerousInsecureTransportProtocol" in updater) {
      push("DASA 1.6.1", "src-tauri/tauri.conf.json", "the updater allows insecure transport");
    }
  }

  // DASA 1.8.2: no web inspector in the shipped app.
  const appCargo = files.get("src-tauri/Cargo.toml") ?? "";
  const tauriLine = appCargo.split("\n").find((l) => /^tauri\s*=/.test(l)) ?? "";
  if (/devtools/.test(tauriLine)) {
    push("DASA 1.8.2", "src-tauri/Cargo.toml", "Tauri's devtools feature is on");
  }

  // DASA 1.8.2 and 2.1.2: symbols stripped, Control Flow Guard on Windows.
  if (!/\[profile\.release\][^[]*\bstrip\s*=\s*true/.test(files.get("Cargo.toml") ?? "")) {
    push("DASA 1.8.2", "Cargo.toml", "[profile.release] must set strip = true");
  }
  const cargoConfig = files.get(".cargo/config.toml") ?? "";
  for (const target of ["x86_64-pc-windows-msvc", "aarch64-pc-windows-msvc"]) {
    const section = cargoConfig.split(`[target.${target}]`)[1]?.split("\n[")[0] ?? "";
    if (!/-Ccontrol-flow-guard/.test(section)) {
      push("DASA 2.1.2", ".cargo/config.toml", `${target} must build with -Ccontrol-flow-guard`);
    }
  }

  for (const [file, text] of files) {
    const lines = text.split("\n");

    if (isAppTs(file)) {
      lines.forEach((l, i) => {
        const c = code(l);
        if (MARKER.test(l) || !c.trim()) return;
        // CASA 5.1.3: no code from strings.
        if (/\beval\s*\(|\bnew\s+Function\s*\(/.test(c)) {
          push("CASA 5.1.3", file, `code from a string: ${c.trim()}`, i + 1);
        }
        // CASA 5.1.7: no HTML from strings.
        if (
          /\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML\s*\(|document\.write\s*\(/.test(c)
        ) {
          push("CASA 5.1.7", file, `HTML from a string: ${c.trim()}`, i + 1);
        }
        // DASA 1.4.1: email is shown with no scripts.
        if (/allow-scripts/.test(c)) {
          push("DASA 1.4.1", file, "a frame allows scripts", i + 1);
        }
      });
      // Every frame is sandboxed.
      for (const m of text.matchAll(/<iframe\b[^>]*>/gs)) {
        if (!/\bsandbox=/.test(m[0])) {
          const line = text.slice(0, m.index).split("\n").length;
          push("DASA 1.4.1", file, "an iframe without a sandbox", line);
        }
      }
    }

    // CASA 5.1.7: React renders other HTML only where reviewed.
    if (file.startsWith("src/") && /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file)) {
      const count = lines.filter(
        (l) => /dangerouslySetInnerHTML/.test(code(l)) && !MARKER.test(l),
      ).length;
      if (count !== (REVIEWED_INNER_HTML[file] ?? 0)) {
        push(
          "CASA 5.1.7",
          file,
          `dangerouslySetInnerHTML ${count} times, reviewed: ${REVIEWED_INNER_HTML[file] ?? 0}`,
        );
      }
    }

    if (isRust(file)) {
      // DASA 1.4.1: `unsafe` only where reviewed (tests included).
      const unsafe = lines.filter((l) =>
        /\bunsafe\b(?!-)/.test(code(l).replace(/"[^"]*"/g, '""')),
      ).length;
      if (unsafe !== (REVIEWED_UNSAFE[file] ?? 0)) {
        push("DASA 1.4.1", file, `unsafe ${unsafe} times, reviewed: ${REVIEWED_UNSAFE[file] ?? 0}`);
      }
      lines.forEach((l, i) => {
        // DASA 1.1.2: certificates are always checked.
        if (/danger_accept_invalid_(certs|hostnames)/.test(code(l)) && !MARKER.test(l)) {
          push("DASA 1.1.2", file, "TLS checks turned off", i + 1);
        }
      });
      for (const { line, text: l } of rustAppLines(file, text)) {
        if (MARKER.test(l)) continue;
        const c = code(l);
        // DASA 1.4.2: programs run directly, never through a shell.
        if (
          /Command::new\(\s*"(?:\/bin\/|\/usr\/bin\/)?(sh|bash|zsh|cmd|cmd\.exe|powershell|pwsh)"|Path::new\(\s*"\/bin\/(sh|bash|zsh)"/.test(
            c,
          )
        ) {
          push("DASA 1.4.2", file, `a shell: ${c.trim()}`, line);
        }
        // DASA 1.1.1: requests go over HTTPS, but to this computer.
        for (const m of c.matchAll(/"http:\/\/([^"/:?{]*)/g)) {
          const host = m[1]!;
          if (
            host === "" ||
            host === "127.0.0.1" ||
            host === "localhost" ||
            host.endsWith(".localhost")
          )
            continue;
          push("DASA 1.1.1", file, `plain HTTP to ${host}: ${c.trim()}`, line);
        }
      }
    }

    // DASA 1.2.4: no secrets in the repository.
    if (file !== "scripts/security.test.ts") {
      lines.forEach((l, i) => {
        if (MARKER.test(l)) return;
        if (/GOCSPX-[A-Za-z0-9_-]{20,}/.test(l)) {
          push("DASA 1.2.4", file, "a Google client secret", i + 1);
        }
        if (
          /-----BEGIN [A-Z ]*PRIVATE KEY-----|minisign encrypted secret key|rsign encrypted secret key/.test(
            l,
          )
        ) {
          push("DASA 1.2.4", file, "a private key", i + 1);
        }
      });
    }
  }

  // The website's response headers: HTTPS only (CASA 4.1.1), and a CSP,
  // nosniff and no framing against script injection (CASA 5.1.7).
  const headers = files.get("website/_headers");
  if (headers === undefined) {
    push("CASA 5.1.7", "website/_headers", "missing");
  } else {
    for (const [rule, what, pattern] of [
      ["CASA 5.1.7", "a Content-Security-Policy", /Content-Security-Policy:/i],
      ["CASA 4.1.1", "HSTS", /Strict-Transport-Security:\s*max-age=\d{7,}/i],
      ["CASA 5.1.7", "X-Content-Type-Options: nosniff", /X-Content-Type-Options:\s*nosniff/i],
      [
        "CASA 5.1.7",
        "frame-ancestors in the CSP",
        /Content-Security-Policy:[^\n]*frame-ancestors/i,
      ],
    ] as const) {
      if (!pattern.test(headers)) push(rule, "website/_headers", `no ${what}`);
    }
  }

  return findings;
}
