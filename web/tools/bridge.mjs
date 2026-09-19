/**
 * Stage 3 block 3 step 6 -- the two drum-throwers on the bridge -- driven
 * frame by frame in a real browser, with a screenshot at the frames named.
 *
 *   node tools/bridge.mjs --headless [--every 30] [--frames 600] [--shots 200,330]
 *
 * Prints the drive harness's row (walker address, permits, actors, and the
 * carried props as `routine:hp:viewZ`) and writes `shots/bridge_<f>.png`.
 */
import { resolve } from "node:path";
import { openPlayer, waitForLoad, SHOTS } from "./lib/player.mjs";

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const every = Number(opt("every", "30"));
const total = Number(opt("frames", "600"));
const shots = new Set(opt("shots", "").split(",").filter(Boolean).map(Number));
const url = opt("url", "?stage=3&mode=play&block=3&step=6&op=0&drive=1");

const { page, state, close } = await openPlayer({
  url, headless: args.includes("--headless"),
});
try {
  await waitForLoad(page);
  // A stage sits at its entry until something presses play.
  await page.keyboard.press("Space");
  let f = 0;
  while (f < total) {
    const n = Math.min(every, total - f);
    f = await page.evaluate((k) => globalThis.__hotd2Drive.advance(k), n);
    const row = await page.evaluate(() => globalThis.__hotd2Drive.now());
    const pat = new RegExp(opt("classes", " c(48|16) "));
    const actors = row.o.filter((o) => pat.test(` ${o} `)).join(" | ");
    console.log(`f${row.f} ${row.a} ${row.c} :: ${actors}`);
    for (const s of shots) {
      if (s > f - n && s <= f) {
        await page.screenshot({ path: resolve(SHOTS, `${opt("out", "bridge")}_${f}.png`) });
      }
    }
  }
} finally {
  await close();
}
process.exit(state.faults ? 1 : 0);
