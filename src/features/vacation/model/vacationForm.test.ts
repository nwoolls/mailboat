import { describe, expect, it } from "vitest";
import type { VacationSettings } from "../../../platform/tauri/bindings";
import {
  bannerText,
  dayOf,
  endOfDay,
  formFromSettings,
  startOfDay,
  toSettings,
  vacationProblem,
  vacationStatus,
} from "./vacationForm";

const settings: VacationSettings = {
  enabled: true,
  subject: "Away",
  bodyHtml: "<p>Back Monday</p>",
  bodyText: "Back Monday",
  contactsOnly: false,
  domainOnly: false,
  start: startOfDay("2026-10-20"),
  end: endOfDay("2026-10-24"),
};

describe("vacation form", () => {
  it("turns days into Gmail's times and back", () => {
    const form = formFromSettings(settings, 0);
    expect(form.firstDay).toBe("2026-10-20");
    expect(form.lastDay).toBe("2026-10-24");
    expect(toSettings(form)).toEqual(settings);
  });

  it("ends a last day at the next local midnight", () => {
    const start = startOfDay("2026-10-24")!;
    const end = endOfDay("2026-10-24")!;
    expect(dayOf(start)).toBe("2026-10-24");
    expect(dayOf(end)).toBe("2026-10-25");
    expect(new Date(end).getHours()).toBe(0);
    // Across the end of a month too.
    expect(dayOf(endOfDay("2026-10-31")!)).toBe("2026-11-01");
  });

  it("has no last day when on until turned off, and starts today when unset", () => {
    const today = startOfDay("2026-10-18")! + 5000;
    const form = formFromSettings({ ...settings, start: null, end: null }, today);
    expect(form.firstDay).toBe("2026-10-18");
    expect(form.lastDay).toBe("");
    expect(toSettings(form).end).toBeNull();
  });

  it("says what's wrong before saving", () => {
    const form = formFromSettings(settings, 0);
    expect(vacationProblem(form)).toBeNull();
    expect(vacationProblem({ ...form, lastDay: "2026-10-19" })).toMatch(/last day/);
    expect(vacationProblem({ ...form, lastDay: "2026-10-20" })).toBeNull();
    expect(vacationProblem({ ...form, subject: "", bodyText: " " })).toMatch(/Write the reply/);
    // Turning it off needs nothing.
    expect(vacationProblem({ ...form, enabled: false, subject: "", bodyText: "" })).toBeNull();
  });

  it("drops the HTML of an emptied message", () => {
    const form = { ...formFromSettings(settings, 0), bodyHtml: "<p></p>", bodyText: "" };
    expect(toSettings(form).bodyHtml).toBe("");
  });

  it("describes its state", () => {
    const during = startOfDay("2026-10-22")!;
    expect(vacationStatus(settings, during)).toBe("On until the end of Sat, Oct 24");
    expect(vacationStatus(settings, startOfDay("2026-10-19")!)).toBe("Starts Tue, Oct 20");
    expect(vacationStatus(settings, startOfDay("2026-10-26")!)).toBe("Ended");
    expect(vacationStatus({ ...settings, start: null, end: null }, during)).toBe("On");
    expect(vacationStatus({ ...settings, enabled: false }, during)).toBe("Off");
    expect(bannerText(settings, "me@x.example")).toBe(
      "Vacation responder is on for me@x.example until the end of Sat, Oct 24",
    );
    expect(bannerText({ ...settings, end: null }, null)).toBe("Vacation responder is on");
  });
});
