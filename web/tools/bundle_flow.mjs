/**
 * The bundle flow, in a real browser, end to end.
 *
 * Nothing else can see any of this. `tsc` and `vite build` are green on a
 * page whose export screen is unreachable -- which it was, for a release --
 * and the interesting half of the feature is a worker, the Origin Private
 * File System and a directory the user picked, none of which exist under
 * node. So: Chrome, the real page, a real install.
 *
 *     npm run bundle-flow -- --game-dir "/path/to/THE HOUSE OF THE DEAD 2"
 *
 * It is **not** a `verify_all` row: it builds two stages, so it is minutes
 * rather than the ten seconds that suite is worth having. Run it when you
 * change anything under `src/app/install/`, `src/app/bundles.ts` or the
 * loader.
 *
 * `showDirectoryPicker` is deleted before the app's first line so `pickInstall`
 * takes the `<input webkitdirectory>` path, which Playwright can drive with a
 * real directory; a directory *picker* cannot be automated at all. Everything
 * else -- the worker, `hod2lib`, OPFS, the zip writer -- is the shipping code.
 *
 * The served bundle is trimmed to two stages in a temporary directory, because
 * "a stage the page does not hold" is the state the on-demand build exists for
 * and a full `extract/player/` never reaches it.
 */
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { WEB } from "./lib/player.mjs";

const args = process.argv.slice(2);
const gameDir = args[args.indexOf("--game-dir") + 1];
if (!args.includes("--game-dir") || !gameDir) {
  console.error('usage: npm run bundle-flow -- --game-dir "/path/to/install"');
  process.exit(2);
}

let bad = 0;
const check = (name, ok, why = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}${ok ? "" : ` -- ${why}`}`);
  if (!ok) bad++;
};

/** A served bundle holding stages 1 and 2 only, so 3 has to be built. */
async function trim(from, to) {
  const m = JSON.parse(readFileSync(join(from, "manifest.json"), "utf8"));
  const keep = new Set(["stage1", "stage2"]);
  m.stages = m.stages.filter((s) => keep.has(s.name));
  if (m.stages.length < 2) {
    throw new Error(`${from} has no stage1/stage2 to serve; export first`);
  }
  await writeFile(join(to, "manifest.json"), JSON.stringify(m));
  for (const n of keep) await symlink(resolve(from, n), join(to, n));
}

const work = await mkdtemp(join(tmpdir(), "hod2-flow-"));
await trim(process.env.HOTD2_BUNDLE ?? resolve(WEB, "..", "extract", "player"),
           work);
process.env.HOTD2_BUNDLE = work;

// Imported *after* HOTD2_BUNDLE is set: the dev server reads it at start-up.
const { openPlayer, waitForLoad } = await import("./lib/player.mjs");
const { page, close } = await openPlayer({
  headless: true, quiet: true,
  init: () => { delete globalThis.showDirectoryPicker; },
});

const card = () => page.locator(".export-card");

/** Wait out a load, printing each new line the overlay shows. */
async function waitForStage(what, budgetMs) {
  const seen = new Set();
  const t0 = Date.now();
  for (;;) {
    if (Date.now() - t0 > budgetMs) throw new Error(`${what}: timed out`);
    if (!await page.locator("#loading").count()) return Date.now() - t0;
    const text = (await page.locator("#loading-text").innerText()).trim();
    if (text && !seen.has(text)) { seen.add(text); console.log(`    ${text}`); }
    if (await page.locator("#loading-text.err").count()) {
      throw new Error(`${what}: ${text}`);
    }
    await page.waitForTimeout(300);
  }
}

/**
 * What is in the OPFS thumbnail store, poll until something is.
 *
 * Polled from here rather than with `page.waitForFunction`, and that is not a
 * style choice: the predicate has to `await` two file-system handles, and
 * `waitForFunction` with an `async` predicate **resolves on the promise
 * object** -- truthy before it settles -- and hands back a handle that reads
 * as `null`. Measured: it returned `null` on a run where the file was in the
 * store 100 ms later. `page.evaluate` does await, so the loop lives here,
 * exactly like {@link waitForStage}.
 */
async function waitForThumb(budgetMs) {
  const t0 = Date.now();
  for (;;) {
    const names = await page.evaluate(async () => {
      try {
        const dir = await (await navigator.storage.getDirectory())
          .getDirectoryHandle("thumbs");
        const out = [];
        for await (const n of dir.keys()) if (n.endsWith(".png")) out.push(n);
        return out;
      } catch { return []; }
    });
    if (names.length) return { names, ms: Date.now() - t0 };
    if (Date.now() - t0 > budgetMs) return null;
    await page.waitForTimeout(100);
  }
}

try {
  console.log("\nThe page opens on the bundle it was served:\n");
  await waitForLoad(page);
  let opts = await page.locator("#stage-select option").allInnerTexts();
  check("only the served stages are offered before an install is known",
        opts.join(",") === "1,2", opts.join(","));
  check("and the way to the bundle screen is in the bar",
        await page.locator(".bundle-open").count() === 1);

  console.log("\nThe bundle screen:\n");
  await page.locator(".bundle-open").click();
  await page.waitForSelector(".export-card");
  check("one tile per stage", await page.locator(".export-tile").count() === 6);
  const notes = await page.locator(".export-tile-note").allInnerTexts();
  check("each tile says whether that stage exists, and where",
        notes.filter((t) => t.trim() === "served").length === 2
        && notes.filter((t) => t.trim() === "not built").length === 4,
        notes.join(" | "));
  // **Two signals, waited on separately.** This was one
  // `waitForSelector(".export-tile img")` with a ten-second budget, and it
  // lost about one run in three -- the budget had already been raised from
  // whatever it was before, which did not help and could not have. The
  // picture is owed nine frames after the stage loads, then PNG-encoded, then
  // written to OPFS; the screen reads the store on mount. Measured: eight
  // frames elapse between `#loading` going away and this click, against the
  // nine the countdown needs, so the two orders are a photo finish. And
  // **losing it was permanent**: in six of seven failing runs the PNG was in
  // OPFS by the time the wait expired, so the thing being waited for had
  // already happened and no timeout could reach it.
  //
  // So: wait for the file, which is real state and arrives; then for the
  // tile, which now re-reads on every write (`onThumbWritten`). Separately,
  // because they break for different reasons -- a picture never taken and a
  // picture never shown are different bugs and the old check called both
  // "no picture".
  const wrote = await waitForThumb(30_000);
  check("the player writes a picture of the stage it opened on", !!wrote,
        "nothing under OPFS thumbs/ after 30s");
  if (wrote) console.log(`    ${wrote.names.join(", ")} after ${wrote.ms}ms`);
  // Short on purpose. The write has landed; if the tile is still empty the
  // screen is not noticing writes, and waiting longer would only hide that.
  let shot = true;
  try {
    await page.waitForSelector(".export-tile img", { timeout: 5_000 });
  } catch { shot = false; }
  check("the stage that has been open has a picture", shot,
        `${wrote ? wrote.names.join(", ") : "nothing"} in the store and `
        + `no tile shows it`);

  const chooser = page.waitForEvent("filechooser", { timeout: 30_000 });
  await card().locator("button", { hasText: "Choose folder" }).click();
  await (await chooser).setFiles(gameDir);
  await page.waitForSelector(".export-ok", { timeout: 300_000 });
  check("the install is accepted", true);

  console.log("\nBuilding stage 3 from the screen:\n");
  await page.locator(".export-tile", { hasText: "Stage 3" }).click();
  await card().locator("button", { hasText: "Build it" }).click();
  const t0 = Date.now();
  for (;;) {
    if (Date.now() - t0 > 900_000) throw new Error("the build timed out");
    if (await card().locator(".export-error").count()) {
      throw new Error(await card().locator(".export-error").innerText());
    }
    if (await card().locator(".export-ok").filter({ hasText: "Done" }).count()) break;
    await page.waitForTimeout(500);
  }
  console.log((await card().locator(".export-feed").innerText())
    .trim().split("\n").map((l) => `    ${l}`).join("\n"));
  const after = await page.locator(".export-tile", { hasText: "Stage 3" })
    .locator(".export-tile-note").innerText();
  check("the tile now says this browser built it", after.trim() === "built here",
        after);

  // **Before the screen is closed.** The picture used to be taken on the way
  // out, so anyone who built a stage and then reloaded the page instead of
  // pressing Back got no picture at all -- and after a `Build all` that is the
  // natural thing to do. It is taken as each stage lands now.
  let pictured = true;
  try {
    await page.locator(".export-tile", { hasText: "Stage 3" })
      .locator("img").waitFor({ timeout: 30_000 });
  } catch { pictured = false; }
  check("and it has its picture without the screen being closed", pictured);

  // A page reload would take this with it. Everything below asserts that the
  // stage came back *without* one -- the screen used to answer every exit
  // with `window.location.reload()` on one path and with nothing at all on
  // the other, and the second is how you got to keep looking at the geometry
  // you had just replaced.
  await page.evaluate(() => { window.__noReload = true; });

  // A built stage is photographed seven seconds in, and seven seconds into a
  // stage is not one colour. **Counting lit pixels is not enough**: the first
  // version of this asked whether the picture was mostly non-black and passed
  // on a flat fill of the fog, which is exactly what a capture taken during
  // the next stage's teardown looks like. Distinct colours is the measure that
  // tells a photograph from a wash.
  const thumbInk = async (n) => page.evaluate(async (n) => {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle("thumbs");
    const file = await (await dir.getFileHandle(`stage${n}.png`)).getFile();
    const bmp = await createImageBitmap(file);
    const c = document.createElement("canvas");
    c.width = bmp.width; c.height = bmp.height;
    const x = c.getContext("2d");
    x.drawImage(bmp, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    let lit = 0;
    const seen = new Set();
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] + d[i + 1] + d[i + 2] > 30) lit++;
      // Five bits a channel: enough to ignore dither and compression, far
      // too few to make one flat colour look like a scene.
      seen.add(((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3));
    }
    return { w: bmp.width, h: bmp.height, lit: lit / (d.length / 4),
             colours: seen.size };
  }, n);

  console.log("\nPlaying what was just built, from the screen:\n");
  await card().locator("button", { hasText: "Play stage 3" }).click();
  await page.waitForSelector(".export-card", { state: "detached" });
  // The overlay has to be *seen* before it is waited out: `waitForStage`
  // returns the moment `#loading` is absent, and immediately after the click
  // it has not appeared yet -- which reads as an instant load of the stage
  // that was already up.
  await page.waitForSelector("#loading", { state: "attached", timeout: 10_000 });
  await waitForStage("stage 3", 120_000);
  check("the play button switches to it without reloading the page",
        await page.evaluate(() => window.__noReload === true));
  let status = await page.locator("#status").innerText();
  check("and the player is on it", status.includes("stage3"), status);

  console.log("\nRebuilding the stage that is on screen:\n");
  await page.locator(".bundle-open").click();
  await page.waitForSelector(".export-card");
  const onTile = await page.locator(".export-tile.on .export-tile-name")
    .innerText();
  check("the screen opens on the stage that is playing", onTile === "Stage 3",
        onTile);
  await card().locator("button", { hasText: "Build it again" }).click();
  const t1 = Date.now();
  for (;;) {
    if (Date.now() - t1 > 900_000) throw new Error("the rebuild timed out");
    if (await card().locator(".export-error").count()) {
      throw new Error(await card().locator(".export-error").innerText());
    }
    if (await card().locator(".export-ok").filter({ hasText: "Done" }).count()) break;
    await page.waitForTimeout(500);
  }
  // Back rather than the play button: this is the exit that did nothing.
  await card().locator("button", { hasText: "Back" }).click();
  await page.waitForSelector(".export-card", { state: "detached" });
  await page.waitForSelector("#loading", { state: "attached", timeout: 10_000 });
  await waitForStage("stage 3", 120_000);
  check("Back reloads the stage that was rebuilt under it", true);
  check("...and still without reloading the page",
        await page.evaluate(() => window.__noReload === true));
  const ink = await thumbInk(3);
  check("and the stage it built has a picture of the stage in it",
        ink.lit > 0.2 && ink.colours > 200,
        `${ink.w}x${ink.h}, ${(100 * ink.lit).toFixed(0)}% lit, `
        + `${ink.colours} colours`);
  console.log(`    stage 3 thumbnail ${ink.w}x${ink.h}, `
    + `${(100 * ink.lit).toFixed(0)}% not black, ${ink.colours} colours`);

  await page.locator(".bundle-open").click();
  await page.waitForSelector(".export-card");
  await page.keyboard.press("Escape");
  await page.waitForSelector(".export-card", { state: "detached" });
  check("escape closes the screen", true);

  console.log("\nA stage in neither bundle, asked for from the top bar:\n");
  await page.waitForFunction(
    () => document.querySelectorAll("#stage-select option").length === 6,
    null, { timeout: 10_000 }).catch(() => {});
  opts = await page.locator("#stage-select option").allInnerTexts();
  check("with an install, every stage is offered",
        opts.join(",") === "1,2,3,4,5,6", opts.join(","));

  await page.locator("#stage-select").selectOption("4");
  await page.waitForSelector("#loading", { state: "attached", timeout: 10_000 });
  await waitForStage("stage 4", 900_000);
  check("stage 4 built itself and loaded", true);
  status = await page.locator("#status").innerText();
  check("and it is what the status line says", status.includes("stage4"), status);

  console.log("\nAnd again, which must come out of the cache:\n");
  await page.locator("#stage-select").selectOption("1");
  await waitForStage("stage 1", 120_000);
  const ms = await (async () => {
    await page.locator("#stage-select").selectOption("4");
    await page.waitForSelector("#loading", { state: "attached", timeout: 10_000 });
    return waitForStage("stage 4 again", 120_000);
  })();
  check("the second visit does not rebuild", ms < 30_000,
        `${(ms / 1000).toFixed(1)}s`);
  console.log(`    ${(ms / 1000).toFixed(1)}s`);
  status = await page.locator("#status").innerText();
  check("and it is still stage 4", status.includes("stage4"), status);

  console.log("\nA bundle built by an older exporter:\n");
  // The manifest is rewritten in flight rather than by building one with an
  // old exporter, which is the only way to get this state without keeping a
  // second checkout around. What the page reads is what matters, and this is
  // exactly what it would read.
  await page.route("**/bundle/manifest.json", async (route) => {
    const r = await route.fetch();
    const m = JSON.parse(await r.text());
    m.builder = { hash: "older", files: { ...m.builder.files, "nl1.ts": "old" } };
    for (const e of m.stages) e.builder = "older";
    await route.fulfill({ status: 200, contentType: "application/json",
                          body: JSON.stringify(m) });
  });
  await page.reload();
  await waitForLoad(page);
  await page.waitForTimeout(1000);
  const btn = page.locator(".bundle-open");
  const warns = async () =>
    ((await btn.getAttribute("class")) ?? "").split(/\s+/).includes("stale");
  // The reload lands on stage 4, which this browser built and which the route
  // above did not touch -- the served entries are the doctored ones. So the
  // button must be quiet here and loud on stage 1.
  let status2 = await page.locator("#status").innerText();
  check("a current stage does not warn, even with stale ones beside it",
        !await warns(), status2);
  await page.locator("#stage-select").selectOption("1");
  await waitForStage("stage 1", 120_000);
  status2 = await page.locator("#status").innerText();
  check("the Bundle button warns on the stage that is out of date",
        await warns(), status2);
  const tip = await btn.getAttribute("title");
  check("...and says what to do about it in one line",
        (tip ?? "").startsWith("Bundle needs rebuilding"), tip ?? "");
  await btn.click();
  await page.waitForSelector(".export-card");
  const why = await card().locator(".export-why").innerText();
  check("the screen names what changed under it", why.includes("nl1.ts"), why);
  // Only the served two were doctored; the two this browser built are
  // current, and saying otherwise would be the same noise the button is meant
  // not to be.
  const tiles = await page.locator(".export-tile-note").allInnerTexts();
  const says = (t) => t.includes("needs rebuilding");
  check("the served tiles say so and the freshly built ones do not",
        tiles.filter((t) => t.startsWith("served")).every(says)
        && !tiles.filter((t) => t.startsWith("built here")).some(says),
        tiles.join(" | "));
} finally {
  await close();
  await rm(work, { recursive: true, force: true });
}

console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);
