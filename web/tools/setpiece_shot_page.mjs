/**
 * A body lying on the floor cannot be shot, in the real page.
 *
 * `?stage=1&block=1&step=3&op=9&frame=61` shows a man lying under a library
 * desk with rats on him: `0x1548`, class 0x24, character type 51
 * (`hito_marioaa`). Class 0x24 calls `RegisterForShotTest` nowhere, so in the
 * exe no bullet ever touches it. The port offered it to the render pick, and a
 * hit gave the body a death clip -- it fell over again. See
 * `game/class24/index.ts`'s handler.
 *
 * This sweeps the whole frame, one pull a frame (L50) from the landing, and
 * reads the body back out of the page's own `G` after each (L44): it must
 * stay alive, with no death clip and its hit points and bit `0x4000000` as
 * they were. A sweep is only evidence if its pulls were live and could have
 * reached the body, so it also requires that they killed the room's zombie
 * (`0x16D8`, holding `1/3/21`), that the walker went on into step 4, and that
 * the body stayed placed and drawn throughout. Driven on one seed, the sweep
 * is the same run every time, and it is the run in which, before the fix, a
 * pull low on the right of the frame (column 16, row 13, at `1/4/9` f293)
 * found the body and gave it death clip 986.
 *
 *   node tools/setpiece_shot_page.mjs --headless
 */
import { join } from "node:path";
import { openPlayer, pull, requireBundle, waitForLoad, SHOTS }
  from "./lib/player.mjs";

requireBundle("setpiece_shot_page");

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const ADDRESS = "stage=1&block=1&step=3&op=9&frame=61";
/** The body: class 0x24, `hito_marioaa`, placed at `1/2/19`. */
const BODY = 0x1548;
/** The zombie the room waits on, `1/3/14`'s spawn. */
const ZOMBIE = 0x16d8;
/** The sweep: a 24 x 16 lattice of the viewport, rows top to bottom. */
const NX = 24;
const NY = 16;

const { page, close } = await openPlayer({
  url: `?${ADDRESS}&drive=1&seed=1`,
  size: "1280x800", headless: flag("headless"), quiet: !flag("loud"),
});

const failures = [];
const check = (ok, what, detail = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures.push(what);
};
const advance = (n) =>
  page.evaluate((k) => globalThis.__hotd2Drive.advance(k), n);
const zombieDead = () => page.evaluate(async (at) => {
  const { G } = await import("/src/game/globals.ts");
  const o = G.g_object_list.find((x) => x.at === at);
  return !o || o.dead || o.despawned;
}, ZOMBIE);
const body = () => page.evaluate(async (at) => {
  const { G } = await import("/src/game/globals.ts");
  const o = G.g_object_list.find((x) => x.at === at);
  const now = globalThis.__hotd2Drive.now();
  if (!o) return { address: now.a, frame: now.f, absent: true };
  return {
    address: now.a, frame: now.f, cls: o.cls, name: o.name,
    dead: o.dead, death: o.death, hp: o.hp, visible: o.visible,
    killedBit: (o.flags & 0x4000000) !== 0,
  };
}, BODY);

let code = 1;
try {
  await waitForLoad(page);
  if (await page.evaluate(() => globalThis.__hotd2Drive?.version ?? null)
      === null) {
    throw new Error("no drive seam -- is ?drive=1 wired up?");
  }
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press("Space");
  await advance(1);
  const first = await body();
  console.log(`\n?${ADDRESS}, landed at ${first.address} f${first.frame}`);
  check(!first.absent && first.cls === 0x24 && first.visible,
        "the body is placed and drawn: class 0x24, hito_marioaa",
        first.absent ? "absent" : `cls 0x${first.cls.toString(16)} `
          + `${first.name} visible ${first.visible}`);
  await page.screenshot({ path: join(SHOTS, "setpiece-shot-before.png") });

  const box = await page.locator("#viewport").boundingBox();
  let pulls = 0;
  let hurt = null;
  let unseen = 0;
  let steppedOn = false;
  for (let gy = 1; gy < NY && !hurt; gy++) {
    for (let gx = 1; gx < NX && !hurt; gx++) {
      await pull(page, box.x + box.width * gx / NX,
                 box.y + box.height * gy / NY);
      pulls += 1;
      await advance(1);
      const s = await body();
      if (s.absent || !s.visible) unseen += 1;
      if (s.address.startsWith("1/4/")) steppedOn = true;
      if (s.dead || s.death || s.hp !== first.hp || s.killedBit) {
        hurt = { ...s, gx, gy };
      }
    }
  }
  const last = await body();
  await page.screenshot({ path: join(SHOTS, "setpiece-shot-after.png") });
  check(await zombieDead(), "the pulls were live: they killed the room's zombie");
  check(steppedOn, "...and the walker went on into step 4, the camera past "
        + "the body");
  check(unseen === 0, `the body stayed placed and drawn for all ${pulls} pulls`,
        `${unseen} frames without it`);
  check(hurt === null,
        "no pull touched it: alive, no death clip, hit points and bit "
        + "0x4000000 as they were",
        hurt ? `column ${hurt.gx} row ${hurt.gy} at ${hurt.address} `
          + `f${hurt.frame}: dead ${hurt.dead} death `
          + `${JSON.stringify(hurt.death)} hp ${hurt.hp}`
          : `${pulls} pulls, ending at ${last.address} f${last.frame}`);
  code = failures.length ? 1 : 0;
  console.log(failures.length ? `\n${failures.length} failed` : "\nall passed");
} finally {
  await close();
}
process.exit(code);
