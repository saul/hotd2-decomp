/**
 * A first visit, end to end: nothing served, nothing remembered, one folder.
 *
 * What a person sees the first time they open the page is the one screen no
 * other check reaches -- every other harness opens on a bundle the dev server
 * serves. This serves an **empty** bundle directory, so the page has nothing
 * to play and nothing to build from, and then does what that person would:
 *
 *   1. the welcome is up, with one button and no workbench;
 *   2. the button takes the game folder (the `<input webkitdirectory>` path,
 *      as `bundle_flow.mjs` does: a directory picker cannot be automated);
 *   3. every stage is built, in both modes -- twelve bundles in the browser's
 *      own cache;
 *   4. the page is in stage 1, on its start screen, without a reload.
 *
 *     npm run first-visit -- --game-dir "/path/to/install"
 *
 * Nothing in `web/src/` knows it is being watched. The folder is the real
 * install, and the build is the shipping worker.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const gameDir = args[args.indexOf("--game-dir") + 1];
if (!args.includes("--game-dir") || !gameDir) {
  console.error('usage: npm run first-visit -- --game-dir "/path/to/install"');
  process.exit(2);
}

let bad = 0;
const check = (name, ok, why = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}${ok ? "" : ` -- ${why}`}`);
  if (!ok) bad++;
};

// An empty bundle directory: the server has nothing, so the page is a first
// visit. Set before the import, because the dev server reads it at start-up.
const empty = await mkdtemp(join(tmpdir(), "hod2-first-visit-"));
process.env.HOTD2_BUNDLE = empty;
const { openPlayer } = await import("./lib/player.mjs");
const { page, state, close } = await openPlayer({
  headless: !args.includes("--head"), quiet: true, debug: false,
  // The `<input webkitdirectory>` path: a directory picker cannot be driven.
  init: () => { delete globalThis.showDirectoryPicker; },
});

try {
  console.log("\nThe first thing a visitor sees:\n");
  const card = page.locator(".export-card.welcome");
  await card.waitFor({ timeout: 60_000 });
  check("the welcome is up", true);
  const text = await card.innerText();
  check("...and says what it is going to do",
        /six stages/i.test(text) && /Arcade and Original/i.test(text), text);
  check("...with one button and not the workbench",
        await page.locator(".export-tile").count() === 0
        && await card.locator(".export-go").count() === 1);

  console.log("\nOne folder, and everything built:\n");
  // A marker a reload would wipe: the page must take the stage on without one.
  await page.evaluate(() => { window.__noReload = true; });
  const t0 = Date.now();
  const chooser = page.waitForEvent("filechooser", { timeout: 30_000 });
  await card.locator(".export-go").click();
  await (await chooser).setFiles(gameDir);
  // The welcome goes when the build has finished and the page has taken the
  // stage on; the start screen is what is left.
  await page.waitForSelector(".export-card", { state: "detached",
                                               timeout: 600_000 });
  const built = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`    built in ${built}s`);
  const stages = await page.evaluate(async () => {
    try {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle("bundle");
      const f = await (await dir.getFileHandle("manifest.json")).getFile();
      return JSON.parse(await f.text()).stages.map((s) => s.name).sort();
    } catch (e) { return String(e); }
  });
  check("all six stages, in both modes, are in the browser's cache",
        Array.isArray(stages) && stages.length === 12
        && stages.includes("stage1") && stages.includes("stage6_original"),
        JSON.stringify(stages));

  console.log("\nStraight into stage 1:\n");
  await page.waitForSelector("#loading", { state: "detached",
                                           timeout: 120_000 });
  const start = await page.locator("#paused-overlay").innerText()
    .catch(() => "");
  check("the page is in stage 1, on its start screen",
        /STAGE 1/.test(start) && /Start/i.test(start), start);
  check("...without a reload",
        await page.evaluate(() => window.__noReload === true));
  const q = await page.evaluate(() => location.search);
  check("...and the address says so", /stage=1\b/.test(q) || q === "", q);
  // The server's 404 for the manifest is the first visit itself -- there is
  // no bundle -- and it is excused, by its URL. **The sound 404s are a known
  // gap, and are counted apart rather than excused:** the page fetches every
  // sound from the server (`/bgm`, `/se`, `/voice`), which serves them out of
  // the game directory a *served* bundle's manifest names. A bundle built in
  // the browser has no server behind it that knows the install, so a first
  // visit plays in silence until the page reads sounds from the folder it was
  // given. Printed every run so it cannot be forgotten, and not a failure of
  // the flow this checks.
  const sound = state.faultLines
    .filter((l) => /\/(bgm|se|voice)\/[^)]*\)$/.test(l));
  const faults = state.faultLines
    .filter((l) => !/\/bundle\/manifest\.json\)$/.test(l))
    .filter((l) => !sound.includes(l));
  if (sound.length) {
    console.log(`  gap   ${sound.length} sound request(s) 404: a browser-built `
                + "bundle has no sound until the page reads it from the folder");
  }
  check("no console errors or page exceptions", faults.length === 0,
        faults.join(" | "));
} finally {
  await close();
  await rm(empty, { recursive: true, force: true });
}

console.log(bad ? `\n${bad} failed` : "\nall passed");
process.exit(bad ? 1 : 0);
