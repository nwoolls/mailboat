// The website's only code on Cloudflare, and only for the clips (/video/*,
// wrangler.jsonc's `run_worker_first`; the folder holds nothing else, their
// stills are in /images/): everything else is served as a plain file.
//
// Cloudflare's static assets answer a Range request with the whole file and
// 200, and Safari won't play a video from a server that does that: it asks for
// a few bytes first and needs 206 Partial Content back. So this fetches the
// clip from the site's own files and returns the bytes asked for. The clips
// are small (well under 1 MB), so the whole file is read and sliced.

/**
 * The single byte range asked for, as [start, end] inclusive; null for no
 * usable Range header (absent, not bytes, or several ranges: the whole file
 * goes back then, which a client must accept); "unsatisfiable" for a range
 * outside the file. The unit is case-insensitive (RFC 9110 14.1).
 */
export function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/i.exec((header ?? "").trim());
  if (!match) return null;
  const [, from, to] = match;
  if (from === "" && to === "") return null;
  let start;
  let end;
  if (from === "") {
    // The last `to` bytes.
    const last = Number(to);
    if (last === 0) return "unsatisfiable";
    start = Math.max(0, size - last);
    end = size - 1;
  } else {
    start = Number(from);
    end = to === "" ? size - 1 : Math.min(Number(to), size - 1);
  }
  if (start >= size || start > end) return "unsatisfiable";
  return [start, end];
}

/**
 * Whether a Range may be honored under the request's If-Range (RFC 9110
 * 13.1.5): with none, yes; with an entity tag, only if it is strong and the
 * same as the file's; with a date (or anything else), no, since the files
 * carry no Last-Modified to compare: the whole file goes back instead.
 */
export function rangeAllowed(ifRange, etag) {
  if (ifRange === null) return true;
  const tag = ifRange.trim();
  if (!tag.startsWith('"')) return false;
  return etag !== null && !etag.startsWith("W/") && tag === etag;
}

export default {
  async fetch(request, env) {
    if (request.method !== "GET" && request.method !== "HEAD") return env.ASSETS.fetch(request);
    // Always ask the files for the whole body, even for HEAD, whose answer
    // has none to measure. Conditional headers go along, so a 304 comes back
    // as it is.
    const asset = await env.ASSETS.fetch(
      new Request(request.url, { method: "GET", headers: request.headers }),
    );
    // A 304, a 404 page or anything but a plain file goes back as it came.
    if (asset.status !== 200) return asset;
    const body = await asset.arrayBuffer();
    const size = body.byteLength;
    const head = request.method === "HEAD";
    const headers = new Headers(asset.headers);
    headers.set("Accept-Ranges", "bytes");
    const range = rangeAllowed(request.headers.get("If-Range"), asset.headers.get("ETag"))
      ? parseRange(request.headers.get("Range"), size)
      : null;
    if (range === null) {
      headers.set("Content-Length", String(size));
      return new Response(head ? null : body, { status: 200, headers });
    }
    if (range === "unsatisfiable") {
      headers.delete("Content-Length");
      headers.set("Content-Range", `bytes */${size}`);
      return new Response(null, { status: 416, headers });
    }
    const [start, end] = range;
    headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
    headers.set("Content-Length", String(end - start + 1));
    return new Response(head ? null : body.slice(start, end + 1), { status: 206, headers });
  },
};
