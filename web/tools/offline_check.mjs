/**
 * The service worker (`public/sw.js`), end to end, in a real Chrome on a dev
 * server of its own -- because the two things it promises pull against each
 * other, and only a browser can hold it to both:
 *
 * - **never stale while the server answers.** A reload is served through the
 *   worker, which keeps the page, its modules and the stage; a bundle file
 *   changed on disk (a re-export) is the new one on the very next reload,
 *   and kept in place of the old -- not the kept copy, not after a second
 *   reload;
 * - **the game with no server at all.** The server stopped, a reload loads
 *   the stage from the device and draws it; the server back, the next load
 *   is online again and current.
 *
 * `localhost` is a secure context, so no certificate is needed here; on a
 * phone the worker needs the dev server over HTTPS (`tools/https_cert.ts`).
 * The bundle is a private directory of links to the real one, with one small
 * file copied so it can be changed without touching the shared export.
 *
 *     HOTD2_BUNDLE=<dir> node tools/offline_check.mjs
 */
import { chromium } from "playwright-core";
import {
  appendFileSync, copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { freePort, requireBundle, serve } from "./lib/player.mjs";

requireBundle("offline_check");
const REAL = process.env.HOTD2_BUNDLE
  ?? join(import.meta.dirname, "..", "..", "extract", "player");

// The private bundle: every stage a link, stage 1's cameras a copy to edit.
const B = mkdtempSync(join(tmpdir(), "hod2-offline-bundle-"));
mkdirSync(join(B, "stage1"));
copyFileSync(join(REAL, "manifest.json"), join(B, "manifest.json"));
for (const d of readdirSync(REAL)) {
  if (d !== "manifest.json" && d !== "stage1") symlinkSync(join(REAL, d), join(B, d));
}
const CAM = join(B, "stage1", "stage1.cam.json");
for (const f of readdirSync(join(REAL, "stage1"))) {
  if (f === "stage1.cam.json") copyFileSync(join(REAL, "stage1", f), CAM);
  else symlinkSync(join(REAL, "stage1", f), join(B, "stage1", f));
}
process.env.HOTD2_BUNDLE = B;

let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}${ok || !detail ? "" : ` -- ${detail}`}`);
};

const port = await freePort();
let vite = await serve(port);
const profile = mkdtempSync(join(tmpdir(), "hod2-offline-profile-"));
const ctx = await chromium.launchPersistentContext(profile, {
  channel: "chrome", headless: true, viewport: { width: 1280, height: 800 },
});
const page = ctx.pages()[0] ?? await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

/** A load, to the stage up: the new document's loading screen gone, no failure on it. */
async function loaded() {
  await page.waitForFunction(() => document.readyState !== "loading");
  await page.waitForSelector("#loading", { state: "detached", timeout: 300_000 });
  return !(await page.$("#loading-text.err")) && !!(await page.$("canvas"));
}
const reload = async () => {
  await page.reload({ waitUntil: "domcontentloaded" });
  return loaded();
};
/** The cameras file as the page gets it, through the worker. */
const camTag = () => page.evaluate(async () =>
  (await fetch("bundle/stage1/stage1.cam.json")).headers.get("etag"));
const keptTag = () => page.evaluate(async () =>
  (await (await caches.open("hod2-v1")).match("bundle/stage1/stage1.cam.json"))
    ?.headers.get("etag") ?? null);

try {
  // `?sw=1`: under automation the page leaves the worker out unless asked.
  await page.goto(`http://127.0.0.1:${port}/?stage=1&sw=1`, { waitUntil: "domcontentloaded" });
  await loaded();
  await page.evaluate(() => navigator.serviceWorker.ready);
  const second = await reload();
  const kept = await page.evaluate(async () =>
    (await (await caches.open("hod2-v1")).keys()).map((r) => new URL(r.url).pathname));
  check("a reload is served through the worker",
        second && await page.evaluate(() => !!navigator.serviceWorker.controller));
  check(`...which kept the page, the code and the stage (${kept.length} files)`,
        kept.includes("/") && kept.includes("/src/app/net/session.ts")
        && kept.includes("/bundle/manifest.json") && kept.includes("/bundle/stage1/stage1.glb"),
        kept.slice(0, 6).join(", "));

  const before = await camTag();
  appendFileSync(CAM, "\n");           // a re-export, as far as the server can tell
  await reload();
  const after = await camTag();
  check(`a bundle file changed on the server is the new one on the next reload (${before} -> ${after})`,
        !!before && !!after && before !== after);
  check("...and is kept in place of the old", (await keptTag()) === after, String(await keptTag()));

  vite.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 1000));
  check("with the server gone, a reload loads the stage from the device and draws it",
        await reload(),
        await page.$eval("#loading-text", (e) => e.textContent).catch(() => "no loading text"));

  vite = await serve(port);
  appendFileSync(CAM, "\n");
  await reload();
  const back = await camTag();
  check(`with the server back, the next load is online again and current (${back})`,
        !!back && back !== after);
  check("nothing threw", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
  await ctx.close();
  vite.kill("SIGTERM");
  rmSync(B, { recursive: true, force: true });
  rmSync(profile, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
