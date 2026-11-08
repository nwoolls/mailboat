import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CLAIMS,
  claimProblems,
  parseScopes,
  plainText,
  policyPermissionItems,
  POLICY_SOURCES,
  SCOPE_LABELS,
  scopeProblems,
  withoutComments,
} from "./policy";

const read = (path: string) => readFileSync(resolve(__dirname, "..", path), "utf8");

// The real files: the policy, and the Rust that decides what the app asks for.
const POLICY = read("website/privacy.html");
const OAUTH = read("crates/core/src/auth/oauth.rs");
const SOURCES = Object.fromEntries(POLICY_SOURCES.map((path) => [path, read(path)]));
const SETTINGS_PATH = "crates/core/src/settings.rs";
const UPDATES_PATH = "src-tauri/src/updates.rs";

const OAUTH_FIXTURE = `
pub const SCOPES: [&str; 3] = [
    "openid",
    // A comment, with a "quoted" word and a URL: https://example.com/x
    GMAIL_SCOPE,
    "https://www.googleapis.com/auth/calendar.events", // trailing comment
];
pub const GMAIL_SCOPE: &str = "https://www.googleapis.com/auth/gmail.modify";
pub const UNUSED: &str = "https://www.googleapis.com/auth/unused";
`;

const policy = (items: string[]) => `<h2>Google data the app uses, and why</h2>
<p>Asks for these:</p><ul>${items.map((i) => `<li><strong>${i}:</strong> why.</li>`).join("")}</ul>
<h2>Where your data is kept</h2><ul><li><strong>Not this one:</strong> x</li></ul>`;

describe("withoutComments", () => {
  it("drops line and nested block comments, and keeps strings and characters", () => {
    const rust = [
      'let a = "// not a comment"; // gone',
      "/* gone /* nested */ still gone */ let b = 1;",
      'let c = \'"\'; let d = "a \\" /* kept */";',
    ].join("\n");
    expect(withoutComments(rust)).toBe(
      [
        'let a = "// not a comment"; ',
        " let b = 1;",
        'let c = \'"\'; let d = "a \\" /* kept */";',
      ].join("\n"),
    );
  });
});

describe("parseScopes", () => {
  it("reads strings and named constants, ignoring comments", () => {
    expect(parseScopes(OAUTH_FIXTURE)).toEqual([
      "openid",
      "https://www.googleapis.com/auth/gmail.modify",
      "https://www.googleapis.com/auth/calendar.events",
    ]);
  });

  it("fails loudly when the array can't be read", () => {
    expect(() => parseScopes("fn main() {}")).toThrow(/pub const SCOPES/);
    expect(() => parseScopes('pub const SCOPES: [&str; 2] = ["openid", MISSING];')).toThrow(
      /MISSING/,
    );
    expect(() => parseScopes('pub const SCOPES: [&str; 3] = ["openid"];')).toThrow(
      /says 3 entries/,
    );
  });

  it("is not fooled by a commented-out older declaration above the real one", () => {
    const stale =
      '/* pub const SCOPES: [&str; 1] = ["openid"]; */\n// pub const SCOPES: [&str; 1] = ["profile"];\n';
    expect(parseScopes(stale + OAUTH_FIXTURE)).toHaveLength(3);
  });

  it("reads the real SCOPES, every one with a line in the policy", () => {
    const scopes = parseScopes(OAUTH);
    expect(scopes).toContain("https://www.googleapis.com/auth/gmail.modify");
    expect(scopes.length).toBeGreaterThanOrEqual(8);
    expect(scopeProblems(scopes, POLICY)).toEqual([]);
  });

  it("has a label for every real scope, and no label for one that isn't asked for", () => {
    // Without this, scopeProblems returning nothing could mean it checked nothing.
    expect(new Set(Object.keys(SCOPE_LABELS))).toEqual(new Set(parseScopes(OAUTH)));
  });
});

describe("scopeProblems", () => {
  const scopes = parseScopes(OAUTH_FIXTURE);
  const labels = [
    "Your name, email address and profile picture",
    "Gmail (read, organise, draft and send)",
    "Google Calendar events",
  ];
  // The fixture asks for openid alone; the real list asks for all three identity scopes.
  const identity = [
    "openid",
    "email",
    "profile",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/calendar.events",
  ];

  it("accepts a policy that lists exactly what is asked for", () => {
    expect(scopeProblems(identity, policy(labels))).toEqual([]);
  });

  it("reads the policy's labels from the permission list only", () => {
    expect(policyPermissionItems(policy(["Gmail settings"]))).toEqual(["Gmail settings"]);
    expect(policyPermissionItems("<h2>Other</h2>")).toBeUndefined();
  });

  it("decodes entities in a label", () => {
    expect(scopeProblems(identity, policy(labels.map((l) => l.replace(" ", "&#32;"))))).toEqual([]);
    expect(policyPermissionItems(policy(["Mail &amp; more"]))).toEqual(["Mail & more"]);
  });

  it("fails a permission the policy doesn't list", () => {
    expect(scopeProblems(identity, policy(labels.slice(0, 2)))).toEqual([
      'SCOPES asks for a permission the policy doesn\'t list: "Google Calendar events"',
    ]);
  });

  it("fails a line for a permission that is no longer asked for", () => {
    const problems = scopeProblems(identity, policy([...labels, "Google Contacts (read only)"]));
    expect(problems).toEqual([expect.stringContaining('lists "Google Contacts (read only)"')]);
  });

  it("fails a line with no bold label, so a permission can't be claimed in plain text", () => {
    const html = policy(labels).replace("</ul>", "<li>Drive: full access</li></ul>");
    expect(scopeProblems(identity, html)).toEqual([expect.stringContaining("has no bold label")]);
  });

  it("needs every scope behind a shared label, not just one of them", () => {
    // The policy still says name, email address and picture; SCOPES dropped two of the three.
    const problems = scopeProblems(["openid", ...identity.slice(3)], policy(labels));
    expect(problems).toEqual([
      expect.stringContaining("covers email, which SCOPES no longer asks for"),
      expect.stringContaining("covers profile, which SCOPES no longer asks for"),
    ]);
  });

  it("fails a scope that has no label at all, so a new permission can't slip in", () => {
    const withNew = [...identity, "https://www.googleapis.com/auth/drive"];
    expect(scopeProblems(withNew, policy(labels))).toEqual([
      expect.stringContaining("SCOPES asks for https://www.googleapis.com/auth/drive"),
    ]);
  });

  it("fails when the permission list can't be found", () => {
    expect(scopeProblems(scopes, "<h2>Nothing</h2>")).toEqual([
      expect.stringContaining("can't find the list of Google permissions"),
    ]);
  });
});

/** The problems found once one line of a Rust source is changed (the line has to exist). */
function changed(path: string, from: string, to: string): string[] {
  const source = SOURCES[path]!;
  expect(source).toContain(from);
  return claimProblems(POLICY, { ...SOURCES, [path]: source.replace(from, to) });
}

describe("the defaults the policy states", () => {
  it("are what the code does today", () => {
    expect(claimProblems(POLICY, SOURCES)).toEqual([]);
  });

  it("each pinned line is really in the code, so the table itself proves something", () => {
    expect(CLAIMS.length).toBeGreaterThanOrEqual(8);
    const text = plainText(POLICY);
    for (const claim of CLAIMS) {
      const source = withoutComments(SOURCES[claim.file]!);
      for (const line of claim.lines) expect(source, `${claim.file}: ${line}`).toContain(line);
      // A sentence with the site's address in it is matched by claimProblems instead.
      for (const sentence of claim.says.filter((s) => !s.includes("<site>"))) {
        expect(text, sentence).toContain(sentence);
      }
    }
  });

  it("fail when a default changes without the policy", () => {
    expect(
      changed(
        SETTINGS_PATH,
        "remote_images: RemoteImages::Load,",
        "remote_images: RemoteImages::Block,",
      ),
    ).toEqual([expect.stringContaining("Remote images load by default")]);
    expect(changed(SETTINGS_PATH, "image_prefetch: true,", "image_prefetch: false,")).toEqual([
      expect.stringContaining("Remote images load by default"),
    ]);
    expect(
      changed(SETTINGS_PATH, "auto_check_updates: true,", "auto_check_updates: false,"),
    ).toEqual([expect.stringContaining("When it starts and about once a day")]);
    expect(
      changed(
        SETTINGS_PATH,
        "reader_summary: ReaderSummary::Auto,",
        "reader_summary: ReaderSummary::Off,",
      ),
    ).toEqual([expect.stringContaining("With Claude or ChatGPT chosen for summaries")]);
    expect(
      changed(
        SETTINGS_PATH,
        "writing_provider: AiProvider::Apple,",
        "writing_provider: AiProvider::Claude,",
      ),
    ).toEqual([expect.stringContaining("AI features, only if you turn them on")]);
    expect(
      changed(SETTINGS_PATH, "mcp: McpSettings::default(),", "mcp: McpSettings { read: vec![] },"),
    ).toEqual([expect.stringContaining("AI apps, only if you turn them on")]);
  });

  it("fail when the schedule for update checks changes, not only the on/off default", () => {
    expect(
      changed(
        UPDATES_PATH,
        "const LOOK_EVERY: Duration = Duration::from_secs(24 * 60 * 60);",
        "const LOOK_EVERY: Duration = Duration::from_secs(60 * 60);",
      ),
    ).toEqual([expect.stringContaining("When it starts and about once a day")]);
  });

  it("fail when AppSettings takes its AI defaults from somewhere else", () => {
    expect(
      changed(SETTINGS_PATH, "ai: AiSettings::default(),", "ai: cloud_ai_defaults(),"),
    ).toEqual([expect.stringContaining("AI features, only if you turn them on")]);
  });

  it("don't count a line that is only commented out", () => {
    expect(
      changed(
        SETTINGS_PATH,
        "image_prefetch: true,",
        "image_prefetch: false, /* image_prefetch: true, */",
      ),
    ).toEqual([expect.stringContaining("Remote images load by default")]);
    expect(
      changed(
        SETTINGS_PATH,
        "image_prefetch: true,",
        "image_prefetch: false, // image_prefetch: true,",
      ),
    ).toEqual([expect.stringContaining("Remote images load by default")]);
  });

  it("fail when the policy stops saying one of them, or qualifies it", () => {
    const reworded = POLICY.replace(
      "Remote images load by default",
      "Remote images load sometimes",
    );
    expect(claimProblems(reworded, SOURCES)).toEqual([expect.stringContaining("no longer says")]);
    // A qualifier that changes what the sentence means is not the same sentence.
    const qualified = POLICY.replace(
      "Remote images load by default",
      "Remote images load by default only if you turn them on",
    );
    expect(claimProblems(qualified, SOURCES)).toEqual([expect.stringContaining("no longer says")]);
  });

  it("find McpSettings' derive even with other attributes in between", () => {
    const withAttribute = SOURCES[SETTINGS_PATH]!.replace(
      /(#\[serde\([^\]]*\)\]\n)(pub struct McpSettings)/,
      "$1#[allow(dead_code)]\n$2",
    );
    expect(withAttribute).not.toBe(SOURCES[SETTINGS_PATH]);
    expect(claimProblems(POLICY, { ...SOURCES, [SETTINGS_PATH]: withAttribute })).toEqual([]);
  });

  it("fail when AI apps stop starting empty", () => {
    const noDefault = SOURCES[SETTINGS_PATH]!.replace(
      /(#\[derive\([^)]*)\bDefault, ([^)]*\)\]\s*#\[serde[^\]]*\]\s*pub struct McpSettings)/,
      "$1$2",
    );
    expect(noDefault).not.toBe(SOURCES[SETTINGS_PATH]);
    expect(claimProblems(POLICY, { ...SOURCES, [SETTINGS_PATH]: noDefault })).toEqual([
      expect.stringContaining("McpSettings no longer derives Default"),
    ]);
  });
});
