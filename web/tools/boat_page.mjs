/**
 * In the real page: **stage 2's boat (class 0x33 selector 1, the carrier) is
 * shot through its own mesh.**
 *
 *     HOTD2_BUNDLE=... node tools/boat_page.mjs --headless [--shot]
 *
 * Stage 2, block 9 step 6 op 0 places evt `0x4FD0` -- the carrier whose tail
 * names `coli2.bin:31784`, so `ScriptedCarrierStepPath33` (`FUN_00433860`)
 * raises `0x50` and `ScriptedCarrierUpdate33` (`FUN_004331D0`) stores its
 * draw's matrix at `obj+0x150` and `RegisterForShotTest`s at `0x004334D0`.
 * Before `class33/index.ts` filed it, nothing did, and a shot passed through
 * the boat.
 *
 * Two loads of the same address on the same seed. One **clicks** where the
 * page's own `shotTargets` puts the boat (the middle of its blob through
 * `obj+0x150`) until it is hit; the other clicks nothing. The verdict is what
 * only a shot on the boat writes: `obj+0x34` bit 3, which `MarkActorShot`
 * raises and no class-0x33 routine clears (`L47`) -- and the boat still
 * riding, because a hit marks it and nothing else.
 *
 * `--shot` writes `shots/boat_hit.png`, the frame of the click that hit.
 */
import { join } from "node:path";
import {
  openPlayer, pull, requireBundle, SHOTS, waitForLoad,
} from "./lib/player.mjs";

requireBundle("boat_page");
const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const AT = 0x4fd0;
const URL = "?stage=2&block=9&step=6&op=1&drive=1&seed=1";
const BUDGET = 900;
const CLICK_EVERY = 6;
/** `obj+0x34` bit 3, `MarkActorShot`'s hit bit. */
const HIT = 0x8;

let failures = 0;
const check = (what, ok, note = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}${note ? ` -- ${note}` : ""}`);
  if (!ok) failures += 1;
};

/** The boat as the page's pool holds it, and the list it is filed in. */
const boat = (page) => page.evaluate(async (at) => {
  const { G } = await import("/src/game/globals.ts");
  const o = G.g_object_list.find((a) => a.at === at && !a.despawned);
  if (!o) return null;
  return {
    flags: o.flags >>> 0, blob: o.coliBlob, m: !!o.coliMatrix,
    filed: G.g_shot_test_list.some((e) => e.at === at),
  };
}, AT);

async function play(shoot) {
  const { page, state, close } = await openPlayer({
    url: URL, size: "1280x800", headless: flag("headless"),
    quiet: !flag("loud"),
  });
  const out = { placed: false, mesh: false, clicks: 0, hit: -1,
                riding: false, faults: 0, at: "" };
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
      const b = await boat(page);
      if (!b) continue;
      out.placed = true;
      if (b.filed && ((b.flags & 0x80000050) >>> 0) === 0x80000050 && b.blob && b.m) {
        out.mesh = true;
      }
      if (out.hit < 0 && (b.flags & HIT) !== 0) {
        out.hit = f;
        if (shoot && flag("shot")) {
          await page.screenshot({ path: join(SHOTS, "boat_hit.png") });
        }
      }
      if (out.hit >= 0) out.riding = true;
      if (shoot && out.hit < 0 && f % CLICK_EVERY === 0 && canvas) {
        const t = (await page.evaluate(
          () => globalThis.__hotd2Drive.shotTargets?.() ?? []))
          .find((x) => x.at === AT && Math.abs(x.x) <= 1
                && Math.abs(x.y) <= 1 && x.z >= -1 && x.z <= 1);
        if (t) {
          await pull(page, canvas.x + ((t.x + 1) / 2) * canvas.width,
                     canvas.y + ((1 - t.y) / 2) * canvas.height);
          out.clicks += 1;
        }
      }
      if (shoot ? out.hit >= 0 && f > out.hit + 20 : f >= 300) break;
    }
    out.faults = state.faults;
  } finally {
    await close();
  }
  return out;
}

console.log(`\nstage 2, from ${URL}:\n`);
const shot = await play(true);
console.log(`  clicked:     ${JSON.stringify(shot)}`);
const quiet = await play(false);
console.log(`  not clicked: ${JSON.stringify(quiet)}\n`);

check("block 9 places the boat, and it files itself in the shot-test list as "
      + "a mesh object (0x80000050, its blob, its matrix)",
      shot.placed && shot.mesh);
check("a click on the boat lands on its mesh: MarkActorShot's bit 3, and the "
      + "boat rides on", shot.hit >= 0 && shot.riding,
      `${shot.clicks} clicks, hit at ${shot.hit}`);
check("with no click it is never hit", quiet.placed && quiet.hit < 0,
      `${quiet.hit}`);
check("the page raised no fault in either run",
      shot.faults === 0 && quiet.faults === 0,
      `${shot.faults} and ${quiet.faults}`);
console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
