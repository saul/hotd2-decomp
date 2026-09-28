/**
 * The boss-name banner's cards, shot at chosen frames of its flight.
 *
 * `BossIntroBannerUpdate` (`FUN_00437AC0`) draws eight cards in the camera's
 * space, and in its step 2 it calls `CurlModelSlot7EEByYaw` (`FUN_004759C0`)
 * with each card's yaw just before drawing it, which bends the card back
 * (slot `0x7EE`) like a page being turned. This drives stage 1's boss
 * entrance -- class 0x22 raises `g_script_flags[2]` at camera frame 830 of
 * block 14 and the banner seats on it -- and writes one screenshot of the
 * canvas at each banner frame asked for, with the cards' yaws beside it.
 *
 *   HOTD2_BUNDLE=<bundle> node tools/banner_look.mjs --headless --tag after
 *   node tools/banner_look.mjs --headless --frames 30,40,50 --tag before
 *
 * `--url` must land **before** the boss's spawn at block 14 step 1:
 * `block=14&step=0` lands on 14/3/0, past it, and no banner ever comes.
 *
 * Screenshots: `web/shots/banner-<tag>-f<frame>.png`. Driven (`?drive=1`) on
 * a fixed seed, so two runs of two trees reach the same frames with the same
 * world, and the pictures differ by what the trees draw differently.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openPlayer, waitForLoad, SHOTS, requireBundle } from "./lib/player.mjs";

const args = process.argv.slice(2);
const opt = (n, d = null) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const flag = (n) => args.includes(`--${n}`);
const where = opt("url", "?stage=1&mode=play&entry=0&block=14&step=1&op=0");
const tag = opt("tag", "now");
const BUDGET = Number(opt("budget", "2400"));
/**
 * Banner frames (`+0x04`) to shoot at. The flips start at 15 and the turning
 * step ends at 0x4F with pages 1..5 still part-way over; 82 is the hold.
 */
const AT = opt("frames", "30,40,50,60,70,79,82").split(",").map(Number);

requireBundle("the boss banner");
mkdirSync(SHOTS, { recursive: true });

const { page, state, close } = await openPlayer({
  url: `${where}&drive=1&seed=${opt("seed", "1")}`,
  size: opt("size", "1280x960"), headless: flag("headless"),
  quiet: !flag("loud"), debug: false,
});
const drive = (n) => page.evaluate((k) => globalThis.__hotd2Drive.advance(k), n);
const banner = () => page.evaluate(async () => {
  const { G } = await import("/src/game/globals.ts");
  const b = G.g_boss_banners[0];
  return b ? { step: b.step, frame: b.frame, slots: [...b.slots],
               yaws: b.cards.map((c) => c.yaw) } : null;
});

let failed = false;
try {
  await waitForLoad(page);
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press("Space");
  const box = await page.evaluate(() => {
    const r = document.querySelector("#viewport canvas").getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y),
             width: Math.floor(r.width), height: Math.floor(r.height) };
  });
  // Print the state, never the request (L44): each shot names the frame the
  // banner is actually on.
  let b = await banner();
  let spent = 0;
  for (; spent < BUDGET && !(b && b.step === 2); spent += 1) {
    await drive(1);
    b = await banner();
  }
  if (!b || b.step !== 2) {
    const at = await page.evaluate(async () => {
      const { G } = await import("/src/game/globals.ts");
      return { a: globalThis.__hotd2Drive.now().a, cam: G.g_cam_path_frame,
               flag2: G.g_script_flags[2],
               cls: G.g_object_list.map((o) => o.cls.toString(16)).join(" ") };
    });
    throw new Error(`no banner in its flight after ${spent} frames `
                    + `(${JSON.stringify(b)}; ${JSON.stringify(at)})`);
  }
  console.log(`banner seated after ${spent} driven frames; slots `
              + b.slots.map((s) => s.toString(16)).join(" "));
  for (const f of AT) {
    b = await banner();
    // The banner steps its counter at the bottom of its update, so the frame
    // the picture shows is the one before the counter now reads.
    if (b.frame <= f) await drive(f - b.frame + 1);
    b = await banner();
    const png = await page.screenshot({ clip: box });
    const out = join(SHOTS, `banner-${tag}-f${b.frame - 1}.png`);
    writeFileSync(out, png);
    console.log(`${out}  step ${b.step}  yaws `
                + b.yaws.map((y) => (y / 0x10000 * 360).toFixed(0)).join(" "));
  }
  if (state.faults) {
    console.log(`FAIL  ${state.faults} page fault(s)`);
    failed = true;
  }
} catch (e) {
  console.log(`FAIL  ${e.message}`);
  failed = true;
} finally {
  await close();
}
process.exit(failed ? 1 : 0);
