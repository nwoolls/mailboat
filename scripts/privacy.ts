// Real mail never goes in the repository (AGENTS.md → Real mail never goes in
// the repository). This is the pure part of `bun run check:privacy`: given a
// piece of text, it names what looks like real mail details. It can't know
// everything (a person's name, a company that sent something), so the written
// rule comes first and this catches the mechanical cases.

export type Finding = { kind: string; text: string };

/** Domains that can never belong to a real person. */
const FAKE_DOMAIN = /(^|\.)(example(\.[a-z]{2,3}){0,2}|invalid|test|localhost)$/i;

/** Real domains that are fine because they are the project's or the tools'. */
const PROJECT_DOMAIN = new Set([
  "github.com",
  "users.noreply.github.com",
  "anthropic.com",
  "google.com",
  "googlemail.com",
]);

/** Gmail placeholders and the owner's public author address. */
const GMAIL_OK = new Set([
  "me",
  "you",
  "someone",
  "someone.else",
  "user",
  "test",
  "a",
  "b",
  "x",
  "noreply",
  "no-reply",
]);

const EMAIL = /([A-Za-z0-9._%+-]+)@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/g;
const PHONE = /(?<![\d.])(?:\+?1[-. ])?\(?\d{3}\)?[-. ]\d{3}[-. ]\d{4}(?![\d.])/g;

/** Wording that reports what was measured on, or found in, a real mailbox. */
const MEASUREMENTS: [string, RegExp][] = [
  [
    "real-mailbox measurement",
    /\b\d[\d,]*\s+(?:cached|real)\s+(?:html\s+)?(?:emails?|messages?|mails?)\b/i,
  ],
  [
    "real-mailbox measurement",
    /\b\d+(?:\.\d+)?%\s+of\s+(?:the\s+)?(?:owner'?s\s+)?(?:cached\s+)?(?:html\s+)?(?:emails?|messages?|mail)\b/i,
  ],
  ["real-mailbox measurement", /\bon the (?:owner'?s |real )(?:real )?(?:cache|mailbox)\b/i],
  [
    "real-mailbox measurement",
    /\b(?:owner'?s|real)\s+(?:cache|mailbox|inbox)\b[^.\n]{0,80}\b\d[\d,]*\b/i,
  ],
  ["real-mailbox measurement", /\bfrom the (?:owner'?s |real )(?:cache|mailbox|mail)\b/i],
];

/** Lines can opt out with this marker, for a genuine false positive. */
const OPT_OUT = "privacy-ok";

export function findIssues(
  text: string,
  denylist: string[] = [],
  projectDomains: string[] = [],
): Finding[] {
  if (text.includes(OPT_OUT)) return [];
  const found: Finding[] = [];
  for (const m of text.matchAll(EMAIL)) {
    const local = m[1]!.toLowerCase();
    const domain = m[2]!.toLowerCase();
    if (FAKE_DOMAIN.test(domain) || PROJECT_DOMAIN.has(domain) || projectDomains.includes(domain))
      continue;
    if (domain === "gmail.com" && GMAIL_OK.has(local)) continue;
    if (/\.(png|jpe?g|gif|svg|webp|css|js|ts|tsx|json|rs)$/i.test(domain)) continue;
    found.push({ kind: "email address", text: m[0] });
  }
  for (const m of text.matchAll(PHONE)) {
    if (/[-. ]555[-. ]/.test(m[0])) continue;
    found.push({ kind: "phone number", text: m[0] });
  }
  for (const [kind, re] of MEASUREMENTS) {
    const m = text.match(re);
    if (m) found.push({ kind, text: m[0] });
  }
  const lower = text.toLowerCase();
  for (const term of denylist) {
    if (term && lower.includes(term.toLowerCase()))
      found.push({ kind: "denylisted term", text: "(a term from your local denylist)" });
  }
  return found;
}

/** The local denylist: one term per line, `#` for comments. */
export function parseDenylist(content: string): string[] {
  return content
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}
