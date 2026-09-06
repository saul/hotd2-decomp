/**
 * Are the shot effects actually reaching the screen?
 *
 * `test/port.test.ts` asserts the pools and `test/render.test.ts` asserts the
 * nodes, and both were green while the page showed nothing — because neither
 * can see the one thing that has to be true for a viewer: that the bundle
 * carries the `slots_effect` models and the layer found them. This loads the
 * real page, fires real shots and reads the layer's own readout back.
 *
 *     node tools/effects.mjs
 *     node tools/effects.mjs --url '?stage=2&block=8'
 *
 * It prints one line per sample of `render/effects.ts`'s `describe`, so a run
 * that draws nothing says which of the three reasons it is: no templates (the
 * bundle is stale — re-export), no records (the port is not spawning), or
 * records with no nodes (a slot outside the exported set).
 *
 * Two traps it works around, both of which cost a run each:
 *
 * * the sidebar's groups start collapsed and a collapsed group renders no
 *   rows, so `innerText` finds nothing to read;
 * * expanding one leaves a `<summary>` focused, and the player's shortcuts
 *   skip a key when something focusable has it — so the Space that starts
 *   playback toggles the group back shut instead, the game never advances,
 *   and every shot is a miss into an empty scene.
 *
 * Screenshots go to `web/shots/`, which is gitignored.
 */
import { openPlayer, waitForLoad, enableShooting, SHOTS } from "./lib/player.mjs";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const opt = (n, d = null) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

const { page, state, close } = await openPlayer({
  url: opt("url", "?stage=1&block=4"), size: "1280x800",
  headless: !args.includes("--head"), quiet: true,
});

/** Every group open: a collapsed one renders no rows to read. */
const openAll = async () => {
  const n = await page.locator("#right summary").count().catch(() => 0);
  for (let i = 0; i < n; i++) {
    const el = page.locator("#right summary").nth(i);
    const open = await el.evaluate((e) => e.parentElement?.open ?? true)
      .catch(() => true);
    if (!open) await el.click().catch(() => {});
  }
  await page.evaluate(() => document.activeElement?.blur?.());
};
const row = async (label) => {
  const rows = (await page.locator("#right").innerText().catch(() => ""))
    .split("\n").map((r) => r.trim());
  const i = rows.indexOf(label);
  return i < 0 ? "(no row)" : rows[i + 1] ?? "";
};

let bad = 0;
const check = (name, ok, detail = "") => {
  if (ok) console.log(`  ok    ${name}`);
  else { bad++; console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
};

try {
  await waitForLoad(page);
  await enableShooting(page);
  await openAll();
  mkdirSync(SHOTS, { recursive: true });
  const box = await page.locator("#viewport").boundingBox();

  check("the bundle carries the effect models",
        /templates/.test(await row("effects"))
        && !/no effect models/.test(await row("effects")),
        await row("effects"));

  await page.keyboard.press("Space");
  await page.waitForTimeout(2000);

  // A shot into the level. The muzzle and the round are unconditional; the
  // impact is not -- `SpawnWorldImpact` only fires when the segment meets a
  // quad in the script's own selected collision sets, and plenty of what is
  // on screen has no collision behind it. So the impact is counted over the
  // volley rather than demanded of one shot.
  let miss = "";
  let marked = "";
  for (let i = 0; i < 12; i++) {
    const x = box.x + box.width * (0.2 + (i % 4) * 0.2);
    // Not the very bottom: the viewport is letterboxed and the black bar is
    // outside the scene, where a ray meets nothing at all.
    const y = box.y + box.height * (0.62 + (i % 4) * 0.05);
    await page.mouse.move(x, y);
    await page.mouse.click(x, y);
    await page.waitForTimeout(50);
    const r = await row("effects");
    if (!miss && /blood 0/.test(r)) miss = r;
    if (!marked && /sprites [1-9]/.test(r)) marked = r;
    await page.waitForTimeout(120);
  }
  console.log(`  miss  ${miss || "(every shot in the volley hit flesh)"}`);
  check("a shot lights the muzzle", /flash [1-9]/.test(miss), miss);
  check("...and throws a round", /tracer [1-9]/.test(miss), miss);
  // Only meaningful where the script has selected some collision.
  // `set_collision_set_full` is an opcode like any other, and between two of
  // them the level genuinely has nothing to hit -- `SpawnWorldImpact` then
  // spawns nothing, in the engine as here, so asserting it would be asserting
  // the scene rather than the port.
  const coli = await row("coli");
  if (/^0 quads/.test(coli)) {
    console.log(`  --    surface impact not asserted: ${coli}`);
  } else {
    check("...and one that met collision marks the surface",
          /sprites [1-9]/.test(marked),
          marked || `no shot met a quad, with ${coli}`);
  }
  await page.screenshot({ path: resolve(SHOTS, "effects_miss.png") });

  // ...and one into a zombie, which bleeds and does not spark.
  let bled = "";
  outer:
  for (let round = 0; round < 20; round++) {
    await page.waitForTimeout(700);
    for (let gy = 0; gy < 6; gy++) {
      for (let gx = 0; gx < 8; gx++) {
        const x = box.x + box.width * (0.08 + gx * 0.12);
        const y = box.y + box.height * (0.18 + gy * 0.13);
        await page.mouse.move(x, y);
        await page.mouse.click(x, y);
        const r = await row("effects");
        if (/blood [1-9]/.test(r)) { bled = r; break outer; }
      }
    }
  }
  console.log(`  hit   ${bled || "(never hit a character)"}`);
  check("a hit bleeds", /blood [1-9]/.test(bled), bled);
  await page.screenshot({ path: resolve(SHOTS, "effects_blood.png") });
  await page.waitForTimeout(500);
  const gone = await row("effects");
  check("...and the spray runs out", /blood 0/.test(gone), gone);
} finally { await close(); }
console.log(bad ? `\n${bad} failed` : "\nall passed");
process.exit(bad || state.faults ? 1 : 0);
