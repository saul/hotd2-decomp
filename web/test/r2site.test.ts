/**
 * The site's Worker (`r2site/worker.ts`), against an R2 bucket kept in a Map:
 * that the page gets what its service worker and its loading bar rely on --
 * 304s, ranges, and a stored-compressed bundle file sent as stored with its
 * decoded length -- and nothing that is not a file of the site.
 *
 * Run with `npm run test:r2site`. No bundle, no network.
 */
import worker, { type Env, type R2Bucket, type R2Object } from "../../r2site/worker";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) console.log(`  ok    ${name}`);
  else { failures++; console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
}

interface Stored {
  body: Uint8Array<ArrayBuffer>;
  etag: string;
  type: string;
  encoding?: string;
  meta?: Record<string, string>;
}

/** R2's `get` as far as the Worker uses it: `onlyIf` by ETag, `range` by header. */
function bucket(objects: Map<string, Stored>): R2Bucket {
  return {
    async get(key, opts) {
      const s = objects.get(key);
      if (!s) return null;
      const base: R2Object = {
        size: s.body.length, httpEtag: `"${s.etag}"`, uploaded: new Date(0),
        customMetadata: s.meta,
        httpMetadata: { contentType: s.type, contentEncoding: s.encoding },
        writeHttpMetadata(h: Headers) {
          h.set("content-type", s.type);
          if (s.encoding) h.set("content-encoding", s.encoding);
        },
      };
      if (opts?.onlyIf?.get("if-none-match") === `"${s.etag}"`) return base;
      const m = /^bytes=(\d+)-(\d*)$/.exec(opts?.range?.get("range") ?? "");
      if (m) {
        const offset = Number(m[1]);
        const end = m[2] ? Number(m[2]) : s.body.length - 1;
        const slice = s.body.slice(offset, end + 1);
        return { ...base, range: { offset, length: slice.length },
                 body: new Blob([slice]).stream() };
      }
      return { ...base, body: new Blob([s.body]).stream() };
    },
  };
}

const enc = (s: string) => new TextEncoder().encode(s);
const objects = new Map<string, Stored>([
  ["index.html", { body: enc("<!doctype html>page"), etag: "e1", type: "text/html" }],
  ["se/a.wav", { body: enc("0123456789"), etag: "e2", type: "audio/wav" }],
  ["bundle/manifest.json", { body: enc("gz-bytes"), etag: "e3", type: "application/json",
                             encoding: "gzip", meta: { "decoded-length": "12345" } }],
]);
const env: Env = { SITE: bucket(objects) };
const get = (path: string, init?: RequestInit) =>
  worker.fetch(new Request(`https://hotd2-site.example.workers.dev${path}`, init), env);

console.log("\nThe site's Worker:\n");
const page = await get("/?stage=1");
check("the root is index.html, whatever its query, with its type and an ETag",
      page.status === 200 && (await page.text()) === "<!doctype html>page"
      && page.headers.get("content-type") === "text/html" && page.headers.get("etag") === '"e1"');
check("and so is index.html by name", (await get("/index.html")).status === 200);
const again = await get("/", { headers: { "if-none-match": '"e1"' } });
check("the same ETag back is a 304, with no body", again.status === 304
      && (await again.text()) === "");
const part = await get("/se/a.wav", { headers: { range: "bytes=2-5" } });
check("a range is a 206 with its Content-Range", part.status === 206
      && (await part.text()) === "2345" && part.headers.get("content-range") === "bytes 2-5/10");
const gz = await get("/bundle/manifest.json");
check("a stored-compressed file keeps its Content-Encoding and says its decoded length",
      gz.status === 200 && gz.headers.get("content-encoding") === "gzip"
      && gz.headers.get("x-decoded-length") === "12345");
const head = await get("/se/a.wav", { method: "HEAD" });
check("HEAD has the headers and no body", head.status === 200
      && head.headers.get("content-length") === "10" && (await head.text()) === "");
check("nothing but GET and HEAD",
      (await get("/index.html", { method: "POST", body: "x" })).status === 405);
check("an encoded .. is refused", (await get("/%2e%2e/secret")).status === 404);
check("a missing file is a 404", (await get("/nope.js")).status === 404);

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
