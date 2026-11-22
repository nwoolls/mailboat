// The website's Worker (.github/website/worker.js): byte ranges for the clips
// in /video/, which Safari needs to play a video.
import { describe, expect, it } from "vitest";
// @ts-expect-error: a plain JavaScript module, deployed as it is.
import worker, { parseRange } from "../.github/website/worker.js";

describe("parseRange", () => {
  const size = 1000;
  it("reads a start and an end, inclusive, and clamps the end to the file", () => {
    expect(parseRange("bytes=0-1", size)).toEqual([0, 1]);
    expect(parseRange("bytes=100-", size)).toEqual([100, 999]);
    expect(parseRange("bytes=900-5000", size)).toEqual([900, 999]);
  });
  it("reads the last n bytes", () => {
    expect(parseRange("bytes=-50", size)).toEqual([950, 999]);
    expect(parseRange("bytes=-5000", size)).toEqual([0, 999]);
  });
  it("sends the whole file for no header, another unit or several ranges", () => {
    expect(parseRange(null, size)).toBeNull();
    expect(parseRange("items=0-1", size)).toBeNull();
    expect(parseRange("bytes=0-1,5-6", size)).toBeNull();
    expect(parseRange("bytes=-", size)).toBeNull();
  });
  it("refuses a range outside the file", () => {
    expect(parseRange("bytes=1000-", size)).toBe("unsatisfiable");
    expect(parseRange("bytes=5-4", size)).toBe("unsatisfiable");
    expect(parseRange("bytes=-0", size)).toBe("unsatisfiable");
  });
});

describe("the Worker", () => {
  const bytes = new Uint8Array(Array.from({ length: 300 }, (_, i) => i % 256));
  const env = {
    ASSETS: {
      fetch: async (request: Request) =>
        new URL(request.url).pathname === "/video/clip.mp4"
          ? new Response(bytes, {
              headers: { "Content-Type": "video/mp4", "X-Content-Type-Options": "nosniff" },
            })
          : new Response("not here", { status: 404 }),
    },
  };
  const get = (path: string, init?: RequestInit) =>
    worker.fetch(new Request(`https://site.example${path}`, init), env) as Promise<Response>;

  it("answers a range with 206 and just those bytes, keeping the file's headers", async () => {
    const res = await get("/video/clip.mp4", { headers: { Range: "bytes=10-19" } });
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe("bytes 10-19/300");
    expect(res.headers.get("Content-Length")).toBe("10");
    expect(res.headers.get("Accept-Ranges")).toBe("bytes");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual(
      Array.from(bytes.slice(10, 20)),
    );
  });
  it("sends the whole file, saying ranges are welcome, when none is asked for", async () => {
    const res = await get("/video/clip.mp4");
    expect(res.status).toBe(200);
    expect(res.headers.get("Accept-Ranges")).toBe("bytes");
    expect((await res.arrayBuffer()).byteLength).toBe(300);
  });
  it("answers 416 for a range past the end", async () => {
    const res = await get("/video/clip.mp4", { headers: { Range: "bytes=300-" } });
    expect(res.status).toBe(416);
    expect(res.headers.get("Content-Range")).toBe("bytes */300");
  });
  it("passes a missing file through as it came", async () => {
    const res = await get("/video/nope.mp4", { headers: { Range: "bytes=0-1" } });
    expect(res.status).toBe(404);
  });
  it("answers HEAD with the range's headers and no body", async () => {
    const res = await get("/video/clip.mp4", { method: "HEAD", headers: { Range: "bytes=0-1" } });
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Length")).toBe("2");
    expect(await res.text()).toBe("");
  });
});
