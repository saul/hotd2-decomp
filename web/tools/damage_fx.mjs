/**
 * The damage overlay in the real page: get hit, and look at what is drawn.
 *
 * Opens a block under `?drive=1`, plays without firing, and watches the score
 * for `g_player_invuln_frames` jumping back up, which only `PlayerTakeDamage`
 * (`FUN_00415300`) does -- the score is not a signal on its own, because a
 * civilian's death costs 100 too (L47). On each strike it reads
 * `g_damage_overlays` out of the page's own module instance -- the dev server
 * hands `import()` the same `game/globals.ts` the player loaded -- steps a few
 * frames and screenshots, so each picture is labelled with the kind the port
 * says it is drawing.
 *
 * Then the two things a renderer can get wrong and the port cannot see:
 *
 * * **pause** -- with the transport stopped the overlay must stay exactly as
 *   it is (the record does not move, so neither may the picture);
 * * **load** -- loading a snapshot taken before the hit must show no
 *   overlay, because the drawn node is derived from `G` and `G` has been
 *   replaced. Read the `-loaded.png` it writes: the check on `G` alone cannot
 *   see a node the renderer failed to drop.
 *
 *   node tools/damage_fx.mjs --headless
 *   node tools/damage_fx.mjs --headless --url '?stage=4&block=0&step=6&op=0'
 *
 * Screenshots go to `web/shots/damage-<tag>-*.png`.
 */
import { join } from "node:path";
import { openPlayer, waitForLoad, SHOTS } from "./lib/player.mjs";

const args = process.argv.slice(2);
const opt = (n, d = null) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const flag = (n) => args.includes(`--${n}`);
const where = opt("url", "?stage=1&mode=play&block=4&step=0&op=0");
const tag = opt("out", "s1");
const BUDGET = Number(opt("budget", "3000"));
const WANT = Number(opt("hits", "2"));

const { page, close } = await openPlayer({
  url: `${where}&drive=1&seed=${opt("seed", "1")}`,
  size: "1280x800", headless: flag("headless"), quiet: !flag("loud"),
});

/** The page's own `G`, via the module graph the dev server already built. */
const overlay = () => page.evaluate(async () => {
  const { G } = await import("/src/game/globals.ts");
  return {
    rec: G.g_damage_overlays.map((o) => ({ ...o })),
    hook: [...G.g_player_camera_hook],
    kind: G.g_player_hit_motion[0],
    shake: G.g_screen_shake_frames,
    major: G.g_scene_state_major_entered,
    wasHit: [...G.g_player_was_hit],
    lives: [...G.g_player_lives],
    invuln: [...G.g_player_invuln_frames],
    state: [...G.g_player_state],
  };
});

let failed = false;
try {
  await waitForLoad(page);
  if (await page.evaluate(() => globalThis.__hotd2Drive?.version ?? null)
      === null) {
    throw new Error("no drive seam -- is ?drive=1 wired up?");
  }
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press("Space");
  const advance = (n) =>
    page.evaluate((k) => globalThis.__hotd2Drive.advance(k), n);
  const drain = () => page.evaluate(() => globalThis.__hotd2Drive.drain());
  await page.evaluate(() => globalThis.__hotd2Drive.trace(true));

  // A strike is `g_player_invuln_frames` jumping back up to 0x5A: nothing
  // but `PlayerTakeDamage` writes it upward. (The score is not enough -- a
  // civilian's death also costs 100.)
  const invuln = () => page.evaluate(async () => {
    const { G } = await import("/src/game/globals.ts");
    // One dword per player now (`game/player_shell.ts`); player 0's, and the
    // lives beside it: entering play also opens a 90-frame window, so a
    // strike is the window re-opening **with a life gone** (L47).
    return [G.g_player_invuln_frames[0], G.g_player_lives[0]];
  });
  // A snapshot from before any hit, for the load check below.
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.evaluate(() => document.activeElement?.blur?.());
  let [prev, prevLives] = await invuln();
  let hits = 0, drawn = 0, stale = null;
  for (let done = 0; done < BUDGET && hits < WANT; done += 2) {
    await advance(2);
    const rows = await drain();
    const [v, lives] = await invuln();
    const struck = v > prev && lives < prevLives
      ? rows[rows.length - 1] ?? { a: "?", f: -1 } : null;
    prev = v;
    prevLives = lives;
    if (!struck) continue;
    hits += 1;
    // Three frames on: the player's update has spawned it by now.
    await advance(3);
    await drain();
    const st = await overlay();
    const o = st.rec[0];
    const file = join(SHOTS, `damage-${tag}-${hits}-kind${st.kind}.png`);
    await page.screenshot({ path: file });
    console.log(`hit ${hits} at ${struck.a} f${struck.f}: kind ${st.kind}, `
      + `overlay ${JSON.stringify(o)}, hook ${st.hook}, major ${st.major}, shake ${st.shake}, `
      + `latch ${st.wasHit} lives ${st.lives} invuln ${st.invuln} state ${st.state}`);
    console.log(`  -> ${file}`);
    if (o.active) drawn += 1;
    if (hits === 1 && o.active) {
      // Pause: nothing may move while the transport is stopped.
      await page.keyboard.press("Space");
      await page.waitForTimeout(400);
      const held = (await overlay()).rec[0];
      await page.screenshot({ path: join(SHOTS, `damage-${tag}-paused.png`) });
      const still = held.frames === o.frames && held.active === o.active;
      console.log(`  paused 400 ms: frames ${o.frames} -> ${held.frames} `
        + (still ? "(held)" : "(MOVED)"));
      if (!still) failed = true;
      await page.keyboard.press("Space");
      // Load: the snapshot has no overlay, and the drawn node is derived
      // from `G`, so the picture must lose it without a frame being run.
      await page.getByRole("button", { name: "Load", exact: true }).click();
      await page.evaluate(() => document.activeElement?.blur?.());
      await page.waitForTimeout(400);
      const after = (await overlay()).rec[0];
      const shot = join(SHOTS, `damage-${tag}-loaded.png`);
      await page.screenshot({ path: shot });
      stale = after.active;
      console.log(`  loaded the pre-hit snapshot: overlay active ${after.active}`
        + ` -> ${shot}`);
      if (after.active) failed = true;
    }
    // Let this one run out before looking for the next, so the next picture
    // is the next hit's and not a leftover.
    for (let k = 0; k < 70; k += 10) { await advance(10); await drain(); }
    [prev, prevLives] = await invuln();
  }
  console.log(`\n${where}: ${hits} hits, ${drawn} with an overlay up`);
  if (hits === 0) {
    console.log("FAIL  nothing hit the player in the budget");
    failed = true;
  } else if (drawn < hits) {
    console.log("FAIL  a hit under a path camera showed no overlay");
    failed = true;
  } else {
    console.log("ok    every hit showed its overlay");
  }
} finally {
  await close();
}
process.exit(failed ? 1 : 0);
