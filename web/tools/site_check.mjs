/**
 * Play a staged site the way a static host will serve it.
 *
 *     node tools/site_check.mjs [extract/site]      # or: npm run site -- --check
 *
 * `tools/site.ts` stages the page, the bundle and the sounds into one
 * directory; this serves that directory with the two properties the dev
 * server does not have and S3 does, and loads stage 1 in Chrome:
 *
 * * **Names are exact.** The dev server finds a sound whatever its case and
 *   macOS's disk does too, so a request spelled differently from the staged
 *   file works everywhere here and 404s on S3. This server compares every
 *   path segment against the directory's own listing.
 * * **Nothing but files.** No `/bundle/` middleware, no game directory to fall
 *   back on: if the page asks for something that was not staged, it 404s.
 *
 * A `site.json` saying the bundle was staged gzipped makes it answer bundle
 * files with `Content-Encoding: gzip`, which is what `--sync` tells S3 to do.
 *
 * Passes when the page loads the served bundle -- not the welcome screen, not
 * a stale one -- starts, plays until the music and the effects have come from
 * the site -- as the AAC set's `clips.pack` and `bgm/*.m4a` when it was
 * staged (`tools/sounds.ts`), as `se/` and `bgm/` WAVs with `--wav` -- nothing it asked for failed but the `_OFF` stop sounds the game
 * never shipped (`audio/bgm.ts`), and nothing was asked of another origin.
 */
import { chromium } from "playwright-core";
import { createReadStream, existsSync, readFileSync, readdirSync, statSync }
  from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import { freePort } from "./lib/player.mjs";

const root = resolve(process.argv[2] ?? join(import.meta.dirname, "..", "..",
                                             "extract", "site"));
if (!existsSync(join(root, "index.html"))) {
  console.error(`site_check: nothing staged at ${root} -- run npm run site`);
  process.exit(3);
}
let record = {};
try { record = JSON.parse(readFileSync(join(root, "site.json"), "utf8")); }
catch { /* staged by hand: plain files */ }

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".glb": "model/gltf-binary",
  ".wav": "audio/wav", ".svg": "image/svg+xml",
};

/** The file at `rel`, only if every segment is spelled as on disk. */
function exact(rel) {
  let dir = root;
  const parts = rel.split("/").filter(Boolean);
  for (const p of parts) {
    if (p === "." || p === ".." || p.startsWith(".")) return null;
    let names;
    try { names = readdirSync(dir); } catch { return null; }
    if (!names.includes(p)) return null;
    dir = join(dir, p);
  }
  try { return statSync(dir).isFile() ? dir : null; } catch { return null; }
}

const server = createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith("/")) rel += "index.html";
  const file = exact(rel);
  if (!file || rel === "/site.json") {
    res.statusCode = 404;
    return res.end("not found");
  }
  const size = statSync(file).size;
  res.setHeader("Content-Type", MIME[extname(file)] ?? "application/octet-stream");
  if (record.gzip && rel.startsWith("/bundle/")) {
    res.setHeader("Content-Encoding", "gzip");
  }
  res.setHeader("Accept-Ranges", "bytes");
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) {
      res.statusCode = 416;
      res.setHeader("Content-Range", `bytes */${size}`);
      return res.end();
    }
    res.statusCode = 206;
    res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
    res.setHeader("Content-Length", String(end - start + 1));
    return createReadStream(file, { start, end }).pipe(res);
  }
  res.setHeader("Content-Length", String(size));
  createReadStream(file).pipe(res);
});

const port = await freePort();
await new Promise((ok) => server.listen(port, "127.0.0.1", ok));

let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}${ok || !detail ? "" : ` -- ${detail}`}`);
};

console.log(`site_check: ${root}${record.gzip ? " (gzipped bundle)" : ""}\n`);
const browser = await chromium.launch({
  channel: "chrome", headless: !process.argv.includes("--head"),
});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const bad = [];
  const got = { bgm: 0, se: 0, bundle: 0 };
  // The page asks nothing of any other origin: everything it needs is on the
  // site, so a site copied anywhere works whole.
  const origin = `http://127.0.0.1:${port}/`;
  const foreign = [];
  page.on("request", (r) => {
    const u = r.url();
    if (!u.startsWith(origin) && !/^(data|blob):/.test(u)) foreign.push(u);
  });
  page.on("pageerror", (e) => bad.push(`threw: ${e.message}`));
  page.on("response", (r) => {
    const path = new URL(r.url()).pathname;
    if (r.status() >= 400) {
      if (!/_off\.wav$/i.test(path)) bad.push(`${r.status()} ${path}`);
      return;
    }
    for (const k of Object.keys(got)) if (path.startsWith(`/${k}/`)) got[k]++;
    // The AAC set's effects are one file, fetched with the stage.
    if (path === "/clips.pack") got.se++;
  });
  await page.goto(`http://127.0.0.1:${port}/index.html?stage=1`,
                  { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !document.querySelector("#loading")
      || document.querySelector(".export-card"), null, { timeout: 120_000 });
  check("the served bundle loads, not the build-one screen",
        !(await page.$(".export-card")));
  check("...and is not marked out of date", !(await page.$(".crumb-warn")));
  await page.click(".start-btn");
  // Until the script's first `se_play` of a track, which in stage 1 is some
  // way in -- `tools/bgm_loop.mjs` allows two minutes for it.
  // The AAC set's music and pack arrive with the stage, before Start, so
  // the sound button is waited for as well: it turns on a moment after.
  const soundOn = () => page.evaluate(() =>
    document.querySelector("#sound")?.getAttribute("aria-pressed"));
  const t0 = Date.now();
  while ((got.bgm === 0 || got.se === 0 || await soundOn() !== "true")
         && Date.now() - t0 < 120_000) {
    await page.waitForTimeout(500);
  }
  const sound = await soundOn();
  check("it starts, with sound", sound === "true", `sound ${sound}`);
  check("the bundle came from the site", got.bundle >= 4, `${got.bundle} files`);
  check("the music came from the site", got.bgm >= 1, `${got.bgm} responses`);
  check("so did the effects", got.se >= 1, `${got.se} responses`);
  check("nothing it asked for was missing", bad.length === 0, bad.join("; "));
  check("and it asked nothing of any other site", foreign.length === 0,
        foreign.slice(0, 5).join("; "));
} finally {
  await browser.close();
  server.close();
}
console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
