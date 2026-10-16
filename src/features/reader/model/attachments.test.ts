import { describe, expect, it } from "vitest";
import { fileKind, formatSize, shownName } from "./attachments";

describe("attachments", () => {
  it("formats sizes like Finder", () => {
    expect(formatSize(820)).toBe("820 B");
    expect(formatSize(1000)).toBe("1 KB");
    expect(formatSize(14_300)).toBe("14 KB");
    expect(formatSize(2_400_000)).toBe("2.4 MB");
    expect(formatSize(25_000_000)).toBe("25 MB");
    expect(formatSize(3_100_000_000)).toBe("3.1 GB");
  });

  it("picks an icon kind", () => {
    expect(fileKind({ mimeType: "image/png", filename: "a.png" })).toBe("image");
    expect(fileKind({ mimeType: "application/octet-stream", filename: "A.PDF" })).toBe("pdf");
    expect(fileKind({ mimeType: "text/csv", filename: "a.csv" })).toBe("file");
  });

  it("shows names without folders", () => {
    expect(shownName({ filename: "../../Quarterly report.pdf" })).toBe("Quarterly report.pdf");
    expect(shownName({ filename: "" })).toBe("attachment");
  });
});
