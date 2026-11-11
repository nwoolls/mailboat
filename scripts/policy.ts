// Keeps the privacy policy (website/privacy.html) true to the code. Google's
// verification reads the policy against the app, so these fail the checks
// when the two disagree (run by `bun run check:website`, part of every check;
// the rules are tested in scripts/policy.test.ts, also against the real files).
//
// Two things are guarded:
//  - the Google permissions: every scope in `SCOPES`
//    (crates/core/src/auth/oauth.rs) has its line in the policy's list, and the
//    list names no permission the app doesn't ask for;
//  - the defaults the policy states (remote images, update checks, AI, AI
//    apps): the code's default still matches the sentence that describes it.
//
// Both read Rust source as text, which is blunt but has no build step, so they
// run in the web checks that every pull request gets, site-only ones included.

/** A scope's line in the policy's list of Google permissions: the bold label that opens it. */
export const SCOPE_LABELS: Record<string, string> = {
  openid: "Your name, email address and profile picture",
  email: "Your name, email address and profile picture",
  profile: "Your name, email address and profile picture",
  "https://www.googleapis.com/auth/gmail.modify": "Gmail (read, organize, draft and send)",
  "https://www.googleapis.com/auth/gmail.settings.basic": "Gmail settings",
  "https://www.googleapis.com/auth/calendar.events.owned":
    "Google Calendar events on calendars you own",
  "https://www.googleapis.com/auth/contacts.readonly": "Google Contacts (read only)",
  "https://www.googleapis.com/auth/contacts.other.readonly": "Other contacts (read only)",
};

/** The character an HTML entity stands for, for the few a page is likely to use. */
function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** HTML as plain text: tags gone, entities decoded, whitespace collapsed (lines wrap in the source). */
export function plainText(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:])/g, "$1")
    .trim();
}

/**
 * Rust source with its comments gone (line comments and nested block
 * comments), so a line that is only commented out can't count as present.
 * String and character literals stay (a `//` inside one isn't a comment), raw
 * strings included, except that a string spanning lines becomes an empty one:
 * its lines can't pass for code.
 */
export function withoutComments(rust: string): string {
  let out = "";
  let i = 0;
  while (i < rust.length) {
    const c = rust[i]!;
    const next = rust[i + 1];
    const raw = /^b?r(#*)"/.exec(rust.slice(i, i + 40));
    if (rust.startsWith("'\"'", i)) {
      out += "'\"'";
      i += 3;
    } else if (raw && !/[\w]/.test(rust[i - 1] ?? " ")) {
      // r#"…"#: ends at a quote followed by as many hashes as it opened with.
      const closing = `"${"#".repeat(raw[1]!.length)}`;
      const end = rust.indexOf(closing, i + raw[0].length);
      const stop = end === -1 ? rust.length : end + closing.length;
      const literal = rust.slice(i, stop);
      out += literal.includes("\n") ? '""' : literal;
      i = stop;
    } else if (c === '"') {
      let j = i + 1;
      while (j < rust.length && rust[j] !== '"') j += rust[j] === "\\" ? 2 : 1;
      const literal = rust.slice(i, j + 1);
      out += literal.includes("\n") ? '""' : literal;
      i = j + 1;
    } else if (c === "/" && next === "/") {
      while (i < rust.length && rust[i] !== "\n") i++;
    } else if (c === "/" && next === "*") {
      let depth = 1;
      i += 2;
      while (i < rust.length && depth > 0) {
        if (rust.startsWith("/*", i)) {
          depth++;
          i += 2;
        } else if (rust.startsWith("*/", i)) {
          depth--;
          i += 2;
        } else {
          i++;
        }
      }
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/**
 * The permissions `SCOPES` asks for, as Google's scope strings: the entries of
 * `pub const SCOPES` in oauth.rs, with each named constant looked up. Throws
 * when the array can't be read, so a refactor fails loudly instead of passing
 * an empty list.
 */
export function parseScopes(scopesSource: string): string[] {
  const source = withoutComments(scopesSource);
  const array = /pub const SCOPES: \[&str; (\d+)\] = \[([\s\S]*?)\];/.exec(source);
  if (!array) throw new Error("pub const SCOPES is not in oauth.rs in the form this check reads");
  const constants = new Map<string, string>();
  for (const m of source.matchAll(/pub const ([A-Z_]+): &str = "([^"]+)";/g)) {
    constants.set(m[1]!, m[2]!);
  }
  const scopes = array[2]!
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "")
    .map((entry) => {
      const literal = /^"([^"]+)"$/.exec(entry);
      if (literal) return literal[1]!;
      const named = constants.get(entry);
      if (named === undefined)
        throw new Error(`SCOPES names ${entry}, which this check can't find`);
      return named;
    });
  if (scopes.length !== Number(array[1])) {
    throw new Error(`SCOPES says ${array[1]} entries but ${scopes.length} were read`);
  }
  return scopes;
}

/**
 * The lines of the policy's list of Google permissions, each with the bold
 * label that opens it (null for a line without one). Undefined when the list
 * can't be found under its heading.
 */
export function policyPermissionItems(policyHtml: string): (string | null)[] | undefined {
  const section = /<h2>Google data the app uses and why<\/h2>([\s\S]*?)<h2>/.exec(policyHtml);
  const list = section && /<ul>([\s\S]*?)<\/ul>/.exec(section[1]!);
  if (!list) return undefined;
  return [...list[1]!.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map((item) => {
    const label = /^\s*<strong>([\s\S]*?)<\/strong>/.exec(item[1]!);
    return label ? plainText(label[1]!).replace(/:$/, "") : null;
  });
}

/**
 * Problems between the permissions the app asks for and the policy's list of
 * them, one line each (empty when they agree). A permission needs a line, and
 * a line needs a permission: the policy says only what the code does. A label
 * shared by several scopes (name, email address and picture) needs all of them.
 */
export function scopeProblems(scopes: string[], policyHtml: string): string[] {
  const items = policyPermissionItems(policyHtml);
  if (!items) {
    return ["privacy.html: can't find the list of Google permissions under its heading"];
  }
  const problems: string[] = [];
  if (items.includes(null)) {
    problems.push(
      "privacy.html: a line in the list of Google permissions has no bold label, so it can't be checked against SCOPES",
    );
  }
  const labels = items.filter((label): label is string => label !== null);
  const asked = new Set<string>();
  for (const scope of scopes) {
    const label = SCOPE_LABELS[scope];
    if (label === undefined) {
      problems.push(
        `SCOPES asks for ${scope}, which has no line in the policy: add the line to privacy.html and to SCOPE_LABELS in scripts/policy.ts`,
      );
    } else {
      asked.add(label);
    }
  }
  for (const label of asked) {
    if (!labels.includes(label)) {
      problems.push(`SCOPES asks for a permission the policy doesn't list: "${label}"`);
    }
    for (const [scope, own] of Object.entries(SCOPE_LABELS)) {
      if (own === label && !scopes.includes(scope)) {
        problems.push(
          `the policy's "${label}" covers ${scope}, which SCOPES no longer asks for: change the line, or the scope is missing`,
        );
      }
    }
  }
  for (const label of labels) {
    if (!asked.has(label)) {
      problems.push(
        `privacy.html lists "${label}", but SCOPES doesn't ask for it: remove the line, or the permission was dropped`,
      );
    }
  }
  return problems;
}

/** A Rust item's text: from its opening line to the closing brace at the start of a line. */
function rustItem(source: string, header: string): string | undefined {
  if (header === "") return source;
  const start = source.indexOf(header);
  if (start === -1) return undefined;
  const end = source.indexOf("\n}\n", start);
  return source.slice(start, end === -1 ? undefined : end + 3);
}

/**
 * A function's text with comments gone and white space collapsed, so a claim
 * can pin the whole of a small function: any change to it fails the check, and
 * nothing written to look like one of its lines can stand in for it.
 */
export function itemText(source: string, header: string): string | undefined {
  const item = rustItem(withoutComments(source), header);
  return item === undefined ? undefined : item.replace(/\s+/g, " ").trim();
}

/** Where the code decides a default, as a path from the repository's root. */
const SETTINGS_RS = "crates/core/src/settings.rs";
const UPDATES_RS = "src-tauri/src/updates.rs";
const TAURI_CONF = "src-tauri/tauri.conf.json";
// TypeScript: the Settings → AI rule a policy sentence depends on.
const PROVIDERS_TS = "src/features/ai/model/providers.ts";
export const POLICY_SOURCES = [SETTINGS_RS, UPDATES_RS, TAURI_CONF, PROVIDERS_TS];

type Claim = {
  /**
   * Whole sentences of the policy, as they read once tags and line breaks are
   * gone. `<site>` stands for the website's address, which has to be the
   * updater's (the brand check keeps the app's name out of scripts).
   */
  says: string[];
  /** The Rust file, and the item in it ("" for the whole file), that makes it true. */
  file: string;
  item: string;
  /** Lines the item must contain. */
  lines: string[];
  /**
   * For a small function: its whole text (`itemText`), which must be exactly
   * this. `lines` is then not used.
   */
  exact?: string;
};

const APP_DEFAULT = "impl Default for AppSettings {";
const AI_DEFAULT = "impl Default for AiSettings {";

/**
 * The defaults the policy states, each with the whole sentences that state it
 * and the lines in the code that make it true. Whole sentences, so a
 * qualifier added to one fails here; changing a default, or the way the
 * policy puts it, means changing both, and this table with them.
 */
export const CLAIMS: Claim[] = [
  {
    says: [
      "Remote images load by default, and the app downloads the images of new mail as it arrives, so the server that hosts them is contacted before you open the message.",
    ],
    file: SETTINGS_RS,
    item: APP_DEFAULT,
    lines: ["remote_images: RemoteImages::Load,", "image_prefetch: true,"],
  },
  {
    says: [
      "When it starts and about once a day, the app fetches one small file from <site>, which passes it on to GitHub, so both see your IP address.",
    ],
    file: SETTINGS_RS,
    item: APP_DEFAULT,
    lines: ["auto_check_updates: true,"],
  },
  {
    // The "about once a day" is this constant, not the on/off setting above.
    says: [
      "When it starts and about once a day, the app fetches one small file from <site>, which passes it on to GitHub, so both see your IP address.",
    ],
    file: UPDATES_RS,
    item: "",
    lines: ["const LOOK_EVERY: Duration = Duration::from_secs(24 * 60 * 60);"],
  },
  {
    says: ["AI features, only if you turn them on."],
    file: SETTINGS_RS,
    item: APP_DEFAULT,
    lines: ["ai: AiSettings::default(),"],
  },
  {
    says: ["AI features, only if you turn them on."],
    file: SETTINGS_RS,
    item: AI_DEFAULT,
    lines: [
      "connected: Vec::new(),",
      "reader_provider: AiProvider::Apple,",
      "writing_provider: AiProvider::Apple,",
      'list_summaries: cfg!(target_os = "macos").then_some(AiProvider::Apple),',
    ],
  },
  {
    // The rule lives in the Settings → AI screen, not in Rust's defaults, so it
    // is pinned whole; that the screen calls it is tested in AiSection.test.tsx.
    says: [
      "Choosing Claude or ChatGPT for the summary above a conversation changes an automatic summary to a Summarize button, so nothing is sent until you press it.",
    ],
    file: PROVIDERS_TS,
    item: "export function readerChoice(",
    lines: [],
    exact:
      'export function readerChoice( ai: Pick<AiChoices, "readerSummary">, provider: AiProvider, ): Pick<AiChoices, "readerProvider" | "readerSummary"> { const manual = leavesMac(provider) && ai.readerSummary === "auto"; return { readerProvider: provider, readerSummary: manual ? "button" : ai.readerSummary, }; }',
  },
  {
    says: [
      "If you turn off Keep saved summaries in Settings → AI, they are cleared when the app quits and when it next starts.",
    ],
    file: SETTINGS_RS,
    item: AI_DEFAULT,
    lines: ["keep_summaries: true,"],
  },
  {
    says: [
      "Images the app downloads are kept in a cache of limited size, 500 MB unless you change it in Settings → Viewing.",
    ],
    file: SETTINGS_RS,
    item: APP_DEFAULT,
    lines: ["image_cache_mb: 500,"],
  },
  {
    says: [
      "AI apps, only if you turn them on.",
      "It is off for every account until you turn it on, it can never send, and Spam and Trash are never shared.",
    ],
    file: SETTINGS_RS,
    item: APP_DEFAULT,
    lines: ["mcp: McpSettings::default(),"],
  },
  {
    says: [
      "It is off for every account until you turn it on, it can never send, and Spam and Trash are never shared.",
    ],
    file: SETTINGS_RS,
    item: "pub struct McpSettings {",
    lines: ["pub read: Vec<AccountId>,", "pub drafts: Vec<AccountId>,"],
  },
];

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Whether the policy has this sentence whole: at the start of a sentence (so
 * "It is false that…" in front of it doesn't pass) and ending where it ends.
 * `<site>` is the updater's host.
 */
function policyHas(policy: string, sentence: string, host: string): boolean {
  const pattern = sentence.split("<site>").map(escaped).join(escaped(host));
  return new RegExp(`(?:^|[.!?] )${pattern}(?: |$)`).test(policy);
}

/** The host the app's updater fetches from, per tauri.conf.json (undefined if it can't be read). */
function updaterHost(tauriConf: string | undefined): string | undefined {
  try {
    const conf = JSON.parse(tauriConf ?? "") as {
      plugins?: { updater?: { endpoints?: string[] } };
    };
    return new URL(conf.plugins?.updater?.endpoints?.[0] ?? "").host;
  } catch {
    return undefined;
  }
}

/**
 * Whether the item has this line as its own line, once: not inside a string,
 * not behind a conditional-compilation attribute (on it or above it), and not
 * set again by another line (which would win).
 */
function hasActiveLine(item: string, line: string): boolean {
  const lines = item.split("\n").map((l) => l.trim());
  const at = lines.indexOf(line);
  if (at === -1) return false;
  for (let i = at - 1; i >= 0; i--) {
    if (lines[i] === "") continue;
    if (lines[i]!.startsWith("#[")) return false;
    break;
  }
  const key = line.split(/[:=]/)[0]!.trim();
  return lines.filter((l) => l.startsWith(`${key}:`) || l.startsWith(`${key} =`)).length === 1;
}

/** Whether the attributes just above `pub struct McpSettings` derive `Default`. */
function mcpDerivesDefault(source: string): boolean {
  const at = source.indexOf("pub struct McpSettings");
  if (at === -1) return false;
  const above = source.slice(0, at).split("\n");
  const attributes: string[] = [];
  for (let i = above.length - 1; i >= 0; i--) {
    const line = above[i]!.trim();
    if (line === "") continue;
    if (!line.startsWith("#[")) break;
    attributes.push(line);
  }
  return attributes.some((a) => /^#\[derive\([^)]*\bDefault\b[^)]*\)\]$/.test(a));
}

/**
 * Problems between the defaults the policy states and the code, one line
 * each. `sources` holds the Rust files by path (`POLICY_SOURCES`). A sentence
 * missing from the policy is a problem too: change that claim in CLAIMS on
 * purpose, or put the sentence back.
 */
export function claimProblems(policyHtml: string, sources: Record<string, string>): string[] {
  const policy = plainText(policyHtml);
  const host = updaterHost(sources[TAURI_CONF]);
  const problems: string[] = [];
  const reported = new Set<string>();
  const report = (problem: string) => {
    if (!reported.has(problem)) problems.push(problem);
    reported.add(problem);
  };
  if (host === undefined) {
    report(
      `${TAURI_CONF}: can't read the updater's address, which the policy's address must match`,
    );
  }
  for (const claim of CLAIMS) {
    for (const sentence of claim.says) {
      if (!policyHas(policy, sentence, host ?? "")) {
        report(
          `privacy.html no longer says "${sentence.slice(0, 70)}…" as a whole: update CLAIMS in scripts/policy.ts to match`,
        );
      }
    }
    const text = sources[claim.file];
    if (claim.exact !== undefined) {
      const now = text === undefined ? undefined : itemText(text, claim.item);
      if (now === undefined) {
        report(`${claim.file}: can't find "${claim.item}" for the policy's "${claim.says[0]}"`);
      } else if (now !== claim.exact) {
        report(
          `the policy says "${claim.says[0]!.slice(0, 70)}…", but ${claim.file} (${claim.item}) changed: change the code and the policy together, then update CLAIMS`,
        );
      }
      continue;
    }
    const item = text === undefined ? undefined : rustItem(withoutComments(text), claim.item);
    if (item === undefined) {
      report(`${claim.file}: can't find "${claim.item}" for the policy's "${claim.says[0]}"`);
      continue;
    }
    for (const line of claim.lines) {
      if (!hasActiveLine(item, line)) {
        report(
          `the policy says "${claim.says[0]!.slice(0, 70)}…", but ${claim.file} ${claim.item === "" ? "" : `(${claim.item}) `}no longer has \`${line}\`: change the default and the policy together`,
        );
      }
    }
  }
  const settings = sources[SETTINGS_RS];
  if (settings !== undefined && !mcpDerivesDefault(withoutComments(settings))) {
    report(
      'the policy says AI apps are "off for every account until you turn it on", but McpSettings no longer derives Default',
    );
  }
  return problems;
}
