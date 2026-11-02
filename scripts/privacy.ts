// Real mail never goes in the repository (AGENTS.md → Real mail never goes in
// the repository). This is the pure part of `bun run check:privacy`: given ONE
// line of text, it names what looks like real mail details. It can't know
// everything (a person's name, a company that sent something), so the written
// rule and the local denylist come first and this catches the mechanical cases.

export type Finding = { kind: string; text: string };

/** Domains reserved so that they can never belong to a real person (RFC 2606, 6761). */
const FAKE_DOMAIN =
  /(^|\.)example$|(^|\.)example\.(com|net|org)$|\.(invalid|test|localhost)$|^localhost$/i;

/** The only addresses at real domains that may appear: tool and bot metadata. */
const ALLOWED_ADDRESS = new Set(["noreply@github.com", "noreply@anthropic.com"]);
const ALLOWED_DOMAIN = new Set(["users.noreply.github.com"]);

/** Gmail placeholders (a stranger's Gmail address is flagged). */
const GMAIL_OK = new Set(["me", "you", "someone", "someone.else", "user", "test", "a", "b", "x"]);

const EMAIL = /([A-Za-z0-9._%+-]+)@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/g;
const PHONE = /(?<![\d.])(?:\+?1[-. ])?\(?\d{3}\)?[-. ]\d{3}[-. ]\d{4}(?![\d.])/g;
/** Ten digits run together (area code and exchange start 2-9, so epoch times don't match). */
const PHONE_PLAIN = /(?<![\d.])(?:\+?1)?[2-9]\d{2}[2-9]\d{6}(?![\d.])/g;

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

/**
 * A line opts out only with a reason after the marker, for its own findings
 * only: `privacy-ok: <why this is not real mail>`.
 */
const OPT_OUT = /privacy-ok:\s*\S/;

/**
 * A path into someone's home folder, or the owner's development layout. The
 * placeholder users below are the ones the tests and docs use; any other name
 * is a real account on a real machine.
 */
const FAKE_USER = "you|someone|me|a|x|user|username|name|shared|public|default|runner";
const LOCAL_PATHS: RegExp[] = [
  new RegExp(`(?:/Users|/home)/(?!(?:${FAKE_USER})(?![\\w.-]))[A-Za-z][\\w.-]*`, "i"),
  new RegExp(`[A-Za-z]:\\\\{1,2}Users\\\\{1,2}(?!(?:${FAKE_USER})(?![\\w.-]))[\\w.-]+`, "i"),
  /~\/src\//,
];

export function findIssues(
  line: string,
  denylist: string[] = [],
  projectDomains: string[] = [],
): Finding[] {
  if (OPT_OUT.test(line)) return [];
  const found: Finding[] = [];
  for (const m of line.matchAll(EMAIL)) {
    const local = m[1]!.toLowerCase();
    const domain = m[2]!.toLowerCase();
    const address = `${local}@${domain}`;
    if (FAKE_DOMAIN.test(domain) || ALLOWED_ADDRESS.has(address) || ALLOWED_DOMAIN.has(domain))
      continue;
    if (projectDomains.includes(domain)) continue;
    if (domain === "gmail.com" && GMAIL_OK.has(local)) continue;
    if (/\.(png|jpe?g|gif|svg|webp|css|js|ts|tsx|json)$/i.test(domain)) continue;
    found.push({ kind: "email address", text: m[0] });
  }
  for (const m of line.matchAll(PHONE)) {
    if (/[-. ]555[-. ]/.test(m[0])) continue;
    found.push({ kind: "phone number", text: m[0] });
  }
  for (const m of /(?:^|[^a-z])(?:phone|tel|call|cell|mobile|fax|sms|text me)(?![a-z])/i.test(line)
    ? line.matchAll(PHONE_PLAIN)
    : []) {
    if (/^(?:\+?1)?\d{3}555\d{4}$/.test(m[0])) continue;
    found.push({ kind: "phone number", text: m[0] });
  }
  for (const [kind, re] of MEASUREMENTS) {
    const m = line.match(re);
    if (m) found.push({ kind, text: m[0] });
  }
  for (const re of LOCAL_PATHS) {
    const m = line.match(re);
    if (m) found.push({ kind: "local path", text: m[0] });
  }
  const lower = line.toLowerCase();
  for (const term of denylist) {
    if (term && lower.includes(term.toLowerCase())) {
      found.push({ kind: "denylisted term", text: "(a term from your local denylist)" });
    }
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

/**
 * Contextual rules for prose that wraps across lines: a count or a number
 * word ("eight", "a few hundred") in front of emails, boxes or newsletters,
 * in a passage that also talks about what was observed or measured. Used on
 * a few consecutive lines at once (joined), not one line.
 */
const COUNT_WORDS =
  "(?<![\\d,.])\\d{1,2}(?![\\d,])|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|(?:one|two|three|four|five|six|seven|eight|nine|ten|twelve|twenty|thirty|forty|fifty) (?:hundred|thousand)|a few hundred|a few dozen|a dozen|dozens of|hundreds of|several hundred";
const COUNTED = new RegExp(
  `\\b(?:${COUNT_WORDS})\\s+(?:(?:cached|real|white|colou?red|old|older|new)\\s+)?(?:html\\s+)?(?:emails?|messages?|boxes|newsletters?|summaries|conversations|threads|rules)\\b`,
  "i",
);
/** Talks about what was seen, tried or measured on real mail. */
const OBSERVED =
  /\b(?:owner|render(?:ed|ing)|measured|observed|real mail|screenshot|trial|seen working|while it ran)\b/i;
/** A limit or design choice, not an observation ("newest 25 messages"). */
const DESIGN =
  /\b(?:newest|first|oldest|up to|at most|per|capped|cap|limit|no more than|max|every)\b/i;

/** A speed or size multiple taken from a real run ("twice as fast", "3x faster"). */
const MULTIPLE =
  /\b(?:twice|half|double|(?:\d+(?:\.\d+)?|two|three|four|five|ten) times|\d+(?:\.\d+)?x)\s+(?:as\s+)?(?:fast|faster|slow|slower|wide|wider|large|larger|long|longer)\b/i;

export function findPassageIssues(passage: string): Finding[] {
  const text = passage.replace(/\s+/g, " ");
  if (!OBSERVED.test(text)) return [];
  const found: Finding[] = [];
  const m = COUNTED.exec(text);
  if (m) {
    const around = text.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40);
    if (!DESIGN.test(around)) found.push({ kind: "count of real mail", text: m[0] });
  }
  const x = MULTIPLE.exec(text);
  if (x) found.push({ kind: "multiple measured on real mail", text: x[0] });
  return found;
}

/** Markdown and comment markers that start a wrapped line of prose. */
const LEAD = /^\s*(?:\/\/[/!]?|\*|#+|-|>|\|)\s?/;

/**
 * A few consecutive lines joined into one passage (comment and list markers
 * dropped), so a name or a number split by a line wrap is still seen.
 */
export function joinLines(lines: string[]): string {
  // A line with an exemption is left out, so it can't hide its neighbours.
  return lines
    .filter((l) => !OPT_OUT.test(l))
    .map((l) => l.replace(LEAD, ""))
    .join(" ")
    .replace(/\s+/g, " ");
}

/** Denylisted terms in a joined passage (multiword terms survive a wrap). */
export function findDenylistInPassage(passage: string, denylist: string[]): Finding[] {
  const lower = passage.toLowerCase();
  return denylist
    .filter((term) => term && lower.includes(term.toLowerCase()))
    .map(() => ({ kind: "denylisted term", text: "(a term from your local denylist)" }));
}
