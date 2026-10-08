/**
 * In the real page: **stage 1's window (class 0x44 selector 0) is shot
 * through its own mesh, and is in the moving-object collision passes.**
 *
 *     HOTD2_BUNDLE=... node tools/window_page.mjs --headless [--shot]
 *
 * Stage 1, block 2 step 0 op 28 places the window's two halves, evt
 * `0x1580` and `0x15CC` -- `PropBuildScriptFlagEffect` (`FUN_00472B30`),
 * each naming a blob in `coli1.bin`. `ScriptFlagEffectUpdate`
 * (`FUN_00473B90`) draws its effect tree with `EffectDrawWithCapture`,
 * copies the captured node's matrix over `obj+0x150` and
 * `RegisterForShotTest`s; the builder's `0x51` sends it to the mesh arm.
 * Before `class44/script_flag_effect.ts` filed it, a shot passed through.
 *
 * Two loads of the same address on the same seed. One **clicks** where the
 * page's own `shotTargets` puts a half (the middle of its blob through
 * `obj+0x150`) until one is hit; the other clicks nothing. The verdict is
 * what only a mesh hit on the window writes: `obj+0x34` bit 3, which
 * `MarkActorShot` raises and nothing in the routine clears (`L47`) -- and,
 * in both runs, the halves in `g_coli_dynamic_list`.
 *
 * `--shot` writes `shots/window_hit.png`, the frame of the click that hit,
 * and `shots/window_look.png`, frame 200 of the unclicked run.
 */
import { join } from "node:path";
import {
  openPlayer, pull, requireBundle, SHOTS, waitForLoad,
} from "./lib/player.mjs";

requireBundle("window_page");
const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const HALVES = [0x1580, 0x15cc];
const URL = "?stage=1&block=2&step=1&op=0&drive=1&seed=1";
const BUDGET = 900;
const CLICK_EVERY = 6;
/** `obj+0x34` bit 3, `MarkActorShot`'s hit bit. */
const HIT = 0x8;

let failures = 0;
const check = (what, ok, note = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}${note ? ` -- ${note}` : ""}`);
  if (!ok) failures += 1;
};

/** The two halves as the page's pool holds them, and the lists they are in. */
const halves = (page) => page.evaluate(async (ats) => {
  const { G } = await import("/src/game/globals.ts");
  return G.g_breakable_props
    .filter((p) => ats.includes(p.at) && !p.dead)
    .map((p) => ({
      id: p.id, at: p.at, flags: p.flags, blob: p.coliBlob,
      m: !!p.coliMatrix, cursor: p.effectFrames,
      filed: G.g_shot_test_list.some((e) => e.prop === p.id),
      published: G.g_coli_dynamic_list.some((e) => e.prop === p.id),
    }));
}, HALVES);

async function play(shoot) {
  const { page, state, close } = await openPlayer({
    url: URL, size: "1280x800", headless: flag("headless"),
    quiet: !flag("loud"),
  });
  const out = { placed: 0, mesh: false, published: false, clicks: 0,
                hit: -1, faults: 0, at: "" };
  try {
    await waitForLoad(page);
    if (await page.evaluate(() => globalThis.__hotd2Drive?.version ?? null)
        === null) {
      throw new Error("no drive seam -- is ?drive=1 wired up?");
    }
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press("Space");
    const canvas = await page.locator("canvas").first().boundingBox();
    const advance = (n) =>
      page.evaluate((k) => globalThis.__hotd2Drive.advance(k), n);
    for (let f = 0; f < BUDGET; f += 2) {
      await advance(2);
      out.at = await page.evaluate(() => globalThis.__hotd2Drive.now().a);
      const hs = await halves(page);
      if (!hs.length) continue;
      if (!shoot && flag("shot") && f === 200) {
        await page.screenshot({ path: join(SHOTS, "window_look.png") });
      }
      out.placed = Math.max(out.placed, hs.length);
      if (hs.some((h) => h.filed && (h.flags & 0x51) === 0x51 && h.blob
                         && h.m)) {
        out.mesh = true;
      }
      if (hs.some((h) => h.published)) out.published = true;
      if (out.hit < 0 && hs.some((h) => (h.flags & HIT) !== 0)) {
        out.hit = f;
        if (shoot && flag("shot")) {
          await page.screenshot({ path: join(SHOTS, "window_hit.png") });
        }
      }
      if (shoot && out.hit < 0 && f % CLICK_EVERY === 0 && canvas) {
        const ids = hs.map((h) => h.id);
        const t = (await page.evaluate(
          () => globalThis.__hotd2Drive.shotTargets?.() ?? []))
          .find((x) => ids.includes(x.prop) && Math.abs(x.x) <= 1
                && Math.abs(x.y) <= 1 && x.z >= -1 && x.z <= 1);
        if (t) {
          await pull(page, canvas.x + ((t.x + 1) / 2) * canvas.width,
                     canvas.y + ((1 - t.y) / 2) * canvas.height);
          out.clicks += 1;
        }
      }
      if (out.published && (shoot ? out.hit >= 0 : f >= 300)) break;
    }
    out.faults = state.faults;
  } finally {
    await close();
  }
  return out;
}

console.log(`\nstage 1, from ${URL}:\n`);
const shot = await play(true);
console.log(`  clicked:     ${JSON.stringify(shot)}`);
const quiet = await play(false);
console.log(`  not clicked: ${JSON.stringify(quiet)}\n`);

check("block 2 places both window halves, and they file themselves in the "
      + "shot-test list as mesh objects (0x51, a blob, the captured matrix)",
      shot.placed === 2 && shot.mesh);
check("...and they are in g_coli_dynamic_list, the moving-object passes' "
      + "list", shot.published && quiet.published);
check("a click on a half lands on its mesh: MarkActorShot's bit 3",
      shot.hit >= 0, `${shot.clicks} clicks, hit at ${shot.hit}`);
check("with no click neither half is ever hit", quiet.placed === 2
      && quiet.hit < 0, `${quiet.hit}`);
check("the page raised no fault in either run",
      shot.faults === 0 && quiet.faults === 0,
      `${shot.faults} and ${quiet.faults}`);
console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
