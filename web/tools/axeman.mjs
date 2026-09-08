/**
 * **Does the axe man retreat into the building?** He must not move at all.
 *
 * Stage 3 block 2 step 4 spawns the only two actors in the shipped game whose
 * record sets `obj+0x34` bit 1 — class 0x30, character type `0x13`
 * (`tutorial.bin`), body condition 7, initial state 33. That bit is moved to
 * `obj+0x38` bit `0x10` by `EnemyZombieInitByCharType` (`FUN_00452FD0`), and
 * it is the whole of `ZombieStateStandAndThrow`'s ending: with it set the
 * actor gives both enemy counters and its permit back where it stands and
 * waits to be despawned, instead of walking its descriptor's twenty-five units
 * backwards through the wall it is standing against.
 *
 * Reported as *"the axe throwing zombie retreats into the wall — in the real
 * game if there's nowhere for the axe thrower to retreat to, the game just
 * continues"*, at `?stage=3&mode=play&block=2&step=4&op=0`.
 *
 * This drives the real page there under `?drive=1` and measures, off a trace
 * row per driven frame: how far the actor ever gets from where the script put
 * it, whether it leaves state 33, when `g_enemies_alive` reaches zero, and
 * whether it despawns. The retreat covered 24.5 units and held the gate for a
 * hundred frames; standing still, the gate opens the frame the actor stops.
 *
 * Needs an exported bundle and Chrome, which is why it is a harness here
 * rather than a row in `tools/verify_all.py`; `web/test/port.test.ts` carries
 * the headless assertions and `tools/throwers.mjs` the sweep over all six
 * stages. `--shots` writes a frame per sample into `web/shots/`, which is how
 * the axe in flight was confirmed by eye.
 *
 *   node tools/axeman.mjs --headless
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { openPlayer, waitForLoad, SHOTS } from "./lib/player.mjs";

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d = null) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

/** The 1P axe man's script address — `st3evtbl.bin` `0x3078`. */
const AT = Number(opt("at", "12408"));
const TOTAL = Number(opt("frames", "700"));
const EVERY = Number(opt("every", "10"));
/** Class 0x30 state 33. */
const STAND_AND_THROW = 33;
/**
 * Two numbers, because the throw clips carry root motion.
 *
 * `tutorial.bin`'s wind up and step back about four units and return, so the
 * *peak* cannot be held near zero — `tools/throwers.mjs` measures the same
 * pair and reports "net 0.04u (clip swing 4.21u)". `SWING` is above that and
 * far below the retreat's twenty-five; `NET` is where the actor is standing
 * when it despawns.
 */
const SWING = 8.0;
const NET = 1.0;

let failures = 0;
const check = (what, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}${detail ? `  ${detail}` : ""}`);
};

const { page, close } = await openPlayer({
  url: "?stage=3&mode=play&block=2&step=4&op=0&drive=1",
  size: opt("size", "1280x800"),
  headless: flag("headless"),
  quiet: true,
});

if (flag("shots")) mkdirSync(SHOTS, { recursive: true });

try {
  await waitForLoad(page);
  // Selecting play mode in the URL does not start the clock. Blur first, or
  // Space goes to whatever the load left focused.
  await page.keyboard.press("Space");
  await page.evaluate(() => document.activeElement?.blur?.());

  let start = null;
  let last = null;
  let drift = 0;
  let leftState = null;
  let goneAt = null;
  let clearedAt = null;
  const seen = [];

  for (let f = EVERY; f <= TOTAL; f += EVERY) {
    await page.evaluate((n) => window.__hotd2Drive.advance(n), EVERY);
    const now = await page.evaluate(() => window.__hotd2Drive.now());
    const row = now.o.find((o) => Number(o.split(" ")[0]) === AT);
    const alive = Number(/\be(-?\d+)/.exec(now.c)?.[1] ?? -1);
    if (clearedAt === null && start !== null && alive === 0) clearedAt = f;
    if (row) {
      const g = /s(\d+)\.(\d+) h\d+ @(-?\d+),(-?\d+),(-?\d+)/.exec(row);
      const [state, , x, , z] = g.slice(1).map(Number);
      const pos = { x: x / 4096, z: z / 4096 };
      if (start === null) start = pos;
      last = pos;
      drift = Math.max(drift, Math.hypot(pos.x - start.x, pos.z - start.z));
      if (state !== STAND_AND_THROW && leftState === null) leftState = state;
    } else if (start !== null && goneAt === null) {
      goneAt = f;
    }
    seen.push({ f, a: now.a, alive, row: row ?? "(gone)" });
    if (flag("shots")) {
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
      await page.screenshot({
        path: resolve(SHOTS, `axeman-f${String(f).padStart(4, "0")}.png`),
      });
    }
  }

  for (const s of seen) {
    console.log(`  f${String(s.f).padStart(4)} ${s.a} alive ${s.alive}  ${s.row}`);
  }
  console.log();
  check("the axe man is placed at all", start !== null,
        start ? JSON.stringify(start) : "never appeared");
  check("...and never goes further than its own throw clip swings it",
        drift < SWING, `${drift.toFixed(2)}u peak`);
  check("...and is standing where the script put it when it goes",
        last !== null && start !== null
        && Math.hypot(last.x - start.x, last.z - start.z) < NET,
        last ? `${Math.hypot(last.x - start.x, last.z - start.z).toFixed(2)}u net`
             : "never seen");
  check("...staying in state 33 to the end", leftState === null,
        leftState === null ? "" : `left for state ${leftState}`);
  check("...it despawns where it stood", goneAt !== null, `f${goneAt}`);
  check("...and the enemy gate opens while it is still standing there",
        clearedAt !== null && goneAt !== null && clearedAt < goneAt,
        `cleared f${clearedAt}, gone f${goneAt}`);
} finally {
  await close();
}

console.log(failures ? `\n${failures} failed` : "\nclean");
process.exit(failures ? 1 : 0);
