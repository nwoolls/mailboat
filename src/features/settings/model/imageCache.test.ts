import { describe, expect, it } from "vitest";
import { describeImageCache } from "./imageCache";

describe("describeImageCache", () => {
  it("says how many images and how much space", () => {
    expect(describeImageCache({ kilobytes: 0, images: 0 })).toBe("Empty");
    expect(describeImageCache({ kilobytes: 430, images: 1 })).toBe("1 image · 0.4 MB");
    expect(describeImageCache({ kilobytes: 126_566, images: 1520 })).toBe("1,520 images · 124 MB");
    expect(describeImageCache({ kilobytes: 1_536_000, images: 9000 })).toBe(
      "9,000 images · 1.5 GB",
    );
  });
});
