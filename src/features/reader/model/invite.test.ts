import { describe, expect, it } from "vitest";
import type { CalendarState, Invite, InviteCard } from "../../../platform/tauri/bindings";
import {
  answerText,
  canAnswer,
  canRemove,
  clashText,
  currentAnswer,
  headline,
  whenText,
} from "./invite";

const at = (y: number, mo: number, d: number, h: number, mi = 0) => ({
  kind: "at" as const,
  ms: new Date(y, mo - 1, d, h, mi).getTime(),
});

const invite: Invite = {
  kind: "request",
  uid: "u",
  sequence: 0,
  title: "Design review",
  location: null,
  start: at(2026, 10, 20, 14),
  end: at(2026, 10, 20, 14, 30),
  organizer: { email: "pat@example.com", name: "Pat" },
  yourAnswer: "needsAction",
  you: null,
  cancelled: false,
  replied: null,
};
const onCalendar = (over: Partial<Extract<CalendarState, { kind: "onCalendar" }>> = {}) =>
  ({
    kind: "onCalendar",
    eventId: "ev1",
    yourAnswer: "yes",
    cancelled: false,
    clashes: [],
    link: null,
    ...over,
  }) as CalendarState;
const card = (inv: Partial<Invite>, calendar: CalendarState): InviteCard => ({
  invite: { ...invite, ...inv },
  calendar,
});

describe("invitation card", () => {
  it("says when, in your time zone", () => {
    expect(whenText(invite.start, invite.end, "en-US")).toBe("Tue, Oct 20 · 2:00 PM – 2:30 PM");
    expect(
      whenText(
        { kind: "allDay", date: "2026-11-01" },
        { kind: "allDay", date: "2026-11-02" },
        "en-US",
      ),
    ).toBe("Sun, Nov 1 · all day");
    expect(
      whenText(
        { kind: "allDay", date: "2026-11-01" },
        { kind: "allDay", date: "2026-11-04" },
        "en-US",
      ),
    ).toBe("Sun, Nov 1 – Tue, Nov 3 · all day");
    expect(
      whenText({ kind: "local", time: "2026-10-20T14:00:00", zone: "Eastern Standard Time" }, null),
    ).toBe("2026-10-20 14:00 (Eastern Standard Time)");
    expect(whenText(at(2026, 10, 20, 23), at(2026, 10, 21, 1), "en-US")).toBe(
      "Tue, Oct 20, 11:00 PM – Wed, Oct 21, 1:00 AM",
    );
  });

  it("takes your answer from Calendar when it has the event", () => {
    expect(currentAnswer(card({}, onCalendar({ yourAnswer: "maybe" })))).toBe("maybe");
    expect(currentAnswer(card({}, { kind: "notOnCalendar" }))).toBe("needsAction");
    expect(currentAnswer(card({}, { kind: "repliedByEmail", yourAnswer: "no" }))).toBe("no");
    expect(canAnswer(card({}, { kind: "repliedByEmail", yourAnswer: "no" }))).toBe(true);
    expect(answerText(null)).toBe("Not answered");
    expect(answerText("yes")).toBe("Going");
  });

  it("heads the card with what it is", () => {
    expect(headline(invite, onCalendar())).toBe("Invitation");
    expect(headline({ ...invite, sequence: 2 }, onCalendar())).toBe("Updated invitation");
    expect(headline({ ...invite, cancelled: true }, onCalendar())).toBe("Cancelled");
    expect(headline(invite, onCalendar({ cancelled: true }))).toBe("Cancelled");
    expect(
      headline(
        {
          ...invite,
          kind: "reply",
          replied: { who: { email: "sam@example.com", name: "Sam" }, answer: "no" },
        },
        { kind: "notNeeded" },
      ),
    ).toBe("Sam declined your invitation");
  });

  it("offers answers only where they can be given", () => {
    expect(canAnswer(card({}, onCalendar()))).toBe(true);
    expect(canAnswer(card({}, { kind: "notOnCalendar" }))).toBe(true);
    expect(canAnswer(card({}, { kind: "needsSignIn" }))).toBe(false);
    expect(canAnswer(card({}, { kind: "unavailable", message: "x" }))).toBe(false);
    expect(canAnswer(card({ cancelled: true }, onCalendar()))).toBe(false);
    expect(canAnswer(card({ kind: "reply" }, { kind: "notNeeded" }))).toBe(false);
    expect(canRemove(card({ cancelled: true }, onCalendar()))).toBe(true);
    expect(canRemove(card({ cancelled: true }, onCalendar({ cancelled: true })))).toBe(false);
  });

  it("names clashes", () => {
    expect(clashText([])).toBeNull();
    const clash = { title: "1:1 with Sam", start: at(2026, 10, 20, 14, 15), end: null };
    expect(clashText([clash], "en-US")).toBe("Clashes with 1:1 with Sam (2:15 PM)");
    expect(clashText([clash, { ...clash, title: null }], "en-US")).toBe(
      "Clashes with 1:1 with Sam (2:15 PM) and 1 more",
    );
  });
});
