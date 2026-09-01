/**
 * A screenshot of the running player, so what it actually looks like can be
 * looked at.
 *
 * Every other check here reads the source or renders to a string. None of them
 * loads the page, and the failures this project keeps meeting are exactly the
 * ones that survive a green `tsc` and a green `vite build`: a column that does
 * not appear, a stylesheet rule that styles nothing, a canvas drawing into a
 * node nothing is showing. This is the check that is a pair of eyes.
 *
 * It uses the **installed Chrome** (`channel: "chrome"`), headed, with no
 * ANGLE overrides — so WebGL runs on the real GPU through Metal, the same path
 * the browser you would open yourself uses. A software rasteriser would render
 * something plausible and slightly wrong, which is worse than not running.
 * The renderer string is printed on every run for that reason: a screenshot
 * that silently fell back to SwiftShader is a screenshot that lies.
 *
 * Nothing in `web/src/` knows this exists. The player is already addressable
 * by URL — stage, block, step, op, mode, slot, frame, freeze — and "the page
 * has settled" is `#loading` leaving the DOM, so no seam into the app is
 * needed to reach a state or to know it has been reached. If one is ever
 * needed for a state the URL cannot name, it goes in `app/harness.ts` and it
 * may do nothing a `UiCommand` cannot.
 *
 *   node tools/shot.mjs --out cold
 *   node tools/shot.mjs --url '?stage=2&block=12&op=0&freeze=1' --out wait
 *   node tools/shot.mjs --el '#right' --out sidebar
 *
 * Output goes to `web/shots/`, which is gitignored: a screenshot of a stage is
 * derived game art, and this repository does not commit game assets.
 */
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = dirname(fileURLToPath(import.meta.url)).replace(/\/tools$/, "");
const SHOTS = join(WEB, "shots");

const args = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);

const url = opt("url", "");
const out = opt("out", "shot");
const el = opt("el");
const waitFor = opt("wait");
const [w, h] = (opt("size", "1600x1000")).split("x").map(Number);
/** Milliseconds to keep playing before the shot, for a frame mid-animation. */
const settle = Number(opt("settle", "0"));
const headless = flag("headless");

/** A port nothing is listening on, so a dev server you already have is safe. */
function freePort() {
  return new Promise((ok, fail) => {
    const s = createServer();
    s.on("error", fail);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
  });
}

/** Vite, on its own port, killed on the way out. */
async function serve(port) {
  const proc = spawn("npx", ["vite", "--port", String(port), "--strictPort"], {
    cwd: WEB, stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stderr.on("data", (b) => process.stderr.write(`vite: ${b}`));
  await new Promise((ok, fail) => {
    const timer = setTimeout(
      () => fail(new Error("vite did not start within 30s")), 30_000);
    proc.stdout.on("data", (b) => {
      if (String(b).includes("ready in") || String(b).includes("Local:")) {
        clearTimeout(timer);
        ok();
      }
    });
    proc.on("exit", (c) => fail(new Error(`vite exited with ${c}`)));
  });
  return proc;
}

const port = await freePort();
console.log(`vite on :${port}`);
const vite = await serve(port);

const browser = await chromium.launch({ channel: "chrome", headless });
let failed = 0;
try {
  const page = await browser.newPage({ viewport: { width: w, height: h } });

  // Anything the page logs is worth seeing: this is the only check that runs
  // the module graph, so a throw at startup surfaces here and nowhere else.
  page.on("console", (m) => {
    if (m.type() === "error") { failed++; console.log(`  console: ${m.text()}`); }
  });
  page.on("pageerror", (e) => { failed++; console.log(`  threw: ${e.message}`); });
  // A 404 is worth naming rather than counting: the bundle is served out of
  // `extract/player/` by a vite middleware, so a missing file here is either a
  // stale export or a path the player asked for and should not have.
  page.on("response", (r) => {
    if (r.status() >= 400) console.log(`  ${r.status()} ${r.url()}`);
  });
  // Both events are needed. A `<audio>` element that cannot fetch its source
  // never produces a response at all -- Chrome aborts the request -- so a
  // missing BGM track shows up here and nowhere else, and looks in the console
  // like a bare "Failed to load resource" with no URL attached to it.
  page.on("requestfailed", (r) => {
    console.log(`  failed ${r.url()} (${r.failure()?.errorText ?? "?"})`);
  });

  await page.goto(`http://127.0.0.1:${port}/${url}`,
                  { waitUntil: "domcontentloaded" });

  // Which renderer actually got the work. A run that fell back to software
  // still produces a picture, and the picture is subtly not what a player
  // sees, so this is printed rather than assumed every time.
  const gpu = await page.evaluate(() => {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2") ?? c.getContext("webgl");
    if (!gl) return "no WebGL context";
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    return dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : "renderer hidden";
  });
  console.log(`gpu: ${gpu}`);

  // The bundle and the stage are fetched after the first paint, so the page
  // is not itself until the overlay goes. This is the whole of the timing:
  // no fixed wait anywhere, because a fixed wait is a race with a pass rate.
  await page.waitForSelector(waitFor ?? "#loading", {
    state: waitFor ? "attached" : "detached", timeout: 60_000,
  });
  // Drive it. A stage sitting at its entry block has simulated nothing, so a
  // shot of frame zero is a shot of a scene with no actors in it yet -- press
  // Space, give it some seconds, and what comes back is the game running.
  for (const sel of opt("click", "").split(",").filter(Boolean)) {
    await page.click(sel);
  }
  // Blur first, and it is not a nicety. The player's shortcuts are on
  // `window` and skip the event when something typable has focus, so a key
  // pressed straight after a click goes to the control instead -- Space on a
  // just-clicked checkbox toggles it back off, which reads as "the toggle does
  // not work" and is really "the harness undid it".
  if (opt("press")) await page.evaluate(() => (document.activeElement)?.blur?.());
  for (const key of opt("press", "").split(",").filter(Boolean)) {
    await page.keyboard.press(key);
  }
  if (settle > 0) await page.waitForTimeout(settle);
  // A second round, after the game has been running for a while: the state
  // worth photographing is often reached by doing something *to* a running
  // game rather than to a freshly loaded one.
  for (const sel of opt("then", "").split(",").filter(Boolean)) {
    await page.click(sel);
  }
  const after = Number(opt("after", "0"));
  if (after > 0) await page.waitForTimeout(after);
  // One more frame, so the shot is of a frame that has been through the whole
  // of `Player.frame` — render, then publish — and not of a half-applied one.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));

  // Read text out of the page. A panel is often narrower than what it is
  // saying -- the actor rows ellipsise exactly where the interesting number
  // is -- and a screenshot of a truncated row is not evidence.
  for (const sel of opt("dump", "").split(",").filter(Boolean)) {
    const text = await page.locator(sel).first().innerText().catch(() => null);
    console.log(`--- ${sel} ---\n${text ?? "(no such element)"}`);
  }

  mkdirSync(SHOTS, { recursive: true });
  const path = resolve(SHOTS, `${out}.png`);
  const target = el ? page.locator(el) : page;
  await target.screenshot({ path });
  console.log(`wrote ${path}`);
} finally {
  await browser.close();
  vite.kill("SIGTERM");
}
process.exit(failed ? 1 : 0);
