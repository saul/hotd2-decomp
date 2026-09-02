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
  const state = { faults: 0 };

  const page = await browser.newPage({ viewport: { width, height } });
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    state.faults++;
    if (!quiet) console.log(`  console: ${m.text()}`);
  });
  page.on("pageerror", (e) => {
    state.faults++;
    console.log(`  threw: ${e.message}`);
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
  page.on("requestfailed", (r) => {
    if (!quiet) {
      console.log(`  failed ${r.url()} (${r.failure()?.errorText ?? "?"})`);
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

/**
 * Turn shooting on.
 *
 * With it off `WalkerHost.aliveEnemies` answers null and every live-enemy gate
 * passes on the spot, so a playthrough sails through the fights it is there to
 * test — and the spawns are dropped out from under the scene you are watching.
 */
export async function enableShooting(page) {
  await page.click('label[title^="Click to shoot"] input');
  // The player's shortcuts are on `window` and skip the event when something
  // typable has focus, so a key pressed straight after a click would go to the
  // control instead -- Space on a just-clicked checkbox toggles it back off.
  await page.evaluate(() => document.activeElement?.blur?.());
}
