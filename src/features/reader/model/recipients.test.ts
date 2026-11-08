import { describe, expect, it } from "vitest";
import { detailLines, fullAddress } from "./recipients";

const person = (name: string | null, email: string) => ({ name, email });

describe("fullAddress", () => {
  it("writes the name and the address, or the address alone", () => {
    expect(fullAddress(person("Priya Raman", "priya@x.example"))).toBe(
      "Priya Raman <priya@x.example>",
    );
    expect(fullAddress(person(null, "jordan@x.example"))).toBe("jordan@x.example");
    expect(fullAddress(person("  ", "jordan@x.example"))).toBe("jordan@x.example");
  });
});

describe("detailLines", () => {
  const from = person("Maya Chen", "maya@x.example");

  it("lists everyone, in full, in the order they were written", () => {
    const to = Array.from({ length: 6 }, (_, i) => person(`Person ${i}`, `p${i}@x.example`));
    const lines = detailLines({ from, to, cc: [person(null, "cc@x.example")] });
    expect(lines.map((l) => l.label)).toEqual(["From", "To", "Cc"]);
    expect(lines[1]!.people).toHaveLength(6);
    expect(lines[1]!.people[5]).toBe("Person 5 <p5@x.example>");
    expect(lines[2]!.people).toEqual(["cc@x.example"]);
  });

  it("leaves out a line with nobody on it", () => {
    expect(detailLines({ from, to: [person(null, "a@x.example")], cc: [] })).toEqual([
      { label: "From", people: ["Maya Chen <maya@x.example>"] },
      { label: "To", people: ["a@x.example"] },
    ]);
  });
});
