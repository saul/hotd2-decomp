/**
 * Booting the player under Chrome, for the tools that drive it.
 *
 * `shot.mjs` had all of this inline and `playthrough.mjs` wanted the same
 * thing, which in this repository is the moment to stop: the harnesses that
 * each built their own copy of `DescriptorFromPlacement` drifted, and reported
 * nine working throwers that did not work. One bootstrap, two drivers.
 *
 * It uses the **installed Chrome** (`channel: "chrome"`), headed by default,
 * with no ANGLE overrides — so WebGL runs on the real GPU through Metal, the
 * same path a browser you open yourself uses. A software rasteriser would
 * render something plausible and slightly wrong, which is worse than not
 * running, so the renderer string is printed on every run.
 */
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const WEB = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const SHOTS = join(WEB, "shots");

/** A port nothing is listening on, so a dev server you already have is safe. */
export function freePort() {
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
export async function serve(port) {
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

/**
 * A running player on its own server, and the page it is on.
 *
 * `faults` counts what the page complained about — a console error or a throw
 * — because this is the only check in the tree that runs the module graph, so
 * a throw at startup surfaces here and nowhere else.
 */
export async function openPlayer({ url = "", size = "1600x1000",
                                   headless = false, quiet = false,
                                   init = null } = {}) {
  const [width, height] = size.split("x").map(Number);
  const port = await freePort();
  if (!quiet) console.log(`vite on :${port}`);
  const vite = await serve(port);
  const browser = await chromium.launch({ channel: "chrome", headless });
  // `faults` stays a **number**, and `faultLines` is what it counted. An
  // array alone would not do: every caller writes `if (state.faults)`, and an
  // empty array is truthy, so a clean run would report itself as dirty.
  const state = { faults: 0, faultLines: [] };
  // Always recorded and always printed, `quiet` or not. A counted fault with
  // no text is unactionable: every stage's playthrough reported "1 console
  // errors on the way" for as long as the text was behind `--loud`, and
  // naming it took a bespoke script and a measurement. Whatever a check
  // counts, it says.
  const fault = (line) => {
    state.faults++;
    state.faultLines.push(line);
    console.log(`  ${line}`);
  };

  const page = await browser.newPage({ viewport: { width, height } });
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    // **The one excused URL, named.** Chrome asks for `/favicon.ico` by
    // itself, the dev server has none, and the 404 is the browser's noise
    // rather than the player's. It is excused by exact URL and by nothing
    // else -- an exclusion that matched a pattern would be how a real 404
    // came to be hidden behind this one. Note the message itself carries no
    // URL at all; only `location()` says which resource it was, which is why
    // the location is what is tested and what is printed.
    const where = m.location().url;
    if (where.endsWith("/favicon.ico")) return;
    // A `console.error` the page called itself has no location, so the
    // parenthetical is only added when there is a resource to name.
    fault(`console: ${m.text()}${where ? ` (${where})` : ""}`);
  });
  page.on("pageerror", (e) => {
    fault(`threw: ${e.message}`);
  });
  // A 404 is worth naming rather than counting: the bundle is served out of
  // `extract/player/` by a vite middleware, so a missing file is either a
  // stale export or a path the player asked for and should not have.
  page.on("response", (r) => {
    if (r.status() >= 400 && !quiet) console.log(`  ${r.status()} ${r.url()}`);
  });
  // Both events are needed. An `<audio>` element that cannot fetch its source
  // never produces a response at all -- Chrome aborts the request -- so a
  // missing BGM track shows up here and nowhere else.
  //
  // **But an aborted `media` request is not a missing track**, and reading it
  // as one sent a session looking for a BGM file that was being served
  // correctly the whole time. Every stage logs one:
  // `bgm/ST<n>_AR.WAV (net::ERR_ABORTED) type=media`, with **no** 4xx
  // response beside it, while `tools/audio.mjs` measures the track playing at
  // a peak of 0.5. Chrome abandons a media request it no longer needs; the
  // 404 that was being blamed on it was `/favicon.ico`, which the console
  // handler above now excuses by name. So this is printed and deliberately
  // **not counted** -- the resource type is what separates the two cases.
  page.on("requestfailed", (r) => {
    if (!quiet) {
      console.log(`  failed ${r.url()} (${r.failure()?.errorText ?? "?"}) `
                  + `type=${r.resourceType()}`);
    }
  });

  // Instrumentation that has to be in place before the app's first line runs
  // -- `tools/pacing.mjs` counts the page's own `requestAnimationFrame` calls
  // this way. It is deliberately not a seam in `src/`: nothing in the player
  // should know it can be watched, and wrapping a browser API from outside is
  // the one form of watching that cannot change what is watched.
  if (init) await page.addInitScript(init);

  await page.goto(`http://127.0.0.1:${port}/${url}`,
                  { waitUntil: "domcontentloaded" });

  // Which renderer actually got the work. A run that fell back to software
  // still produces a picture, and the picture is subtly not what a player
  // sees, so this is printed rather than assumed.
  const gpu = await page.evaluate(() => {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2") ?? c.getContext("webgl");
    if (!gl) return "no WebGL context";
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    return dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : "renderer hidden";
  });
  if (!quiet) console.log(`gpu: ${gpu}`);

  const close = async () => {
    await browser.close();
    vite.kill("SIGTERM");
  };
  return { page, browser, port, state, close };
}

/**
 * The page is not itself until the loading overlay goes.
 *
 * The bundle and the stage are fetched after the first paint, so this is the
 * whole of the timing: no fixed wait anywhere, because a fixed wait is a race
 * with a pass rate.
 */
export async function waitForLoad(page, selector) {
  await page.waitForSelector(selector ?? "#loading", {
    state: selector ? "attached" : "detached", timeout: 60_000,
  });
}

// `enableShooting` was here, and every driver called it first. Shooting was a
// checkbox that defaulted to **off**, and off it took the game with it: the
// live-enemy gates read `WalkerHost.aliveEnemies`, which answered null while
// it was off, and a null count is not a condition — so a playthrough sailed
// through every fight it existed to test. There is no toggle now. See the note
// at the top of `src/render/shooting.ts`.
