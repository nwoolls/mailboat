import type {
  Address,
  AutoValue,
  DayDefault,
  FieldKind,
  Template,
  TemplateField,
} from "../../../platform/tauri/bindings";

/**
 * Templates' fields: a field sits in a template's HTML as
 * `<span data-field="<id>" data-format="<format>">Name</span>`, and what it
 * is (its name and kind) is in the template's `fields`. Filling in replaces
 * each span with its value, written in the formatting around it.
 */

/** How a date is written where it appears. */
export type DateFormat = "long" | "short" | "monthYear" | "longTime" | "time";

/** The formats offered for a kind, the first being the default. */
export function formatsFor(kind: FieldKind, auto?: AutoValue | null): DateFormat[] {
  if (kind === "dateTime") return ["longTime", "long", "short", "monthYear", "time"];
  if (kind === "date" || (kind === "auto" && auto === "today"))
    return ["long", "short", "monthYear"];
  return [];
}

/** What Fill in collects for a field. Dates are `YYYY-MM-DD`, times `HH:MM`. */
export type FieldValue = { text: string; date: string; start: string; end: string };

export type FieldValues = Record<string, FieldValue>;

export const EMPTY_VALUE: FieldValue = { text: "", date: "", start: "", end: "" };

const twoDigits = (n: number) => String(n).padStart(2, "0");

/** A day as `YYYY-MM-DD`, in local time. */
export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${twoDigits(d.getMonth() + 1)}-${twoDigits(d.getDate())}`;
}

const WEEKDAYS: DayDefault[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

/** The day a date starts on: today, tomorrow, or the next such weekday (never today). */
export function defaultDay(day: DayDefault | null, now: Date): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (day === "tomorrow") d.setDate(d.getDate() + 1);
  else if (day && day !== "today") {
    const want = WEEKDAYS.indexOf(day);
    const ahead = (want - d.getDay() + 7) % 7 || 7;
    d.setDate(d.getDate() + ahead);
  }
  return isoDay(d);
}

/** The first word of a name ("Maya Chen" → "Maya"), or "" without one. */
export function firstName(address: Address | undefined): string {
  const name = address?.name?.trim() ?? "";
  return name.split(/\s+/)[0] ?? "";
}

/** Where Fill in starts each field: dates on their day, automatic ones filled. */
export function startingValues(
  fields: TemplateField[],
  context: { to: Address[]; from: Address | null; now: Date },
): FieldValues {
  const values: FieldValues = {};
  for (const f of fields) {
    const v = { ...EMPTY_VALUE };
    if (f.kind === "date" || f.kind === "dateTime") v.date = defaultDay(f.defaultDay, context.now);
    if (f.kind === "dateTime") v.start = "09:00";
    if (f.kind === "dateTime" && f.endTime) v.end = "10:00";
    if (f.kind === "choice") v.text = f.choices[0] ?? "";
    if (f.kind === "auto") {
      if (f.auto === "today") v.date = isoDay(context.now);
      // Only for one person: with several, whose name it is isn't clear.
      if (f.auto === "recipientFirstName" && context.to.length === 1)
        v.text = firstName(context.to[0]);
      if (f.auto === "myFirstName") v.text = firstName(context.from ?? undefined);
    }
    values[f.id] = v;
  }
  return values;
}

function localDate(day: string, time = "00:00"): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!m || !t) return null;
  const [, y, mo, d] = m.map(Number) as [number, number, number, number];
  const [, h, mi] = t.map(Number) as [number, number, number];
  return new Date(y, mo - 1, d, h, mi);
}

/**
 * A field's value as text where it appears, in the computer's language and
 * region (`locale`). "" when there's nothing to write, which leaves the
 * field to fill in.
 */
export function valueText(
  field: TemplateField,
  format: string | null,
  value: FieldValue | undefined,
  locale?: string,
): string {
  if (!value) return "";
  const dated = field.kind === "date" || field.kind === "dateTime" || field.auto === "today";
  if (!dated) return value.text.trim();
  const day = localDate(value.date);
  if (!day) return "";
  const offered = formatsFor(field.kind, field.auto);
  const how = offered.includes(format as DateFormat) ? (format as DateFormat) : offered[0];
  const date = (opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, opts).format(day);
  const long = date({ dateStyle: "full" });
  if (how === "short") return date({ dateStyle: "medium" });
  if (how === "monthYear") return date({ month: "long", year: "numeric" });
  if (how === "long") return long;
  // With the time.
  const time = (t: string) => {
    const at = localDate(value.date, t);
    return at ? new Intl.DateTimeFormat(locale, { timeStyle: "short" }).format(at) : "";
  };
  const start = time(value.start);
  const end = field.endTime ? time(value.end) : "";
  const times = start && end ? `from ${start} to ${end}` : start ? `at ${start}` : "";
  if (how === "time") return start && end ? `${start} to ${end}` : start;
  return times ? `${long} ${times}` : long;
}

/** The lines of a long text, without blank ones. */
function lines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "");
}

function parse(html: string): Document {
  return new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
}

/** The fields' spans in a template's HTML. */
function fieldSpans(doc: Document): HTMLElement[] {
  return [...doc.body.querySelectorAll<HTMLElement>("span[data-field]")];
}

/** Inline formatting a field may sit inside and still be "alone" in its block. */
const FORMATTING = new Set(["B", "STRONG", "I", "EM", "U", "S", "SPAN", "FONT", "MARK", "SMALL"]);

/**
 * Whether `block` holds nothing but `span`: no other text, and no element
 * except formatting around the field (and the paragraph inside a list
 * item). An image, a link or a nested list beside it means no.
 */
function holdsOnly(block: HTMLElement, span: HTMLElement): boolean {
  let el: HTMLElement | null = span.parentElement;
  const around = new Set<Element>();
  while (el && el !== block) {
    around.add(el);
    el = el.parentElement;
  }
  const walker = block.ownerDocument.createTreeWalker(block, NodeFilter.SHOW_ALL);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node === span || span.contains(node)) continue;
    if (node.nodeType === Node.TEXT_NODE) {
      if ((node.textContent ?? "").trim() !== "") return false;
    } else if (node instanceof Element) {
      const allowed = around.has(node) && (FORMATTING.has(node.tagName) || node.tagName === "P");
      if (!allowed) return false;
    }
  }
  return true;
}

/**
 * The block a long text can be repeated in, one copy per line: a list item
 * or paragraph holding nothing but the field (bold or italic around it is
 * fine). Otherwise the lines are joined by line breaks where the field is.
 */
function repeatableBlock(span: HTMLElement): HTMLElement | null {
  const item = span.closest("li");
  if (item) return holdsOnly(item, span) ? item : null;
  const paragraph = span.closest("p");
  return paragraph && holdsOnly(paragraph, span) ? paragraph : null;
}

/**
 * A template's body with its fields filled in. A field with no value stays
 * as it is, to be filled in in the message. A long text's lines become
 * copies of the paragraph or bullet it sits in, when it's alone there, or
 * lines joined by line breaks.
 */
export function fillBody(
  html: string,
  fields: TemplateField[],
  values: FieldValues,
  locale?: string,
): string {
  const doc = parse(html);
  const byId = new Map(fields.map((f) => [f.id, f]));
  for (const span of fieldSpans(doc)) {
    const field = byId.get(span.dataset.field ?? "");
    if (!field) {
      // Not described (shouldn't happen): its name, as plain text.
      span.replaceWith(doc.createTextNode(span.textContent ?? ""));
      continue;
    }
    const value = values[field.id];
    if (field.kind === "longText") {
      const parts = lines(value?.text ?? "");
      if (parts.length === 0) continue;
      const block = parts.length > 1 ? repeatableBlock(span) : null;
      if (block) {
        span.setAttribute("data-filling", "");
        for (const line of parts) {
          const copy = block.cloneNode(true) as HTMLElement;
          copy.querySelector("[data-filling]")?.replaceWith(doc.createTextNode(line));
          block.before(copy);
        }
        block.remove();
      } else {
        const frag = doc.createDocumentFragment();
        parts.forEach((line, i) => {
          if (i > 0) frag.append(doc.createElement("br"));
          frag.append(doc.createTextNode(line));
        });
        span.replaceWith(frag);
      }
      continue;
    }
    const text = valueText(field, span.dataset.format ?? null, value, locale);
    if (text) span.replaceWith(doc.createTextNode(text));
  }
  return doc.body.innerHTML;
}

/**
 * A template's subject, filled in, as plain text. A field with no value
 * leaves its name in brackets, which is easy to spot in the subject line.
 */
export function fillSubject(
  html: string,
  fields: TemplateField[],
  values: FieldValues,
  locale?: string,
): string {
  // Paragraphs (a pasted subject of several) are words apart, not run together.
  const doc = parse(html.replace(/<\/(p|div|li|h\d)>/gi, "</$1> "));
  const byId = new Map(fields.map((f) => [f.id, f]));
  for (const span of fieldSpans(doc)) {
    const field = byId.get(span.dataset.field ?? "");
    const name = span.textContent ?? "";
    let text = "";
    if (field?.kind === "longText") text = lines(values[field.id]?.text ?? "").join(", ");
    else if (field) text = valueText(field, span.dataset.format ?? null, values[field.id], locale);
    span.replaceWith(doc.createTextNode(text || `[${name}]`));
  }
  return (doc.body.textContent ?? "").replace(/\s+/g, " ").trim();
}

/**
 * The names of the fields the filled-in subject still shows as `[Name]`,
 * for Send to ask about along with those in the text.
 */
export function emptySubjectFields(
  html: string,
  fields: TemplateField[],
  values: FieldValues,
  locale?: string,
): string[] {
  const byId = new Map(fields.map((f) => [f.id, f]));
  const names: string[] = [];
  for (const span of fieldSpans(parse(html))) {
    const field = byId.get(span.dataset.field ?? "");
    const filled =
      field?.kind === "longText"
        ? lines(values[field.id]?.text ?? "").length > 0
        : field
          ? valueText(field, span.dataset.format ?? null, values[field.id], locale) !== ""
          : false;
    const name = span.textContent ?? "";
    if (!filled && !names.includes(name)) names.push(name);
  }
  return names;
}

/**
 * The fields a message still waits on, in order, each once: those in its
 * text, then those its subject still shows as `[Name]`.
 */
export function waitingFields(draft: {
  html: string;
  subject: string;
  waitingInSubject?: string[];
}): string[] {
  const inSubject = (draft.waitingInSubject ?? []).filter((n) => draft.subject.includes(`[${n}]`));
  return [...new Set([...unfilledFields(draft.html), ...inSubject])];
}

/** The fields in the order they first appear (subject, then body), each once. */
export function fieldsInOrder(
  template: Pick<Template, "subject" | "body" | "fields">,
): TemplateField[] {
  const byId = new Map(template.fields.map((f) => [f.id, f]));
  const seen = new Set<string>();
  const out: TemplateField[] = [];
  for (const span of fieldSpans(parse(template.subject + template.body))) {
    const f = byId.get(span.dataset.field ?? "");
    if (f && !seen.has(f.id)) {
      seen.add(f.id);
      out.push(f);
    }
  }
  // Described but not placed anywhere: last, so nothing is silently lost.
  for (const f of template.fields) if (!seen.has(f.id)) out.push(f);
  return out;
}

/** The names of the fields still waiting in a message, in order, each once. */
export function unfilledFields(html: string): string[] {
  if (!html.includes("data-field")) return [];
  const names = fieldSpans(parse(html)).map((s) => s.textContent?.trim() || "field");
  return [...new Set(names)];
}

/** A message's HTML with fields still waiting written as their names (Send anyway). */
export function withoutFieldMarks(html: string): string {
  if (!html.includes("data-field")) return html;
  const doc = parse(html);
  for (const span of fieldSpans(doc)) span.replaceWith(doc.createTextNode(span.textContent ?? ""));
  return doc.body.innerHTML;
}

const BLOCKS = new Set([
  "P",
  "DIV",
  "LI",
  "UL",
  "OL",
  "BLOCKQUOTE",
  "PRE",
  "TABLE",
  "TBODY",
  "THEAD",
  "TR",
  "TD",
  "TH",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
]);

/**
 * HTML as one paragraph, for the subject: each block (a paragraph, a list
 * item, a table cell) gives up its contents followed by a space, and a
 * line break becomes a space, so pasted lines keep their words apart.
 * Fields and inline formatting stay.
 */
export function oneLine(html: string): string {
  const doc = parse(html);
  for (const br of doc.body.querySelectorAll("br")) br.replaceWith(doc.createTextNode(" "));
  // Innermost first, so each block is flattened before its parent.
  for (const el of [...doc.body.querySelectorAll("*")].toReversed()) {
    if (!BLOCKS.has(el.tagName)) continue;
    el.replaceWith(...el.childNodes, doc.createTextNode(" "));
  }
  const inner = doc.body.innerHTML.replace(/\s+/g, " ").trim();
  return inner ? `<p>${inner}</p>` : "";
}

/** A name with its spaces as one, as fields are named and shown. */
export function tidyName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

/** The template's text in one line, fields as `{Name}`, for lists and ⌘K. */
export function previewLine(html: string): string {
  const doc = parse(html.replace(/<\/(p|li|div|h\d)>/gi, "</$1> "));
  for (const span of fieldSpans(doc)) span.replaceWith(doc.createTextNode(`{${span.textContent}}`));
  return (doc.body.textContent ?? "").replace(/\s+/g, " ").trim();
}
