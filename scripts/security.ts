// The security settings a script can check, so they can't quietly regress
// (`bun run check:security`, docs/ROADMAP.md → 0.3.0 → Security assessment).
// Each rule names the test case it backs, from CASA v2.1.1 and DASA v2.2.0
// (github.com/appdefensealliance/ASA-WG), so the evidence for the lab can
// point at it. What needs judgment (what a notification may
// show, the written answers) stays with a person.
//
// A reviewed exception carries `security-ok: <why>` on its line, like
// `privacy-ok`; a marker without a reason fails, in any file (docs too,
// since a marker anywhere would let a secret through). What was reviewed as
// a whole (the capability, the `unsafe` places) is listed here, so changing
// it means changing this file, which a pull request review sees.
//
// Known limits, accepted: the rules read text, not values, so a shell or an
// `http://` address built from a constant elsewhere, or a CSP built at
// runtime, isn't seen; `unsafe` counts can't tell reviewed code was
// replaced; secret-shaped test fixtures need a marker.

/** One problem found: the rule's ID, where, and what. */
export type Finding = { rule: string; file: string; line?: number; message: string };

/** The repository's files: path to text. */
export type Files = ReadonlyMap<string, string>;

/**
 * The Tauri capability's reviewed permissions: the web side, which shows
 * untrusted email, can do nothing else (DASA 1.4.1).
 */
/** The keys the reviewed capability may have (no `remote`, no `platforms`). */
export const REVIEWED_CAPABILITY_KEYS = [
  "$schema",
  "identifier",
  "description",
  "windows",
  "permissions",
];

export const REVIEWED_PERMISSIONS = ["core:event:default", "core:window:allow-start-dragging"];

/**
 * Where Rust's `unsafe` is reviewed, and how many times each file uses it
 * (a rule of its own, "unsafe (reviewed)": no test case asks about Rust's
 * `unsafe`, so it backs none): the macOS bridges in the app layer and the Windows
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

/**
 * `text` with its comments, and optionally the contents of its strings,
 * replaced by spaces (line breaks kept, so positions and line numbers stay).
 * Knows TypeScript's and Rust's comments (line and block comments, nested
 * block comments in Rust),
 * strings (`'`, `"`, `` ` `` in TypeScript; `"`, raw `r#"…"#` and char
 * literals in Rust) and escapes. Regular expressions aren't parsed: an
 * escaped `\/` is skipped, so `/\/\//` isn't taken for a comment.
 */
export function strip(text: string, lang: "ts" | "rust", blankStrings: boolean): string {
  const out = text.split("");
  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = " ";
  };
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    const next = text[i + 1];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === "/" && next === "/") {
      const end = text.indexOf("\n", i);
      const stop = end === -1 ? text.length : end;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (c === "/" && next === "*") {
      let depth = 1;
      let j = i + 2;
      while (j < text.length && depth > 0) {
        if (text[j] === "*" && text[j + 1] === "/") {
          depth--;
          j += 2;
        } else if (lang === "rust" && text[j] === "/" && text[j + 1] === "*") {
          depth++;
          j += 2;
        } else j++;
      }
      blank(i, j);
      i = j;
      continue;
    }
    // Rust raw strings: r"…", r#"…"#, br#"…"#.
    if (
      lang === "rust" &&
      (c === "r" || (c === "b" && next === "r")) &&
      !/[\w]/.test(text[i - 1] ?? "")
    ) {
      const m = /^b?r(#*)"/.exec(text.slice(i, i + 10));
      if (m) {
        const close = `"${m[1]}`;
        const startBody = i + m[0].length;
        const end = text.indexOf(close, startBody);
        const stop = end === -1 ? text.length : end;
        if (blankStrings) blank(startBody, stop);
        i = stop + close.length;
        continue;
      }
    }
    // Rust char literal ('a', '\n'), not a lifetime ('a).
    if (lang === "rust" && c === "'") {
      const m = /^'(\\.[^']*|[^\\'])'/.exec(text.slice(i, i + 12));
      if (m) {
        if (blankStrings) blank(i + 1, i + m[0].length - 1);
        i += m[0].length;
        continue;
      }
      i++;
      continue;
    }
    if (c === '"' || (lang === "ts" && (c === "'" || c === "`"))) {
      let j = i + 1;
      while (j < text.length && text[j] !== c) {
        if (text[j] === "\\") j++;
        // A one-line string ends at the line in TypeScript (an error anyway).
        if (lang === "ts" && c !== "`" && text[j] === "\n") break;
        j++;
      }
      if (blankStrings) blank(i + 1, j);
      i = j + 1;
      continue;
    }
    i++;
  }
  return out.join("");
}

/**
 * The line ranges (1-based, inclusive) of a Rust file's test modules: a
 * `#[cfg(test)]` (or `#[cfg(all(test, …))]`) on a `mod … { … }`, to its
 * closing brace. A test attribute on anything else (a single function)
 * exempts nothing.
 */
export function rustTestRanges(text: string): [number, number][] {
  const code = strip(text, "rust", true);
  const lines = code.split("\n");
  const ranges: [number, number][] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*#\[cfg\((all\()?test\b/.test(lines[i]!)) continue;
    let j = i + 1;
    while (j < lines.length && /^\s*(#\[|$)/.test(lines[j]!)) j++;
    if (!/^\s*(pub(\([^)]*\))?\s+)?mod\s+\w+\s*\{/.test(lines[j] ?? "")) continue;
    // From the module's `{` to its matching `}`.
    const offset = lines.slice(0, j).join("\n").length + (j > 0 ? 1 : 0);
    let depth = 0;
    let k = code.indexOf("{", offset);
    for (; k < code.length; k++) {
      if (code[k] === "{") depth++;
      else if (code[k] === "}" && --depth === 0) break;
    }
    const last = code.slice(0, k).split("\n").length;
    ranges.push([i + 1, last]);
    i = last - 1;
  }
  return ranges;
}

/** A CSP's directives, by name. */
function directives(csp: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const part of csp.split(";")) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name) map.set(name.toLowerCase(), values);
  }
  return map;
}

/**
 * What's wrong with a page's CSP for scripts: anything but the page's own
 * scripts (`script-src 'self'`, no overriding `script-src-elem` or
 * `-attr`, no wildcard or `unsafe-*` source by default), and plugins, base
 * URLs and form targets closed.
 */
export function cspProblems(csp: string): string[] {
  const d = directives(csp);
  const problems: string[] = [];
  const is = (name: string, value: string) =>
    (d.get(name) ?? []).join(" ") === value || problems.push(`${name} must be ${value}`);
  is("script-src", "'self'");
  is("object-src", "'none'");
  is("base-uri", "'none'");
  is("form-action", "'none'");
  for (const override of ["script-src-elem", "script-src-attr"]) {
    if (d.has(override)) problems.push(`${override} overrides script-src`);
  }
  const fallback = d.get("default-src") ?? [];
  if (
    fallback.some(
      (v) =>
        v === "*" || v.startsWith("'unsafe-") || v === "data:" || v === "https:" || v === "http:",
    )
  ) {
    problems.push(`default-src allows ${fallback.join(" ")}`);
  }
  return problems;
}

/** Where a JSX tag that starts at `from` (`<iframe…`) ends: its `>`, skipping braces and strings. */
function tagEnd(text: string, from: number): number {
  let depth = 0;
  for (let k = from; k < text.length; k++) {
    const c = text[k];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if ((c === '"' || c === "'") && depth === 0) {
      const close = text.indexOf(c, k + 1);
      if (close === -1) return text.length;
      k = close;
    } else if (c === ">" && depth === 0) return k;
  }
  return text.length;
}

const isRust = (f: string) =>
  f.endsWith(".rs") && (f.startsWith("crates/") || f.startsWith("src-tauri/"));
const isAppTs = (f: string) =>
  f.startsWith("src/") && /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f);
const lineAt = (text: string, index: number) => text.slice(0, index).split("\n").length;

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

/**
 * The TOML the checked files use, parsed: tables (`[a.b]`), dotted and
 * quoted keys, strings (basic and literal), booleans, numbers, arrays
 * (across lines too) and inline tables, with comments. Anything else is an
 * error, so a config written in a way this doesn't read fails the check
 * instead of slipping past it. (Ours, not a library: three small files,
 * and the tests run where Bun's parser isn't.)
 */
export function parseToml(text: string): Record<string, any> {
  const root: Record<string, any> = {};
  let table = root;
  let i = 0;
  const fail = (what: string): never => {
    throw new Error(`TOML: ${what} at line ${text.slice(0, i).split("\n").length}`);
  };
  const skipSpace = (lines: boolean) => {
    for (;;) {
      const c = text[i];
      if (c === " " || c === "\t" || c === "\r" || (lines && c === "\n")) i++;
      else if (c === "#") while (i < text.length && text[i] !== "\n") i++;
      else return;
    }
  };
  const string = (): string => {
    const quote = text[i]!;
    i++;
    let out = "";
    while (i < text.length && text[i] !== quote) {
      if (text[i] === "\n") fail("a line break in a string");
      if (quote === '"' && text[i] === "\\") {
        const e = text[i + 1];
        out +=
          e === "n"
            ? "\n"
            : e === "t"
              ? "\t"
              : e === '"' || e === "\\"
                ? e
                : fail("an escape this doesn't read");
        i += 2;
      } else out += text[i++];
    }
    if (text[i] !== quote) fail("an unterminated string");
    i++;
    return out;
  };
  const key = (): string[] => {
    const parts: string[] = [];
    for (;;) {
      skipSpace(false);
      if (text[i] === '"' || text[i] === "'") parts.push(string());
      else {
        const m = /^[A-Za-z0-9_-]+/.exec(text.slice(i));
        if (!m) fail("a key");
        parts.push(m![0]);
        i += m![0].length;
      }
      skipSpace(false);
      if (text[i] !== ".") return parts;
      i++;
    }
  };
  const into = (target: Record<string, any>, path: string[]): Record<string, any> => {
    let t = target;
    for (const part of path) {
      t[part] ??= {};
      if (typeof t[part] !== "object" || Array.isArray(t[part])) fail(`"${part}" isn't a table`);
      t = t[part];
    }
    return t;
  };
  const value = (): any => {
    skipSpace(false);
    const c = text[i];
    if (c === '"' || c === "'") {
      if (text.startsWith(c.repeat(3), i)) fail("a multi-line string");
      return string();
    }
    if (c === "[") {
      i++;
      const items: any[] = [];
      for (;;) {
        skipSpace(true);
        if (text[i] === "]") break;
        items.push(value());
        skipSpace(true);
        if (text[i] === ",") i++;
        else if (text[i] !== "]") fail("an array");
      }
      i++;
      return items;
    }
    if (c === "{") {
      i++;
      const t: Record<string, any> = {};
      skipSpace(false);
      while (text[i] !== "}") {
        const path = key();
        if (text[i] !== "=") fail("an inline table");
        i++;
        into(t, path.slice(0, -1))[path.at(-1)!] = value();
        skipSpace(false);
        if (text[i] === ",") i++;
        skipSpace(false);
      }
      i++;
      return t;
    }
    const m = /^(true|false|[+-]?\d[\d_]*(\.\d+)?)(?=[\s,\]}#]|$)/.exec(text.slice(i));
    if (!m) fail("a value this doesn't read");
    i += m![0].length;
    return m![1] === "true" ? true : m![1] === "false" ? false : Number(m![1]!.replaceAll("_", ""));
  };
  for (;;) {
    skipSpace(true);
    if (i >= text.length) return root;
    if (text[i] === "[") {
      if (text[i + 1] === "[") fail("an array of tables");
      i++;
      const path = key();
      if (text[i] !== "]") fail("a table header");
      i++;
      table = into(root, path);
    } else {
      const path = key();
      if (text[i] !== "=") fail("a key without a value");
      i++;
      const target = into(table, path.slice(0, -1));
      const last = path.at(-1)!;
      if (last in target) fail(`"${last}" twice`);
      target[last] = value();
    }
    skipSpace(false);
    if (i < text.length && text[i] !== "\n") fail("more after a value");
  }
}

function toml(files: Files, path: string, findings: Finding[], rule: string): any {
  try {
    return parseToml(files.get(path) ?? "");
  } catch {
    // Fail closed: settings this can't read can't be checked.
    findings.push({ rule, file: path, message: "isn't TOML this check reads (see parseToml)" });
    return {};
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

  // DASA 1.4.1: the web side, which shows untrusted email, gets only the
  // reviewed permissions, from the one reviewed capability file.
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
    // Review: only the reviewed keys; `remote` would let websites call it.
    const extra = Object.keys(capability).filter((k) => !REVIEWED_CAPABILITY_KEYS.includes(k));
    if (extra.length) {
      push(
        "DASA 1.4.1",
        "src-tauri/capabilities/default.json",
        `keys not reviewed: ${extra.join(", ")}`,
      );
    }
  }

  // Tauri's configs: the base one holds the reviewed security settings; a
  // platform or build config (tauri.<x>.conf.json, merged over it) may not
  // change them.
  for (const file of [...files.keys()].filter((f) =>
    /^src-tauri\/tauri(\.[\w-]+)?\.conf\.json$/.test(f),
  )) {
    const conf = json(files, file, findings, "DASA 1.4.1");
    if (!conf) continue;
    const base = file === "src-tauri/tauri.conf.json";
    if (!base && conf.app?.security !== undefined) {
      push(
        "CASA 5.1.7",
        file,
        "a platform config may not change app.security (the CSP or capabilities)",
      );
    }
    if (!base && conf.plugins?.updater !== undefined) {
      push("DASA 1.6.2", file, "a platform config may not change the updater");
    }
    if (conf.app?.security?.capabilities !== undefined) {
      push(
        "DASA 1.4.1",
        file,
        "capabilities belong in src-tauri/capabilities/default.json, not inline",
      );
    }
    for (const window of conf.app?.windows ?? []) {
      if (window?.devtools === true) push("DASA 1.8.2", file, "a window has devtools on");
    }
  }

  const conf = json(files, "src-tauri/tauri.conf.json", findings, "CASA 5.1.7");
  if (conf) {
    // CASA 5.1.7: the app's CSP keeps scripts to its own.
    for (const problem of cspProblems(conf.app?.security?.csp ?? "")) {
      push("CASA 5.1.7", "src-tauri/tauri.conf.json", `the CSP: ${problem}`);
    }
    const loosened = conf.app?.security?.dangerousDisableAssetCspModification;
    if (loosened !== undefined && JSON.stringify(loosened) !== '["style-src"]') {
      push(
        "CASA 5.1.7",
        "src-tauri/tauri.conf.json",
        `dangerousDisableAssetCspModification is ${JSON.stringify(loosened)}, reviewed: ["style-src"]`,
      );
    }
    // DASA 1.6.2 and 1.6.1: updates are signed, for their version, and
    // come over HTTPS.
    const updater = conf.plugins?.updater;
    if (typeof updater?.pubkey !== "string" || updater.pubkey.length < 40) {
      push(
        "DASA 1.6.2",
        "src-tauri/tauri.conf.json",
        "the updater has no public key to check updates against",
      );
    }
    if (updater?.requireSignedVersion !== true) {
      push(
        "DASA 1.6.2",
        "src-tauri/tauri.conf.json",
        "the updater must require the version to be signed (requireSignedVersion: true)",
      );
    }
    const endpoints: unknown[] = updater?.endpoints ?? [];
    if (
      !endpoints.length ||
      !endpoints.every((e) => typeof e === "string" && e.startsWith("https://"))
    ) {
      push("DASA 1.6.1", "src-tauri/tauri.conf.json", "every updater endpoint must be HTTPS");
    }
    if (updater?.dangerousInsecureTransportProtocol === true) {
      push("DASA 1.6.1", "src-tauri/tauri.conf.json", "the updater allows insecure transport");
    }
  }

  // DASA 1.8.2: no web inspector, and symbols stripped, in what ships.
  const appCargo = toml(files, "src-tauri/Cargo.toml", findings, "DASA 1.8.2");
  const tauriDep = appCargo?.dependencies?.tauri;
  if (Array.isArray(tauriDep?.features) && tauriDep.features.includes("devtools")) {
    push("DASA 1.8.2", "src-tauri/Cargo.toml", "Tauri's devtools feature is on");
  }
  const stripSetting = toml(files, "Cargo.toml", findings, "DASA 1.8.2")?.profile?.release?.strip;
  if (stripSetting !== true && stripSetting !== "symbols") {
    push("DASA 1.8.2", "Cargo.toml", "[profile.release] must set strip = true");
  }
  // DASA 2.1.2: Control Flow Guard on both Windows targets (the last
  // setting of the flag wins, so it must be on).
  const cargoConfig = toml(files, ".cargo/config.toml", findings, "DASA 2.1.2");
  for (const target of ["x86_64-pc-windows-msvc", "aarch64-pc-windows-msvc"]) {
    const flags: unknown[] = cargoConfig?.target?.[target]?.rustflags ?? [];
    const cfg = flags.findLast(
      (f): f is string => typeof f === "string" && f.startsWith("-Ccontrol-flow-guard"),
    );
    if (
      !cfg ||
      !["-Ccontrol-flow-guard", "-Ccontrol-flow-guard=yes", "-Ccontrol-flow-guard=checks"].includes(
        cfg,
      )
    ) {
      push("DASA 2.1.2", ".cargo/config.toml", `${target} must build with -Ccontrol-flow-guard`);
    }
  }

  for (const [file, text] of files) {
    const lines = text.split("\n");
    const marked = (line: number) => MARKER.test(lines[line - 1] ?? "");

    if (isAppTs(file)) {
      const bare = strip(text, "ts", true);
      const withStrings = strip(text, "ts", false);
      const each = (pattern: RegExp, source: string, report: (line: number) => void) => {
        for (const m of source.matchAll(pattern)) {
          const line = lineAt(source, m.index!);
          if (!marked(line)) report(line);
        }
      };
      // CASA 5.1.3: no code from strings.
      each(/(?<![\w$.])(?:eval|Function)\s*\(|\.\s*eval\s*\(|\bnew\s+Function\b/g, bare, (line) =>
        push("CASA 5.1.3", file, "code from a string", line),
      );
      // CASA 5.1.7: no HTML from strings, and React's raw HTML only where reviewed.
      each(
        /\.(?:inner|outer)HTML\s*=|insertAdjacentHTML\s*\(|document\s*\.\s*write\s*\(/g,
        bare,
        (line) => push("CASA 5.1.7", file, "HTML from a string", line),
      );
      // DASA 1.4.1: every frame is sandboxed, as a literal, without scripts.
      each(/allow-scripts/g, withStrings, (line) =>
        push("DASA 1.4.1", file, "a frame allows scripts", line),
      );
      each(/createElement\s*\(\s*["'`]iframe["'`]/g, withStrings, (line) =>
        push(
          "DASA 1.4.1",
          file,
          "a frame made outside JSX, where its sandbox can't be checked",
          line,
        ),
      );
      for (const m of withStrings.matchAll(/<iframe\b/g)) {
        const tag = withStrings.slice(m.index!, tagEnd(withStrings, m.index!) + 1);
        const line = lineAt(withStrings, m.index!);
        if (marked(line)) continue;
        if (!/\bsandbox="[^"]*"/.test(tag)) {
          push("DASA 1.4.1", file, 'an iframe without a literal sandbox="…"', line);
        }
      }
    }

    // CASA 5.1.7: React renders other HTML only where reviewed.
    if (isAppTs(file)) {
      const count = (strip(text, "ts", true).match(/dangerouslySetInnerHTML/g) ?? []).length;
      if (count !== (REVIEWED_INNER_HTML[file] ?? 0)) {
        push(
          "CASA 5.1.7",
          file,
          `dangerouslySetInnerHTML ${count} times, reviewed: ${REVIEWED_INNER_HTML[file] ?? 0}`,
        );
      }
    }

    if (isRust(file)) {
      const bare = strip(text, "rust", true);
      const withStrings = strip(text, "rust", false);
      // DASA 1.4.1: `unsafe` only where reviewed, each use counted (tests too).
      const unsafe = (bare.match(/\bunsafe\b/g) ?? []).length;
      if (unsafe !== (REVIEWED_UNSAFE[file] ?? 0)) {
        push(
          "unsafe (reviewed)",
          file,
          `unsafe ${unsafe} times, reviewed: ${REVIEWED_UNSAFE[file] ?? 0}`,
        );
      }
      // DASA 1.1.2: certificates are always checked.
      // Only a literal `false` is safe to leave in.
      for (const m of bare.matchAll(
        /danger_accept_invalid_(certs|hostnames)\s*\((?!\s*false\s*\))/g,
      )) {
        const line = lineAt(bare, m.index!);
        if (!marked(line)) push("DASA 1.1.2", file, "TLS checks turned off", line);
      }
      const inTests = /(^|\/)tests\//.test(file);
      const ranges = inTests ? [] : rustTestRanges(text);
      const isTest = (line: number) => inTests || ranges.some(([a, b]) => line >= a && line <= b);
      // DASA 1.4.2: programs run directly, never through a shell.
      for (const m of withStrings.matchAll(
        /Command::new\(\s*"(?:\/bin\/|\/usr\/bin\/)?(?:sh|bash|zsh|cmd|powershell|pwsh)(?:\.exe)?"|Path::new\(\s*"\/bin\/(?:sh|bash|zsh)"/g,
      )) {
        const line = lineAt(withStrings, m.index!);
        if (!isTest(line) && !marked(line)) push("DASA 1.4.2", file, "a shell", line);
      }
      // DASA 1.1.1: requests go over HTTPS, except to this computer.
      // A host filled in later (`format!("http://{host}")`) counts: only the
      // bare prefix `"http://"` (as in `strip_prefix`) has no host.
      for (const m of withStrings.matchAll(/"http:\/\/([^"/:?{\s]*)/g)) {
        const host = m[1]!;
        if (
          (host === "" && withStrings[m.index! + m[0].length] === '"') ||
          host === "127.0.0.1" ||
          host === "localhost" ||
          host.endsWith(".localhost")
        )
          continue;
        const line = lineAt(withStrings, m.index!);
        if (!isTest(line) && !marked(line)) push("DASA 1.1.1", file, `plain HTTP to ${host}`, line);
      }
    }

    // DASA 1.2.4: no secrets in the repository. (This file and its test
    // hold the patterns themselves.)
    if (file !== "scripts/security.ts" && file !== "scripts/security.test.ts") {
      lines.forEach((l, i) => {
        if (MARKER.test(l)) return;
        if (/GOCSPX-[A-Za-z0-9_-]{20,}/.test(l))
          push("DASA 1.2.4", file, "a Google client secret", i + 1);
        if (/-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:minisign|rsign) encrypted secret key/.test(l)) {
          push("DASA 1.2.4", file, "a private key", i + 1);
        }
      });
    }
  }

  // The website's response headers: its scripts its own, with nosniff,
  // against script injection (CASA 5.1.7); HSTS, which supports CASA 4.1.1
  // (TLS itself is the SSL Labs report's); and not framed by any site, a
  // hardening control no test case asks for.
  const headers = files.get("website/_headers");
  if (headers === undefined) {
    push("CASA 5.1.7", "website/_headers", "missing");
  } else {
    const csp = /^\s*Content-Security-Policy:\s*(.*)$/im.exec(headers)?.[1] ?? "";
    if (!csp) push("CASA 5.1.7", "website/_headers", "no Content-Security-Policy");
    for (const problem of cspProblems(csp))
      push("CASA 5.1.7", "website/_headers", `the CSP: ${problem}`);
    if (!/X-Content-Type-Options:\s*nosniff/i.test(headers)) {
      push("CASA 5.1.7", "website/_headers", "no X-Content-Type-Options: nosniff");
    }
    const hsts = /Strict-Transport-Security:\s*max-age=(\d+)/i.exec(headers);
    if (!hsts || Number(hsts[1]) < 15552000) {
      // Supports CASA 4.1.1, whose evidence is the SSL Labs report.
      push("hsts", "website/_headers", "HSTS must last at least 180 days");
    }
    const ancestors = (directives(csp).get("frame-ancestors") ?? []).join(" ");
    if (ancestors !== "'none'") {
      push("framing", "website/_headers", `frame-ancestors must be 'none', is "${ancestors}"`);
    }
  }

  return findings;
}
