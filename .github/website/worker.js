// The website's only code on Cloudflare, and only for /video/* (wrangler.jsonc,
// `run_worker_first`): everything else is served as a plain file, as before.
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
 * outside the file.
 */
export function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec((header ?? "").trim());
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

export default {
  async fetch(request, env) {
    const asset = await env.ASSETS.fetch(request);
    // A 304, a 404 page or anything but a plain GET of a file goes back as it came.
    if (asset.status !== 200 || (request.method !== "GET" && request.method !== "HEAD")) {
      return asset;
    }
    const body = await asset.arrayBuffer();
    const size = body.byteLength;
    const headers = new Headers(asset.headers);
    headers.set("Accept-Ranges", "bytes");
    const range = parseRange(request.headers.get("Range"), size);
    if (range === null) {
      headers.set("Content-Length", String(size));
      return new Response(request.method === "HEAD" ? null : body, { status: 200, headers });
    }
    if (range === "unsatisfiable") {
      headers.delete("Content-Length");
      headers.set("Content-Range", `bytes */${size}`);
      return new Response(null, { status: 416, headers });
    }
    const [start, end] = range;
    headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
    headers.set("Content-Length", String(end - start + 1));
    const part = request.method === "HEAD" ? null : body.slice(start, end + 1);
    return new Response(part, { status: 206, headers });
  },
};
