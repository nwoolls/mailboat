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
  "https://www.googleapis.com/auth/gmail.modify": "Gmail (read, organise, draft and send)",
  "https://www.googleapis.com/auth/gmail.settings.basic": "Gmail settings",
  "https://www.googleapis.com/auth/calendar.events": "Google Calendar events",
  "https://www.googleapis.com/auth/contacts.readonly": "Google Contacts (read only)",
  "https://www.googleapis.com/auth/contacts.other.readonly": "Other contacts (read only)",
};

/** HTML as plain text: tags gone, whitespace collapsed (the policy's lines wrap in the source). */
export function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:])/g, "$1")
    .trim();
}

/** `// …` comments gone from Rust source, leaving string literals alone. */
function withoutComments(rust: string): string {
  return rust
    .split("\n")
    .map((line) => {
      let inString = false;
      for (let i = 0; i < line.length; i++) {
        if (line[i] === '"' && line[i - 1] !== "\\") inString = !inString;
        if (!inString && line[i] === "/" && line[i + 1] === "/") return line.slice(0, i);
      }
      return line;
    })
    .join("\n");
}

/**
 * The permissions `SCOPES` asks for, as Google's scope strings: the entries of
 * `pub const SCOPES` in oauth.rs, with each named constant looked up. Throws
 * when the array can't be read, so a refactor fails loudly instead of passing
 * an empty list.
 */
export function parseScopes(oauthRs: string): string[] {
  const source = withoutComments(oauthRs);
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

/** The bold labels that open the lines of the policy's list of Google permissions. */
export function policyPermissionLabels(policyHtml: string): string[] | undefined {
  const section = /<h2>Google data the app uses, and why<\/h2>([\s\S]*?)<h2>/.exec(policyHtml);
  if (!section) return undefined;
  const list = /<ul>([\s\S]*?)<\/ul>/.exec(section[1]!);
  if (!list) return undefined;
  return [...list[1]!.matchAll(/<li>\s*<strong>([\s\S]*?)<\/strong>/g)].map((m) =>
    plainText(m[1]!).replace(/:$/, ""),
  );
}

/**
 * Problems between the permissions the app asks for and the policy's list of
 * them, one line each (empty when they agree). A permission needs a line, and
 * a line needs a permission: the policy says only what the code does.
 */
export function scopeProblems(scopes: string[], policyHtml: string): string[] {
  const labels = policyPermissionLabels(policyHtml);
  if (!labels) {
    return ["privacy.html: can't find the list of Google permissions under its heading"];
  }
  const problems: string[] = [];
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
  const start = source.indexOf(header);
  if (start === -1) return undefined;
  const end = source.indexOf("\n}\n", start);
  return source.slice(start, end === -1 ? undefined : end + 3);
}

type Claim = {
  /** What the policy says, as it reads once its tags and line breaks are gone. */
  says: string;
  /** Where the code decides it: an item in settings.rs, and lines it must contain. */
  item: string;
  lines: string[];
};

/**
 * The defaults the policy states, each with the sentence that states it and
 * the lines in settings.rs that make it true. Changing a default means
 * changing the sentence, so the two move together.
 */
export const CLAIMS: Claim[] = [
  {
    says: "Remote images load by default",
    item: "impl Default for AppSettings {",
    lines: ["remote_images: RemoteImages::Load,"],
  },
  {
    says: "downloads the images of new mail as it arrives",
    item: "impl Default for AppSettings {",
    lines: ["image_prefetch: true,"],
  },
  {
    says: "When it starts and about once a day, the app fetches one small file",
    item: "impl Default for AppSettings {",
    lines: ["auto_check_updates: true,"],
  },
  {
    says: "AI features, only if you turn them on.",
    item: "impl Default for AiSettings {",
    lines: [
      "connected: Vec::new(),",
      "reader_provider: AiProvider::Apple,",
      "writing_provider: AiProvider::Apple,",
      'list_summaries: cfg!(target_os = "macos").then_some(AiProvider::Apple),',
    ],
  },
  {
    says: "a long conversation is summarised when you open it",
    item: "impl Default for AiSettings {",
    lines: ["reader_summary: ReaderSummary::Auto,"],
  },
  {
    says: "AI apps, only if you turn them on.",
    item: "impl Default for AppSettings {",
    lines: ["mcp: McpSettings::default(),"],
  },
  {
    says: "It is off for every account until you turn it on",
    item: "pub struct McpSettings {",
    lines: ["pub read: Vec<AccountId>,", "pub drafts: Vec<AccountId>,"],
  },
];

/**
 * Problems between the defaults the policy states and settings.rs, one line
 * each. A sentence missing from the policy is a problem too: remove its claim
 * from CLAIMS on purpose, or put the sentence back.
 */
export function claimProblems(policyHtml: string, settingsRs: string): string[] {
  const policy = plainText(policyHtml);
  const source = withoutComments(settingsRs);
  const problems: string[] = [];
  for (const claim of CLAIMS) {
    if (!policy.includes(claim.says)) {
      problems.push(
        `privacy.html no longer says "${claim.says}": update CLAIMS in scripts/policy.ts with it`,
      );
    }
    const item = rustItem(source, claim.item);
    if (item === undefined) {
      problems.push(`settings.rs: can't find "${claim.item}" for the policy's "${claim.says}"`);
      continue;
    }
    for (const line of claim.lines) {
      if (!item.includes(line)) {
        problems.push(
          `the policy says "${claim.says}", but ${claim.item} no longer has \`${line}\`: change the default and the policy together`,
        );
      }
    }
  }
  // McpSettings must still start empty: its derive has to include Default.
  const derive = /#\[derive\(([^)]*)\)\]\s*#\[serde[^\]]*\]\s*pub struct McpSettings/.exec(source);
  if (!derive || !/\bDefault\b/.test(derive[1]!)) {
    problems.push(
      'the policy says AI apps are "off for every account until you turn it on", but McpSettings no longer derives Default',
    );
  }
  return problems;
}
