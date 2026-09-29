/**
 * The player as a site: a Worker that serves `npm run deploy`'s upload out of
 * an R2 bucket, over HTTPS, under a secret path.
 *
 * **Only under `/<SITE_KEY>/`, and 404 for everything else.** The bucket holds
 * the game's data -- the bundle and the sounds are derived from a copyrighted
 * install -- so it is never public: the bucket's own `r2.dev` address stays
 * off, and this Worker answers only the path whose first segment is the key
 * (a Worker secret, never in a file that is committed). The page's URLs are
 * relative (`vite.config.ts`'s `base`), so the whole site lives under it.
 *
 * What the page and its service worker need of a file server, and R2's
 * `get` gives directly:
 *
 * - **conditional requests** (`If-None-Match`, `If-Modified-Since`) answered
 *   304 -- the service worker checks every kept file on every online load
 *   (`web/public/sw.js`), and an unchanged stage must cost a round trip, not
 *   seventy megabytes;
 * - **ranges**, for the sound effects' `<audio>` elements;
 * - **the bundle as it was stored**, gzipped by `tools/site.ts`, sent with
 *   its `Content-Encoding` as it is rather than compressed a second time, and
 *   with its decoded size in `X-Decoded-Length` -- a compressed body's
 *   `Content-Length` is the compressed one, and the loading bar counts the
 *   decoded bytes the browser hands it (`web/src/bundle/load.ts`).
 */

// `@cloudflare/workers-types` is not a dependency; these are the parts used.
export interface R2Range { offset: number; length: number }
export interface R2Object {
  size: number;
  httpEtag: string;
  uploaded: Date;
  range?: R2Range;
  customMetadata?: Record<string, string>;
  httpMetadata?: { contentType?: string; contentEncoding?: string; cacheControl?: string };
  writeHttpMetadata(h: Headers): void;
}
export interface R2ObjectBody extends R2Object { body: ReadableStream }
export interface R2Bucket {
  get(key: string, options?: { onlyIf?: Headers; range?: Headers }):
    Promise<R2Object | R2ObjectBody | null>;
}
export interface Env {
  SITE: R2Bucket;
  /** The secret path segment everything is served under. */
  SITE_KEY?: string;
}

const NOT_FOUND = () => new Response("not found", {
  status: 404, headers: { "content-type": "text/plain", "x-robots-tag": "noindex" },
});

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const key = env.SITE_KEY;
    // Without a key configured nothing is served: a missing secret must not
    // make the whole bucket the site.
    if (!key || key.length < 16) return NOT_FOUND();
    const prefix = `/${key}`;
    if (url.pathname === prefix) {
      return Response.redirect(`${url.origin}${prefix}/${url.search}`, 301);
    }
    if (!url.pathname.startsWith(`${prefix}/`)) return NOT_FOUND();
    if (req.method !== "GET" && req.method !== "HEAD") {
      return new Response("method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
    }
    let name: string;
    try {
      name = decodeURIComponent(url.pathname.slice(prefix.length + 1));
    } catch {
      return NOT_FOUND();
    }
    if (name === "" || name.endsWith("/")) name += "index.html";
    if (name.split("/").some((p) => p === ".." || p === ".")) return NOT_FOUND();

    const obj = await env.SITE.get(name, { onlyIf: req.headers, range: req.headers });
    if (!obj) return NOT_FOUND();
    const headers = new Headers();
    obj.writeHttpMetadata(headers);
    headers.set("etag", obj.httpEtag);
    headers.set("last-modified", obj.uploaded.toUTCString());
    headers.set("accept-ranges", "bytes");
    headers.set("x-robots-tag", "noindex");
    const decoded = obj.customMetadata?.["decoded-length"];
    if (decoded) headers.set("x-decoded-length", decoded);
    // A precondition that held back the body: for a GET's validators, that
    // is "you have it".
    if (!("body" in obj)) return new Response(null, { status: 304, headers });
    let status = 200;
    if (obj.range && req.headers.has("range")) {
      const { offset, length } = obj.range;
      status = 206;
      headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${obj.size}`);
      headers.set("content-length", String(length));
    } else {
      headers.set("content-length", String(obj.size));
    }
    const body = req.method === "HEAD" ? null : obj.body;
    // Stored compressed: sent as stored. Without `manual` the runtime would
    // take the header as a request to compress the body itself.
    const init = { status, headers, encodeBody: obj.httpMetadata?.contentEncoding ? "manual" : "automatic" };
    return new Response(body, init as ResponseInit);
  },
};
