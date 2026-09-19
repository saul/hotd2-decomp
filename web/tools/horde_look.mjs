/**
 * The horde in the running player: come up, attack, be shot, clear the room.
 *
 *     node tools/horde_look.mjs --headless [--stage 1 --block 3 --step 3]
 *
 * `tools/horde.mjs` is the headless port; this is the page, under `?drive=1`,
 * with the real shot path -- pointer events on `#viewport`, the pick, the
 * sphere. It advances the game until a member has dived, screenshots the
 * frames that say something (members up, a dive), then fires volleys across
 * the frame until the room's counters are down and the walker has moved on.
 * It prints the score so a kill is told apart from a member that merely left
 * (`L47`).
 *
 * Screenshots go to `web/shots/horde-*.png`.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { openPlayer, waitForLoad, SHOTS } from "./lib/player.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const stage = opt("stage", "1");
const block = opt("block", "3");
const step = opt("step", "3");
const tag = `horde-s${stage}b${block}`;
const url = `?stage=${stage}&mode=play&block=${block}&step=${step}&drive=1`;

mkdirSync(SHOTS, { recursive: true });
const { page, state, close } = await openPlayer({
  url, size: opt("size", "1280x800"), headless: args.includes("--headless"),
  quiet: true,
});
await waitForLoad(page);
await page.keyboard.press("Space");                   // play
const advance = (n) =>
  page.evaluate((k) => globalThis.__hotd2Drive.advance(k), n);
const now = () => page.evaluate(() => globalThis.__hotd2Drive.now());
const shot = async (name) => {
  const p = join(SHOTS, `${tag}-${name}.png`);
  await page.screenshot({ path: p });
  console.log(`  shot ${p}`);
};
/** Class-0x40 members: runtime children at 0x10000000 | idx << 20 | at. */
const members = (row) => row.o.filter((l) => {
  const at = Number(l.split(" ")[0]);
  return l.includes(" c64 ") && at >= 0x10000000 && at < 0x18000000;
});

const start = await now();
console.log(`${url}: at ${start.a}, ${start.c}`);
let upShot = false;
let diveShot = false;
let firstUp = -1;
for (let f = 0; f < 60 * 40; f += 10) {
  await advance(10);
  const row = await now();
  const ms = members(row);
  if (ms.length && firstUp < 0) {
    firstUp = row.f;
    console.log(`  frame ${row.f}: ${ms.length} members placed, ${row.c}`);
  }
  if (!upShot && firstUp >= 0 && row.f - firstUp > 150) {
    await shot("up");
    upShot = true;
  }
  const lives = await page.evaluate(() => document.body.innerText);
  void lives;
  if (upShot && !diveShot && /e[1-9]/.test(row.c) && row.f - firstUp > 400) {
    await shot("later");
    diveShot = true;
    break;
  }
}
const before = await now();
console.log(`  before shooting: ${before.a} ${before.c}`);
const box = await page.locator("#viewport").boundingBox();
let row = before;
for (let v = 0; v < 120; v += 1) {
  for (let r = 0; r < 6; r += 1) {
    for (let c = 0; c < 8; c += 1) {
      await page.mouse.click(box.x + (box.width * (c + 0.5)) / 8,
                             box.y + (box.height * (r + 0.5)) / 6);
    }
  }
  await advance(20);
  row = await now();
  if (/^e0 p0/.test(row.c) && row.a !== before.a) break;
}
await shot("after");
console.log(`  after shooting: ${row.a} ${row.c}; members left `
  + `${members(row).length}; page faults ${state.faults}`);
await close();
