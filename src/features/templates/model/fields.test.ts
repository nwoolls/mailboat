import { describe, expect, it } from "vitest";
import type { TemplateField } from "../../../platform/tauri/bindings";
import {
  defaultDay,
  EMPTY_VALUE,
  emptySubjectFields,
  fieldsInOrder,
  fillBody,
  fillSubject,
  firstName,
  type FieldValue,
  previewLine,
  startingValues,
  unfilledFields,
  valueText,
  waitingFields,
  withoutFieldMarks,
} from "./fields";

const field = (id: string, kind: TemplateField["kind"], extra: Partial<TemplateField> = {}) =>
  ({
    id,
    name: id.charAt(0).toUpperCase() + id.slice(1),
    kind,
    choices: [],
    auto: null,
    defaultDay: null,
    endTime: false,
    ...extra,
  }) satisfies TemplateField;

const value = (v: Partial<FieldValue>): FieldValue => ({ ...EMPTY_VALUE, ...v });
const span = (id: string, format?: string) =>
  `<span data-field="${id}"${format ? ` data-format="${format}"` : ""}>${id.charAt(0).toUpperCase() + id.slice(1)}</span>`;

const window = field("window", "dateTime", { endTime: true });
const changes = field("changes", "longText");
const locale = "en-US";
const jan11 = value({ date: "2027-01-11", start: "21:00", end: "23:00" });

describe("dates", () => {
  it("writes each format in the given language", () => {
    expect(valueText(window, "longTime", jan11, locale)).toBe(
      "Monday, January 11, 2027 from 9:00 PM to 11:00 PM",
    );
    expect(valueText(window, "long", jan11, locale)).toBe("Monday, January 11, 2027");
    expect(valueText(window, "short", jan11, locale)).toBe("Jan 11, 2027");
    expect(valueText(window, "monthYear", jan11, locale)).toBe("January 2027");
    expect(valueText(window, "time", jan11, locale)).toBe("9:00 PM to 11:00 PM");
  });

  it("says 'at' without an end time, and leaves out a time that isn't set", () => {
    const start = field("start", "dateTime");
    expect(valueText(start, "longTime", jan11, locale)).toBe("Monday, January 11, 2027 at 9:00 PM");
    expect(valueText(start, "longTime", value({ date: "2027-01-11" }), locale)).toBe(
      "Monday, January 11, 2027",
    );
  });

  it("falls back to the kind's first format, and needs a day", () => {
    const day = field("day", "date");
    expect(valueText(day, "longTime", jan11, locale)).toBe("Monday, January 11, 2027");
    expect(valueText(day, null, jan11, locale)).toBe("Monday, January 11, 2027");
    expect(valueText(day, "long", value({ date: "" }), locale)).toBe("");
    expect(valueText(day, "long", value({ date: "2027-1-11" }), locale)).toBe("");
  });

  it("follows the computer's region", () => {
    // The day before the month; the comma after the weekday varies by ICU version.
    expect(valueText(window, "long", jan11, "en-GB")).toMatch(/^Monday,? 11 January 2027$/);
  });

  it("starts on today, tomorrow or the next such weekday", () => {
    const friday = new Date(2027, 0, 8, 15, 30);
    expect(defaultDay(null, friday)).toBe("2027-01-08");
    expect(defaultDay("today", friday)).toBe("2027-01-08");
    expect(defaultDay("tomorrow", friday)).toBe("2027-01-09");
    expect(defaultDay("monday", friday)).toBe("2027-01-11");
    // The next Friday, never today.
    expect(defaultDay("friday", friday)).toBe("2027-01-15");
    // Across a month.
    expect(defaultDay("tomorrow", new Date(2027, 0, 31))).toBe("2027-02-01");
  });
});

describe("startingValues", () => {
  const now = new Date(2027, 0, 8);
  const maya = { name: "Maya Chen", email: "maya@x.example" };
  const alex = { name: "Alex Rivera", email: "alex@x.example" };

  it("fills automatic fields and starts dates and choices", () => {
    const v = startingValues(
      [
        field("first", "auto", { auto: "recipientFirstName" }),
        field("me", "auto", { auto: "myFirstName" }),
        field("today", "auto", { auto: "today" }),
        field("w", "dateTime", { endTime: true, defaultDay: "monday" }),
        field("type", "choice", { choices: ["Standard", "Emergency"] }),
      ],
      { to: [maya], from: alex, now },
    );
    expect(v.first!.text).toBe("Maya");
    expect(v.me!.text).toBe("Alex");
    expect(v.today!.date).toBe("2027-01-08");
    expect(v.w!).toMatchObject({ date: "2027-01-11", start: "09:00", end: "10:00" });
    expect(v.type!.text).toBe("Standard");
  });

  it("leaves the recipient's name to you with several people or none", () => {
    const f = [field("first", "auto", { auto: "recipientFirstName" })];
    expect(startingValues(f, { to: [maya, alex], from: alex, now }).first!.text).toBe("");
    expect(startingValues(f, { to: [], from: alex, now }).first!.text).toBe("");
    expect(firstName({ name: null, email: "x@x.example" })).toBe("");
  });
});

describe("fillBody", () => {
  it("writes values in the formatting around them", () => {
    const html = `<p>Planned for <strong>${span("window", "longTime")}</strong>.</p>`;
    expect(fillBody(html, [window], { window: jan11 }, locale)).toBe(
      "<p>Planned for <strong>Monday, January 11, 2027 from 9:00 PM to 11:00 PM</strong>.</p>",
    );
  });

  it("makes a bullet of each line when the field is alone in one", () => {
    const html = `<p>We will:</p><ul><li><p>${span("changes")}</p></li></ul><p>Thanks</p>`;
    const text =
      "Upgrade the build servers\n\n  Move the staging database  \nRotate the certificates";
    expect(fillBody(html, [changes], { changes: value({ text }) })).toBe(
      "<p>We will:</p><ul>" +
        "<li><p>Upgrade the build servers</p></li>" +
        "<li><p>Move the staging database</p></li>" +
        "<li><p>Rotate the certificates</p></li>" +
        "</ul><p>Thanks</p>",
    );
  });

  it("keeps the bullet's own formatting on each copy", () => {
    const html = `<ul><li><p><em>${span("changes")}</em></p></li></ul>`;
    expect(fillBody(html, [changes], { changes: value({ text: "One\nTwo" }) })).toBe(
      "<ul><li><p><em>One</em></p></li><li><p><em>Two</em></p></li></ul>",
    );
  });

  it("makes a paragraph of each line when the field is alone in one", () => {
    const html = `<p>${span("changes")}</p>`;
    expect(fillBody(html, [changes], { changes: value({ text: "One\nTwo" }) })).toBe(
      "<p>One</p><p>Two</p>",
    );
  });

  it("never copies an image or a nested list beside the field", () => {
    const lines = { changes: value({ text: "One\nTwo" }) };
    const image = `<p>${span("changes")} <img src="https://x.example/a.png"></p>`;
    expect(fillBody(image, [changes], lines)).toBe(
      '<p>One<br>Two <img src="https://x.example/a.png"></p>',
    );
    const nested = `<ul><li><p>${span("changes")}</p><ul><li><p>Detail</p></li></ul></li></ul>`;
    expect(fillBody(nested, [changes], lines)).toBe(
      "<ul><li><p>One<br>Two</p><ul><li><p>Detail</p></li></ul></li></ul>",
    );
    // A link around it isn't formatting either.
    const linked = `<p><a href="https://x.example">${span("changes")}</a></p>`;
    expect(fillBody(linked, [changes], lines)).toBe(
      '<p><a href="https://x.example">One<br>Two</a></p>',
    );
  });

  it("breaks lines inside a sentence", () => {
    const html = `<p>Changes: ${span("changes")}.</p>`;
    expect(fillBody(html, [changes], { changes: value({ text: "One\nTwo" }) })).toBe(
      "<p>Changes: One<br>Two.</p>",
    );
  });

  it("fills a field used twice, and leaves an empty one waiting", () => {
    const rollback = field("rollback", "text");
    const html = `<p>${span("window", "monthYear")}, ${span("window", "short")}. ${span("rollback")}</p>`;
    const out = fillBody(
      html,
      [window, rollback],
      { window: jan11, rollback: value({ text: " " }) },
      locale,
    );
    expect(out).toBe(`<p>January 2027, Jan 11, 2027. ${span("rollback")}</p>`);
    expect(unfilledFields(out)).toEqual(["Rollback"]);
  });

  it("writes text as text, never as markup", () => {
    const name = field("name", "text");
    expect(
      fillBody(`<p>${span("name")}</p>`, [name], { name: value({ text: "<b>x</b> & y" }) }),
    ).toBe("<p>&lt;b&gt;x&lt;/b&gt; &amp; y</p>");
  });
});

describe("fillSubject", () => {
  it("is plain text, with a waiting field's name in brackets", () => {
    const rollback = field("rollback", "text");
    const html = `<p>Change control: ${span("window", "monthYear")} ${span("rollback")}</p>`;
    expect(fillSubject(html, [window, rollback], { window: jan11 }, locale)).toBe(
      "Change control: January 2027 [Rollback]",
    );
    expect(fillSubject("", [], {})).toBe("");
  });

  it("keeps the words of a subject in several paragraphs apart", () => {
    expect(fillSubject("<p>First</p><p>Second</p>", [], {})).toBe("First Second");
  });

  it("names the fields it left waiting, and Send asks while they show", () => {
    const rollback = field("rollback", "text");
    const html = `<p>${span("window", "monthYear")} ${span("rollback")}</p>`;
    const values = { window: jan11, rollback: value({ text: "" }) };
    const waiting = emptySubjectFields(html, [window, rollback], values, locale);
    expect(waiting).toEqual(["Rollback"]);
    const subject = fillSubject(html, [window, rollback], values, locale);
    expect(waitingFields({ html: "", subject, waitingInSubject: waiting })).toEqual(["Rollback"]);
    // Typed over in the subject: no longer waiting.
    expect(
      waitingFields({ html: "", subject: "January 2027 done", waitingInSubject: waiting }),
    ).toEqual([]);
    // With one in the text too, each once.
    expect(
      waitingFields({ html: `<p>${span("rollback")}</p>`, subject, waitingInSubject: waiting }),
    ).toEqual(["Rollback"]);
  });
});

describe("helpers", () => {
  it("lists fields in the order they appear, each once", () => {
    const rollback = field("rollback", "text");
    const unused = field("unused", "text");
    const t = {
      subject: `<p>${span("window", "monthYear")}</p>`,
      body: `<p>${span("rollback")} ${span("changes")} ${span("window")}</p>`,
      fields: [changes, unused, rollback, window],
    };
    expect(fieldsInOrder(t).map((f) => f.id)).toEqual(["window", "rollback", "changes", "unused"]);
  });

  it("writes waiting fields as their names for Send anyway", () => {
    expect(withoutFieldMarks(`<p>Rollback: ${span("rollback")}</p>`)).toBe(
      "<p>Rollback: Rollback</p>",
    );
    expect(withoutFieldMarks("<p>plain</p>")).toBe("<p>plain</p>");
  });

  it("previews a template in one line", () => {
    expect(previewLine(`<p>Hi all,</p><ul><li><p>${span("changes")}</p></li></ul>`)).toBe(
      "Hi all, {Changes}",
    );
  });
});
