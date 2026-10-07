/**
 * In the real page: **stage 5's class-0x33 selector-7 object outlives its
 * block, and a seek rebuilds it where play would have it.**
 *
 *     HOTD2_BUNDLE=... node tools/sound_cues_page.mjs --headless
 *
 * Stage 5 block 2 step 2 op 36 places evt `0x1E7C`, `ScriptedSoundCues33`
 * (`FUN_00433E90`): `CAR_SRIP_22` on camera frames 505, 760 and 820 and
 * `BRAKE_22` on 990. Its own despawn never runs, and no other routine removes
 * a task (`class33/cues.ts`), so it stands until the scene ends and plays a
 * record whenever any path publishes its frame -- path 207 runs on into block
 * 3, where 990 comes.
 *
 * Two runs. One **plays** from block 2 (the room's enemies put down every
 * second, so the script moves on) to block 3 step 1 and reads the object's
 * cursor there; the other **seeks** straight to block 3 step 1. The verdict:
 * the same cursor in both -- three records played, the brake still to come
 * -- and, in the seek, the brake played on 990.
 */
import {
  openPlayer, requireBundle, waitForLoad,
} from "./lib/player.mjs";

requireBundle("sound_cues_page");
const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const AT = 0x1e7c;

let failures = 0;
const check = (what, ok, note = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}${note ? ` -- ${note}` : ""}`);
  if (!ok) failures += 1;
};

/** The object's cursor, the address, and the camera. */
const read = (page) => page.evaluate(async (at) => {
  const { G } = await import("/src/game/globals.ts");
  const o = G.g_object_list.find((a) => a.at === at && !a.despawned);
  return { a: globalThis.__hotd2Drive.now().a, frame: G.g_cam_path_frame,
           cue: o ? o.scenery.cue : -1 };
}, AT);

/** Every class-0x30/0x31 actor put down, so a room gate lets the script on. */
const clearRoom = (page) => page.evaluate(async () => {
  const { G } = await import("/src/game/globals.ts");
  for (const a of G.g_object_list) {
    if ((a.cls === 0x30 || a.cls === 0x31) && !a.dead) {
      a.hp = 0; a.dead = true;
    }
  }
});

async function run(url, until, frames) {
  const { page, state, close } = await openPlayer({
    url, size: "1280x800", headless: flag("headless"), quiet: !flag("loud"),
  });
  try {
    await waitForLoad(page);
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press("Space");
    let first = null;
    for (let f = 0; f < frames; f += 2) {
      await page.evaluate((k) => globalThis.__hotd2Drive.advance(k), 2);
      if (f % 60 === 0) await clearRoom(page);
      const s = await read(page);
      if (!first && s.cue >= 0) first = s;
      if (until(s)) return { at: s, first, faults: state.faults };
    }
    return { at: await read(page), first, faults: state.faults };
  } finally {
    await close();
  }
}

const atBlock3 = (s) => s.a.startsWith("3/1/");
const played = await run("?stage=5&block=2&step=1&op=0&drive=1&seed=1",
                         atBlock3, 4000);
console.log(`  played: ${JSON.stringify(played)}`);
const seek = await run("?stage=5&block=3&step=1&op=0&drive=1&seed=1",
                       (s) => s.frame > 1000, 400);
console.log(`  seek:   ${JSON.stringify(seek)}\n`);

check("played from block 2, the object reaches block 3 with three records "
      + "played -- 505, 760 and 820 on path 207 -- and the brake to come",
      atBlock3(played.at) && played.at.cue === 3, JSON.stringify(played.at));
check("a seek to block 3 rebuilds it on the same record",
      seek.first?.cue === 3, JSON.stringify(seek.first));
check("...and plays on from there: the brake on 990",
      seek.at.cue === 4, JSON.stringify(seek.at));
check("the page raised no fault in either run",
      played.faults === 0 && seek.faults === 0,
      `${played.faults} and ${seek.faults}`);
console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
