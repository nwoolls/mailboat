import { deflateSync } from "node:zlib";
import { expect, test } from "@playwright/test";

/**
 * Email images keep the size the sender gave them (owner report,
 * 2026-10-29: "the logo and the illustration are wider than in Gmail").
 * The reader's page sheet said `img{max-width:100%;height:auto}`, and an
 * author rule beats an image's `height` attribute, so an image sized by only
 * a height showed at its full natural size, usually twice what was asked
 * for. The email is made up (`fixtures/image-sizes.html`), shown as the Rust
 * sanitizer gave it (`fixtures/image-sizes.json`, written by
 * `crates/core/tests/browser_fixtures.rs`), with each image answered here
 * with a picture of a known natural size.
 */
function crc32(buf: Buffer) {
  let crc = ~0;
  for (const byte of buf) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function chunk(type: string, data: Buffer) {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

/** A solid grey PNG of the given natural size. */
function png(width: number, height: number) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bits per channel
  header[9] = 0; // grey
  const rows = Buffer.alloc((width + 1) * height, 0x99);
  for (let y = 0; y < height; y++) rows[y * (width + 1)] = 0; // filter: none
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** The natural size of each image the email asks for. */
const NATURAL: Record<string, [number, number]> = {
  "/logo.png": [400, 128],
  "/art.png": [600, 400],
  "/badge.png": [400, 200],
  "/photo.png": [480, 320],
  "/plain.png": [300, 150],
  "/wide.png": [400, 200],
};

test("images keep the size the sender gave them, whichever of height and width it set", async ({
  page,
}) => {
  await page.context().route(
    (url) => url.hostname !== "127.0.0.1",
    (route) => {
      const [w, h] = NATURAL[new URL(route.request().url()).pathname] ?? [10, 10];
      return route.fulfill({ contentType: "image/png", body: png(w, h) });
    },
  );
  await page.goto("/tests/browser/harness.html?mode=sizes");
  const frame = page.frameLocator('iframe[title="Message content"]');
  await expect
    .poll(() =>
      frame
        .locator("img")
        .evaluateAll((l) => l.every((i) => (i as HTMLImageElement).naturalWidth > 0)),
    )
    .toBe(true);
  const sizeOf = async (alt: string) => {
    const box = await frame.locator(`img[alt="${alt}"]`).boundingBox();
    return { w: Math.round(box!.width), h: Math.round(box!.height) };
  };
  // Only a height: that tall, and as wide as the picture's shape makes it.
  expect(await sizeOf("Logo")).toEqual({ w: 150, h: 48 });
  // Only a height, with an empty alt.
  const art = await frame.locator('img[height="120"]').boundingBox();
  expect({ w: Math.round(art!.width), h: Math.round(art!.height) }).toEqual({ w: 180, h: 120 });
  // Only a width: that wide, and as tall as the shape makes it.
  expect(await sizeOf("Badge")).toEqual({ w: 100, h: 50 });
  // Both: as asked.
  const photo = await frame.locator('img[alt="Photo"]').first().boundingBox();
  expect({ w: Math.round(photo!.width), h: Math.round(photo!.height) }).toEqual({ w: 120, h: 80 });
  // Squeezed by a narrow cell: its shape is kept, not stretched or squashed.
  expect(await sizeOf("Photo in a narrow cell")).toEqual({ w: 60, h: 40 });
  // Neither: its own size.
  expect(await sizeOf("No size at all")).toEqual({ w: 300, h: 150 });
  // The email's own style sheet still decides over the reader's: a class
  // rule's height beats the reader's `height:auto` (review found it didn't
  // when that rule was more specific than a plain `img`), with a width
  // attribute and without a size at all.
  expect(await sizeOf("Sized by the email's sheet")).toEqual({ w: 200, h: 50 });
  expect(await sizeOf("Short by the email's sheet")).toEqual({ w: 80, h: 40 });
});
