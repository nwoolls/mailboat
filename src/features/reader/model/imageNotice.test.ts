import { describe, expect, it } from "vitest";
import { imageNotice } from "./imageNotice";

const base = {
  senderEmail: "news@shop.com",
  blockedImages: 0,
  loadedImages: 0,
  trackersRemoved: 0,
} as const;

describe("imageNotice", () => {
  it("offers to block when images loaded by default", () => {
    const n = imageNotice({ ...base, imagePolicy: "loadedByDefault", loadedImages: 3 });
    expect(n?.quiet).toBe(true);
    expect(n?.action).toEqual({ label: "Block images from news@shop.com", allow: false });
  });

  it("says nothing when there were no images or trackers", () => {
    expect(imageNotice({ ...base, imagePolicy: "loadedByDefault" })).toBeNull();
    expect(imageNotice({ ...base, imagePolicy: "blockedForSender" })).toBeNull();
  });

  it("mentions removed trackers", () => {
    const n = imageNotice({
      ...base,
      imagePolicy: "loadedForSender",
      loadedImages: 1,
      trackersRemoved: 2,
    });
    expect(n?.text).toBe("Images shown, 2 trackers removed");
  });

  it("offers to load images for a blocked sender and in Trash", () => {
    for (const imagePolicy of ["blockedForSender", "blockedInTrash"] as const) {
      const n = imageNotice({ ...base, imagePolicy, blockedImages: 1 });
      expect(n?.quiet).toBe(false);
      expect(n?.action?.allow).toBe(true);
    }
    expect(imageNotice({ ...base, imagePolicy: "blockedInTrash", blockedImages: 2 })?.text).toBe(
      "2 remote images hidden in Trash",
    );
  });

  it("never offers to load images in Spam", () => {
    const n = imageNotice({ ...base, imagePolicy: "blockedInSpam", blockedImages: 4 });
    expect(n?.text).toBe("4 remote images hidden in Spam");
    expect(n?.action).toBeNull();
  });
});
