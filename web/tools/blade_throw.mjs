/**
 * **Do the condition-8 blade walkers stop and throw?**
 *
 * `ZombieShouldStandAndThrow` (`FUN_00458E10`) lets a class-0x30 walker in
 * body condition 8 stop in `ZombieStateAttackRun`'s far bands and throw, when
 * the camera block's yaw turned half round -- `(g_camera_block_yaw_bams -
 * 0x8000) & 0xFFFF`, read at `0x00458E48` -- is within `0x400` of the actor's
 * own `obj+0x68`. Stage 4 has ten such `znassb` (character type 1) and stage 5
 * one; stage 2's two and stage 3's one are axe walkers (0x14, 0x13).
 *
 * The port used to read `g_camera_yaw_bams` (`0x009C71F0`) there, which the
 * scene-state hooks write as the path's yaw *plus* `0x8000` -- the camera
 * block's heading turned half round -- so its window sat half a turn from the
 * exe's and no condition-8 walker that was facing the camera ever threw.
 *
 * This drives the real page under `?drive=1` from the script address that
 * spawns the walker, and reports per sample: the walker's state, its yaw, the
 * exe's facing error (from the block yaw) and the port's old one (from
 * `g_camera_yaw_bams`), and every weapon a condition-8 walker has thrown.
 *
 *   node tools/blade_throw.mjs --headless --stage 4 --block 0 --step 5 --op 5 --at 3740
 */
import { openPlayer, waitForLoad } from "./lib/player.mjs";

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d = null) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

const STAGE = Number(opt("stage", "4"));
const AT = Number(opt("at", "3740"));
const TOTAL = Number(opt("frames", "1500"));
const EVERY = Number(opt("every", "10"));
const url = `?stage=${STAGE}&mode=play&block=${opt("block", "0")}`
  + `&step=${opt("step", "5")}&op=${opt("op", "5")}&drive=1`;

const { page, close, state } = await openPlayer({
  url, size: opt("size", "1280x800"), headless: flag("headless"), quiet: true,
});

let failures = 0;
const check = (what, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}${detail ? `  ${detail}` : ""}`);
};

try {
  await waitForLoad(page);
  await page.keyboard.press("Space");
  await page.evaluate(() => document.activeElement?.blur?.());

  let seen = false;
  let minExe = Infinity;
  let minOld = Infinity;
  const throwsByAt = new Map();
  let stood = 0;
  for (let f = EVERY; f <= TOTAL; f += EVERY) {
    await page.evaluate((n) => window.__hotd2Drive.advance(n), EVERY);
    const s = await page.evaluate(async (at) => {
      const { G } = await import("/src/game/globals.ts");
      const d = (a, b) => {
        let x = (a - b) & 0xffff;
        if (x > 0x8000) x -= 0x10000;
        return x;
      };
      const o = G.g_object_list.find((x) => x.at === at && !x.despawned);
      const cond8 = G.g_object_list.filter((x) => x.cls === 0x30
                                           && x.condition === 8);
      return {
        a: window.__hotd2Drive.now().a,
        block: G.g_camera_block_yaw_bams,
        old: G.g_camera_yaw_bams,
        o: o ? {
          state: o.state, sub: o.sub, yaw: o.yaw & 0xffff,
          cond: o.condition,
          exe: d((G.g_camera_block_yaw_bams - 0x8000) & 0xffff, o.yaw),
          old: d((G.g_camera_yaw_bams - 0x8000) & 0xffff, o.yaw),
          pos: [o.pos.x, o.pos.y, o.pos.z].map((v) => v.toFixed(1)).join(","),
        } : null,
        thrown: G.g_thrown_weapons.map((w) => w.from),
        cond8: cond8.map((x) => x.at),
        permits: [...G.g_attack_permits],
      };
    }, AT);
    if (s.o) {
      seen = true;
      if (s.o.state === 1) {
        minExe = Math.min(minExe, Math.abs(s.o.exe));
        minOld = Math.min(minOld, Math.abs(s.o.old));
      }
      if (s.o.state === 33) stood += 1;
    }
    for (const from of s.thrown) {
      throwsByAt.set(from, (throwsByAt.get(from) ?? 0) + 1);
    }
    if (f % 50 === 0 || (s.o && s.o.state === 33)) {
      console.log(`  f${String(f).padStart(5)} ${s.a} block ${s.block} `
        + `g_camera_yaw ${s.old} ${s.o ? `st ${s.o.state}/${s.o.sub} yaw ${s.o.yaw} `
          + `exeErr ${s.o.exe} oldErr ${s.o.old} @${s.o.pos}` : "(absent)"} `
        + `thrown [${s.thrown.join(",")}] permits ${s.permits}`);
    }
  }
  console.log();
  check(`${AT} is placed`, seen);
  console.log(`  closest facing error in AttackRun: exe ${minExe}, old ${minOld}`);
  check(`${AT} stood to throw (state 33) at least once`, stood > 0,
        `${stood} samples`);
  console.log(`  thrown-weapon samples by owner: `
    + JSON.stringify([...throwsByAt.entries()]));
  if (state.faults) console.log(`  page faults: ${state.faults}`);
} finally {
  await close();
}
console.log(failures ? `\n${failures} failed` : "\nclean");
process.exit(failures ? 1 : 0);
