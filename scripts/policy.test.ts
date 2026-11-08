import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CLAIMS,
  claimProblems,
  parseScopes,
  plainText,
  policyPermissionLabels,
  SCOPE_LABELS,
  scopeProblems,
} from "./policy";

const read = (path: string) => readFileSync(resolve(__dirname, "..", path), "utf8");

// The real files: the policy, and the Rust that decides what the app asks for.
const POLICY = read("website/privacy.html");
const OAUTH = read("crates/core/src/auth/oauth.rs");
const SETTINGS = read("crates/core/src/settings.rs");

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

  it("reads the real SCOPES, every one with a line in the policy", () => {
    const scopes = parseScopes(OAUTH);
    expect(scopes).toContain("https://www.googleapis.com/auth/gmail.modify");
    expect(scopes.length).toBeGreaterThanOrEqual(8);
    expect(scopeProblems(scopes, POLICY)).toEqual([]);
  });
});

describe("scopeProblems", () => {
  const scopes = parseScopes(OAUTH_FIXTURE);
  const labels = [
    "Your name, email address and profile picture",
    "Gmail (read, organise, draft and send)",
    "Google Calendar events",
  ];

  it("accepts a policy that lists exactly what is asked for", () => {
    expect(scopeProblems(scopes, policy(labels))).toEqual([]);
  });

  it("reads the policy's labels from the permission list only", () => {
    expect(policyPermissionLabels(policy(["Gmail settings"]))).toEqual(["Gmail settings"]);
    expect(policyPermissionLabels("<h2>Other</h2>")).toBeUndefined();
  });

  it("fails a permission the policy doesn't list", () => {
    const problems = scopeProblems(scopes, policy(labels.slice(0, 2)));
    expect(problems).toEqual([
      'SCOPES asks for a permission the policy doesn\'t list: "Google Calendar events"',
    ]);
  });

  it("fails a line for a permission that is no longer asked for", () => {
    const problems = scopeProblems(scopes, policy([...labels, "Google Contacts (read only)"]));
    expect(problems).toEqual([expect.stringContaining('lists "Google Contacts (read only)"')]);
  });

  it("fails a scope that has no label at all, so a new permission can't slip in", () => {
    const withNew = [...scopes, "https://www.googleapis.com/auth/drive"];
    expect(scopeProblems(withNew, policy(labels))).toEqual([
      expect.stringContaining("SCOPES asks for https://www.googleapis.com/auth/drive"),
    ]);
  });

  it("fails when the permission list can't be found", () => {
    expect(scopeProblems(scopes, "<h2>Nothing</h2>")).toEqual([
      expect.stringContaining("can't find the list of Google permissions"),
    ]);
  });

  it("labels only scopes the real code asks for (no stale label)", () => {
    const asked = new Set(parseScopes(OAUTH));
    for (const scope of Object.keys(SCOPE_LABELS)) expect(asked.has(scope), scope).toBe(true);
  });
});

/** The problems found once one line of settings.rs is changed (the line has to exist). */
function flipped(from: string, to: string): string[] {
  expect(SETTINGS).toContain(from);
  return claimProblems(POLICY, SETTINGS.replace(from, to));
}

describe("the defaults the policy states", () => {
  it("are what the code does today", () => {
    expect(claimProblems(POLICY, SETTINGS)).toEqual([]);
  });

  it("each sentence is really in the policy and each line in settings.rs", () => {
    // Guards the table itself: a claim that matched nothing would prove nothing.
    expect(CLAIMS.length).toBeGreaterThanOrEqual(7);
    const text = plainText(POLICY);
    for (const claim of CLAIMS) expect(text, claim.says).toContain(claim.says);
  });

  it("fail when a default changes without the policy", () => {
    expect(
      flipped("remote_images: RemoteImages::Load,", "remote_images: RemoteImages::Block,"),
    ).toEqual([expect.stringContaining("Remote images load by default")]);
    expect(flipped("image_prefetch: true,", "image_prefetch: false,")).toEqual([
      expect.stringContaining("downloads the images of new mail"),
    ]);
    expect(flipped("auto_check_updates: true,", "auto_check_updates: false,")).toEqual([
      expect.stringContaining("about once a day"),
    ]);
    expect(
      flipped("reader_summary: ReaderSummary::Auto,", "reader_summary: ReaderSummary::Off,"),
    ).toEqual([expect.stringContaining("a long conversation is summarised")]);
    expect(
      flipped("writing_provider: AiProvider::Apple,", "writing_provider: AiProvider::Claude,"),
    ).toEqual([expect.stringContaining("AI features, only if you turn them on")]);
    expect(flipped("mcp: McpSettings::default(),", "mcp: McpSettings { read: vec![] },")).toEqual([
      expect.stringContaining("AI apps, only if you turn them on"),
    ]);
  });

  it("fail when the policy stops saying one of them", () => {
    const changed = POLICY.replace("Remote images load by default", "Remote images load sometimes");
    expect(claimProblems(changed, SETTINGS)).toEqual([
      expect.stringContaining('no longer says "Remote images load by default"'),
    ]);
  });

  it("fail when AI apps stop starting empty", () => {
    const noDefault = SETTINGS.replace(
      /(#\[derive\([^)]*)\bDefault, ([^)]*\)\]\s*#\[serde[^\]]*\]\s*pub struct McpSettings)/,
      "$1$2",
    );
    expect(noDefault).not.toBe(SETTINGS);
    expect(claimProblems(POLICY, noDefault)).toEqual([
      expect.stringContaining("McpSettings no longer derives Default"),
    ]);
  });
});
