/**
 * NEW-BUGS 19 in the real page: **a bat that reaches the screen costs a life.**
 *
 * Opens a block that places bats under `?drive=1`, plays without firing, and
 * reads the score off the drive seam's trace row per frame. A strike is
 * `PlayerTakeDamage` (`FUN_00415300`), which charges 100 points; a bat kill
 * pays 80 and nothing else here moves the score -- so a fall of exactly 100 is
 * a signal only a strike can produce (`L47`: the counters cannot tell an
 * arrival from a kill). Screenshots before the flight and after the first
 * strike go to `web/shots/`, for the lives on the HUD.
 *
 *   node tools/bats_page.mjs --headless
 *   node tools/bats_page.mjs --headless --url '?stage=4&block=7&step=3&op=0'
 */
import { join } from "node:path";
import { openPlayer, waitForLoad, SHOTS } from "./lib/player.mjs";

const args = process.argv.slice(2);
const opt = (n, d = null) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const flag = (n) => args.includes(`--${n}`);
const where = opt("url", "?stage=4&block=0&step=6&op=0");
const tag = opt("out", "bats");
const BUDGET = Number(opt("budget", "1500"));

const { page, close } = await openPlayer({
  url: `${where}&drive=1&seed=${opt("seed", "1")}`,
  size: "1280x800", headless: flag("headless"), quiet: !flag("loud"),
});

let failed = false;
try {
  await waitForLoad(page);
  if (await page.evaluate(() => globalThis.__hotd2Drive?.version ?? null)
      === null) {
    throw new Error("no drive seam — is ?drive=1 wired up?");
  }
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press("Space");
  const advance = (n) =>
    page.evaluate((k) => globalThis.__hotd2Drive.advance(k), n);
  const drain = () => page.evaluate(() => globalThis.__hotd2Drive.drain());
  await page.evaluate(() => globalThis.__hotd2Drive.trace(true));

  const score = (t) => Number(/ s(-?\d+)/.exec(t.c)?.[1] ?? NaN);
  const bats = (t) => (t.o ?? []).filter((s) => / c70 /.test(s)).length;
  let first = null, prev = null, peak = 0, strikes = 0, shotAt = -1;
  let before = false, over = false;
  for (let done = 0; done < BUDGET; done += 10) {
    await advance(10);
    for (const t of await drain()) {
      const s = score(t);
      const n = bats(t);
      peak = Math.max(peak, n);
      if (first === null) first = s;
      if (n > 0 && !before) {
        before = true;
        await page.screenshot({ path: join(SHOTS, `${tag}-before.png`) });
      }
      // The flight is over once every bat has gone; a strike after that is
      // somebody else's (a zombie in the next room took one in the unfixed
      // page, and read as a pass).
      if (before && n === 0) over = true;
      if (!over && prev !== null && s - prev === -100) {
        strikes += 1;
        console.log(`f${t.f} ${t.a}  score ${prev} -> ${s}  bats ${n}  ${t.c}`);
        if (shotAt < 0) shotAt = t.f;
      }
      prev = s;
    }
    if (over || (shotAt >= 0 && done > shotAt + 30)) break;
  }
  if (shotAt >= 0) {
    await page.screenshot({ path: join(SHOTS, `${tag}-after.png`) });
  }
  console.log(`\n${where}: bats seen ${peak}, strikes ${strikes}, `
    + `score ${first} -> ${prev}`);
  failed = strikes === 0;
  console.log(failed ? "FAIL  no bat took a life"
                     : "ok    a bat that reached the screen took a life");
} finally {
  await close();
}
process.exit(failed ? 1 : 0);
