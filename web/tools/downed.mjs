/**
 * **Does a body on the ground take bullets?** It must not.
 *
 * `DispatchHit` (`FUN_004092F0`) is the only caller of `ResolveHit`
 * (`FUN_00409430`) in the image, and it skips the call outright while
 * `obj+0x34` bit `0x100` is up. So every window a class marks itself
 * shot-immune in — a thrower lying on the ground or getting up, a zombie under
 * the water, one frozen on a camera cue — is a window in which no damage is
 * charged at all.
 *
 * The port charged it, and the window is exactly the one in which nothing is
 * listening for a kill: `ThrowerOnShot` (`FUN_004499A0`) returns on the same
 * bit. Reported against **stage 2, block 14, step 8, op 2** — the `zsass` at
 * descriptor `0x8094` — as *"doesn't seem to die. shoot him enough, he makes a
 * dead sound, but then he keeps on [the] player."*
 *
 * This drives the real page at that spot under `?drive=1` and measures two
 * things off a trace row per driven frame: hit points that fell while the
 * actor was in one of the immune states, and frames it spent **dead** in a
 * state that is not one of class 0x31's four death states. Both must be zero,
 * and it must leave the pool.
 *
 * Needs an exported bundle and Chrome, which is why it is a harness here
 * rather than a row in `tools/verify_all.py`. `web/test/port.test.ts` carries
 * the headless assertion.
 *
 *   node tools/downed.mjs --headless
 */
import { openPlayer, waitForLoad } from "./lib/player.mjs";

const args = process.argv.slice(2);
const opt = (n, d = null) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const flag = (n) => args.includes(`--${n}`);
const AT = Number(opt("at", "32916"));
const BUDGET = Number(opt("budget", "4000"));
/** Game frames between volleys. */
const EVERY = Number(opt("every", "4"));

/** `ThrowerState` 2, 3, 4, 5 — fall, death clip, corpse, blinking corpse. */
const DYING = new Set([2, 3, 4, 5]);
/**
 * The window `obj+0x34` bit 0x100 is up on a class-0x31 actor, as a state and
 * sub the trace can name: `ThrowerStateFallAndLand` sub 3 (lying still) and
 * sub 4 (the get-up), and `ThrowerStateGetUp` (17), which raises it itself.
 * `DispatchHit` (`FUN_004092F0`) refuses to resolve a hit anywhere in here, so
 * the hit points must not move.
 */
const isImmune = (a) => (a.state === 2 && (a.sub === 3 || a.sub === 4))
  || a.state === 17;

const { page, state, close } = await openPlayer({
  url: `?stage=2&block=14&step=8&op=0&drive=1&seed=${opt("seed", "1")}`,
  size: "1280x800", headless: flag("headless"), quiet: !flag("loud"),
});

try {
  await waitForLoad(page);
  if (await page.evaluate(() => globalThis.__hotd2Drive?.version ?? null)
      === null) {
    throw new Error("no drive seam — is ?drive=1 wired up?");
  }
  // The player's shortcuts skip an event while something typable has focus,
  // and a `<summary>` counts: Space would toggle the group shut instead of
  // starting playback. Blur first.
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press("Space");
  const box = await page.locator("#viewport").boundingBox();
  if (!box) throw new Error("#viewport has no box");

  const advance = (n) =>
    page.evaluate((k) => globalThis.__hotd2Drive.advance(k), n);
  const now = () => page.evaluate(() => globalThis.__hotd2Drive.now());
  // A row per driven frame, so nothing that happens between two volleys is
  // sampled over. `EVERY` is how often the trigger is pulled, not how often
  // the game is looked at.
  const drain = () => page.evaluate(() => globalThis.__hotd2Drive.drain());
  await page.evaluate(() => globalThis.__hotd2Drive.trace(true));

  let k = 0;
  const volley = async (n) => {
    for (let i = 0; i < n; i++) {
      const c = (k % 6) + 0.5, r = (Math.floor(k / 6) % 5) + 0.5;
      k++;
      await page.mouse.click(box.x + (box.width * c) / 6,
                             box.y + (box.height * r) / 5);
    }
  };

  const rowFor = (t) => (t.o ?? []).find((s) => s.startsWith(`${AT} `)) ?? null;
  const parse = (row) => {
    const m = /^\d+ c\d+ s(\d+)\.(\d+) h(-?\d+)/.exec(row);
    return m ? { state: +m[1], sub: +m[2], hp: +m[3],
                 dead: / dead/.test(row) } : null;
  };

  let seen = false, last = "", pulls = 0, firstDead = -1, gone = -1;
  let actedWhileDead = 0, worst = "";
  let immuneDamage = 0, immuneHits = 0, immuneWhere = "";
  let prev = null;
  const scan = (rows) => {
    for (const t of rows) {
      const row = rowFor(t);
      if (!row) {
        if (seen && gone < 0) {
          gone = t.f;
          console.log(`f${String(t.f).padStart(5)} ${t.a}  ${AT} GONE  ${t.c}`);
        }
        continue;
      }
      seen = true;
      const a = parse(row);
      if (!a) continue;
      if (a.dead) {
        if (firstDead < 0) firstDead = t.f;
        if (!DYING.has(a.state)) {
          actedWhileDead += 1;
          worst = `state ${a.state}/${a.sub} at f${t.f}`;
        }
      }
      // The hit points fell on a frame the actor was shot-immune on, which is
      // a round the engine never resolves.
      if (prev && isImmune(prev) && a.hp < prev.hp) {
        immuneDamage += prev.hp - a.hp;
        immuneHits += 1;
        immuneWhere = `f${t.f} state ${prev.state}/${prev.sub} `
                    + `${prev.hp} -> ${a.hp}`;
      }
      prev = a;
      const short = row.replace(/@[^ ]+ /, "");
      if (short !== last) {
        last = short;
        console.log(`f${String(t.f).padStart(5)} ${t.a}  ${row}  ${t.c}`);
      }
    }
  };

  for (;;) {
    const t = await now();
    if (rowFor(t)) seen = true;
    if (t.f > BUDGET) {
      console.log(`\nbudget: still here at ${t.a}`);
      break;
    }
    if (seen) { await volley(3); pulls += 3; }
    await advance(EVERY);
    scan(await drain());
    if (gone >= 0) break;
  }
  console.log(`\n${pulls} trigger pulls; first read dead at f${firstDead}, `
              + `gone at f${gone}`);
  console.log(`rounds charged while it was shot-immune: ${immuneHits}`
              + ` (${immuneDamage} hp)${immuneWhere ? ` — last ${immuneWhere}` : ""}`);
  console.log(`frames dead in a state that is not one of the four death `
              + `states: ${actedWhileDead}${worst ? ` (last ${worst})` : ""}`);
  if (actedWhileDead > 0 || immuneHits > 0 || gone < 0) {
    console.log("\nFAIL  a downed thrower takes no damage, and a dead one is "
                + "falling, dying or a corpse");
    process.exit(1);
  }
  console.log("\nOK  it died where it was shot and left the pool");
} finally {
  await close();
}
process.exit(state.faults ? 1 : 0);
