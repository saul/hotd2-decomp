/**
 * A reload past JUDGMENT's return does not bring the fight back, in the real
 * page.
 *
 * `?stage=5&original=1&block=4&step=1&op=0` -- the address the page itself
 * writes while block 4 step 1 plays, and so the address a reload lands on
 * (L75) -- used to arrive with `g_enemies_alive` 1 and nothing on the field to
 * shoot. The seek's replay had listed JUDGMENT's flier since block 1 and
 * rebuilt it at the landing; its entrance made the walker, and the walker
 * counted itself into both counters in its `Init`. Block 4 step 2's five
 * zombies came and went, and `wait_enemies_alive` at `4/2/12` stayed shut on
 * the `1`. `Class22OutlivedByReplay` retires the record once the replay has
 * gone past the flag the flier's death raises.
 *
 * Every claim is read back out of the page -- `G` and the drive seam's own
 * address, `__hotd2Drive.now().a` (L59) -- never echoed from this script
 * (L44). The room is cleared with the sidebar's debug Kill, **a cheat,
 * printed as one** (L45): what is under test is the count the gate reads,
 * not the shooting, and the Kill routes class 0x30 through its own death
 * chain, which is where that count is given back.
 *
 *   node tools/judgment_reload_page.mjs --headless
 */
import { join } from "node:path";
import { openPlayer, requireBundle, waitForLoad, SHOTS } from "./lib/player.mjs";

requireBundle("judgment_reload_page");

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const ADDRESS = "stage=5&original=1&block=4&step=1&op=0";
/** Block 4 step 2's room gate, `wait_enemies_alive 0`. */
const GATE = "4/2/12";
/** Classes 0x22 and 0x23: the flier and the walker. */
const JUDGMENT = [0x22, 0x23];

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
const state = () => page.evaluate(async (judgment) => {
  const { G } = await import("/src/game/globals.ts");
  const live = G.g_object_list.filter((o) => !o.despawned && !o.dead);
  return {
    address: globalThis.__hotd2Drive.now().a,
    frame: globalThis.__hotd2Drive.now().f,
    alive: G.g_enemies_alive, present: G.g_enemies_present,
    judgment: live.filter((o) => judgment.includes(o.cls))
      .map((o) => `0x${o.at.toString(16)} cls 0x${o.cls.toString(16)}`),
    zombies: live.filter((o) => o.cls === 0x30).length,
  };
}, JUDGMENT);

let code = 1;
try {
  await waitForLoad(page);
  if (await page.evaluate(() => globalThis.__hotd2Drive?.version ?? null)
      === null) {
    throw new Error("no drive seam -- is ?drive=1 wired up?");
  }
  // A seek lands paused: blur and press Space, then take a frame so the
  // placers and the landing's rebuilt spawns have run (L44).
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press("Space");
  await advance(2);
  const landed = await state();
  console.log(`\n?${ADDRESS}, landed at ${landed.address} f${landed.frame}`);
  check(landed.address.startsWith("4/1/"),
        "the seek lands in block 4 step 1", landed.address);
  check(landed.judgment.length === 0,
        "no JUDGMENT body is rebuilt at the landing",
        landed.judgment.join(", ") || "none");
  check(landed.alive === 0 && landed.present === 0,
        "and nothing is counted before block 4's own enemies arrive",
        `g_enemies_alive ${landed.alive} g_enemies_present ${landed.present}`);

  // Play on to the room gate.
  let s = landed;
  for (let f = 0; f < 1200 && s.address !== GATE; f += 10) {
    await advance(10);
    s = await state();
  }
  check(s.address === GATE, `the walker reaches ${GATE}'s room gate`,
        s.address);
  await advance(60);
  s = await state();
  await page.screenshot({ path: join(SHOTS, "judgment-reload-gate.png") });
  check(s.zombies > 0 && s.alive === s.zombies,
        "the gate counts exactly the zombies standing in the room",
        `g_enemies_alive ${s.alive}, ${s.zombies} class-0x30 alive`);

  console.log("  CHEAT  the sidebar's debug Kill clears the room (L45)");
  await page.click('button[title^="Kill every live actor"]');
  let left = null;
  for (let f = 0; f < 600; f += 10) {
    await advance(10);
    const t = await state();
    if (t.address !== GATE) { left = t; break; }
    s = t;
  }
  check(left !== null,
        `the gate opens once the room is dead, and the walker leaves ${GATE}`,
        left ? `at ${left.address} f${left.frame}`
             : `still at ${s.address}: g_enemies_alive ${s.alive}`);
  code = failures.length ? 1 : 0;
  console.log(failures.length ? `\n${failures.length} failed`
                              : "\nall passed");
} finally {
  await close();
}
process.exit(code);
