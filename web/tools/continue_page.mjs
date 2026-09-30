/**
 * The continue screen in the real page: the last life lost with credits left,
 * the run's CONTINUE? counting down over the scene, and START taking it.
 *
 * Opens a stage under `?drive=1`, takes the last life through the ported
 * `PlayerTakeDamage` (`FUN_00415300`) on the path camera, and drives the
 * frames `RunPhaseContinueCountdown` (`FUN_00460530`) runs. Every claim is
 * read back out of the page -- `G`, the HUD canvas's own pixels, the DOM --
 * never echoed from this script (`L44`, `L47`). With `--shots`, screenshots
 * of three digits and of the continue taken go to `web/shots/`.
 *
 * The waits -- for the path camera, for a digit -- are the harness's stop
 * condition (`advance(n, until)`), asked in the page after every frame, so a
 * wait of a thousand frames is sixteen rAFs rather than a thousand (L104).
 *
 * START is the corner button by default -- **Continue**, with the game's digit
 * on it, the one START a phone has -- and Enter with `--enter`. Both are
 * `Player.pressStart`, and both are worth pressing for real.
 *
 *   node tools/continue_page.mjs --headless [--enter] [--shots]
 */
import { join } from "node:path";
import { openPlayer, requireBundle, waitForLoad, SHOTS } from "./lib/player.mjs";

requireBundle("continue_page");

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const STAGE = 2;
/** `ContinueSprite` in `game/hud_sprites.ts`. */
const CONTINUE = 0x22c;
const BIG_DIGIT0 = 0x4f;
const PRESS_START = 0x8ff;
const CREDITS = 0x22e;

const { page, close } = await openPlayer({
  url: `?stage=${STAGE}&drive=1&seed=1`,
  size: "1280x800", headless: flag("headless"), quiet: !flag("loud"),
});

const failures = [];
const check = (ok, what, detail = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures.push(what);
};
const advance = (n) =>
  page.evaluate((k) => globalThis.__hotd2Drive.advance(k), n);
/**
 * Run up to `n` frames, stopping on the first after which `test` -- the name
 * of one of the page-side tests `install` puts up, given `arg` -- holds.
 * Resolves with whether it did.
 */
const advanceUntil = (n, test, arg) => page.evaluate(async ([k, t, a]) => {
  const tests = globalThis.__continueTests;
  let hit = false;
  await globalThis.__hotd2Drive.advance(k, () => (hit = tests[t](a)));
  return hit;
}, [n, test, arg]);
/** The stop conditions, in the page, reading its `G` synchronously. */
const install = () => page.evaluate(async () => {
  const { G } = await import("/src/game/globals.ts");
  globalThis.__continueTests = {
    // The path camera, where the last life can go.
    pathCamera: () => G.g_scene_state_major === 2
      || G.g_scene_state_major_entered === 2,
    // The countdown, drawing digit `d`: `digitOf`, on `BIG_DIGIT0`.
    digit: (d) => G.g_nRunPhase === 4 && G.g_screen_sprite_draws.find(
      (x) => x.id >= 0x4f && x.id <= 0x4f + 9)?.id === 0x4f + d,
  };
});
const shot = (name) => flag("shots")
  && page.screenshot({ path: join(SHOTS, `continue-${name}.png`) });
const state = () => page.evaluate(async () => {
  const { G } = await import("/src/game/globals.ts");
  return {
    app: G.g_app_state, phase: G.g_nRunPhase, timer: G.g_continue_timer,
    pstate: [...G.g_player_state], lives: [...G.g_player_lives],
    credits: [...G.g_credits], live: G.g_evt_gameplay_live,
    crosshair: [...G.g_crosshair_drawn], frame: G.g_frame,
    blink: G.g_credit_blink_clock,
    // The walker's own address, not the URL's, which is synced lazily.
    address: globalThis.__hotd2Drive.now().a,
    draws: G.g_screen_sprite_draws.map((d) => ({
      id: d.id, x: d.x, y: d.y, sx: d.sx, flags: d.flags })),
  };
});
/** Opaque pixels the HUD canvas holds inside a 640x480 rectangle. */
const inked = (x, y, w, h) => page.evaluate(([x, y, w, h]) => {
  const cv = document.querySelector(".hud-screen");
  if (!(cv instanceof HTMLCanvasElement)) return -1;
  const px = cv.getContext("2d")?.getImageData(x, y, w, h).data;
  if (!px) return -1;
  let n = 0;
  for (let i = 3; i < px.length; i += 4) if (px[i] > 200) n += 1;
  return n;
}, [x, y, w, h]);
const crosshairShown = () => page.evaluate(() => {
  const el = document.querySelector(".crosshair");
  return el instanceof HTMLElement ? !el.hidden : null;
});
/**
 * The corner button as the page shows it, once the page has drawn the digit
 * `d` on it -- the UI publishes on the page's own frame, not the drive's.
 */
const cornerShows = async (d) => {
  try {
    await page.waitForFunction((want) => {
      const b = document.querySelector("#skipbar.continue button");
      return b && b.querySelector(".continue-digit")?.textContent === want;
    }, String(d), { timeout: 5000 });
  } catch { /* read back what is there instead */ }
  return page.evaluate(() => {
    const b = document.querySelector("#skipbar button");
    return b ? { cls: b.parentElement.className, text: b.textContent.trim(),
                 disabled: b.disabled } : null;
  });
};
const digitOf = (s) => {
  const d = s.draws.find((x) => x.id >= BIG_DIGIT0 && x.id <= BIG_DIGIT0 + 9);
  return d ? d.id - BIG_DIGIT0 : -1;
};

// The last life only goes on the path camera (`PlayerFloorLivesOffPath`), so
// play on until the scene is there, then strike.
async function killPlayer() {
  for (let i = 0; i < 20; i++) {
    await advanceUntil(4000, "pathCamera");
    const struck = await page.evaluate(async () => {
      const { G } = await import("/src/game/globals.ts");
      const { PlayerTakeDamage } = await import("/src/game/combat/player.ts");
      if (G.g_scene_state_major !== 2 && G.g_scene_state_major_entered !== 2)
        return false;
      G.g_player_no_damage[0] = 0;
      G.g_player_lives[0] = 1;
      G.g_player_invuln_frames[0] = 0;
      PlayerTakeDamage(0, 1, 0);
      return G.g_player_lives[0] === 0;
    });
    if (struck) return;
  }
  throw new Error("never reached the path camera: " +
                  JSON.stringify(await state()));
}

/**
 * On to the first frame that draws digit `d`, and two more: a sprite's image
 * is decoded the first time the HUD layer meets it, and a frame drawn while it
 * decodes leaves it out (`Hud.drawSprites`), so the canvas is read after the
 * frame that can draw it.
 */
async function untilDigit(d) {
  if (await advanceUntil(1200, "digit", d)) {
    await page.waitForTimeout(100);
    await advance(2);
  }
  return state();
}

try {
  await waitForLoad(page);
  await install();
  // The port starts in free play (`g_option_credits` -1), where a continue
  // spends nothing and the credit line has no count. This check is of the
  // counted continue, so it puts the factory options' credits back the way
  // the title's confirm seeds them: `SetBothPlayerCounters(
  // ModeStartCounterValue(mode))` with the setting at 5.
  await page.evaluate(async () => {
    const { G } = await import("/src/game/globals.ts");
    const c = await import("/src/game/credits.ts");
    const { OPTIONS_FACTORY } = await import("/src/game/options_data.ts");
    G.g_option_credits = OPTIONS_FACTORY.credits;
    c.SetBothPlayerCounters(c.ModeStartCounterValue(G.g_GameMode));
  });
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press("Space");
  await advance(120);
  let s = await state();
  check(s.app === 6 && s.pstate[0] === 5 && s.live === 1,
        "in play, the script's gameplay gate open", JSON.stringify(s.pstate));
  // The walk read the clock `CreditBlinkTick` left the frame before.
  const on = (((s.blink - 1) >> 5) % 3) !== 2;
  check((s.draws.some((d) => d.id === PRESS_START && d.x === 384)
         && s.draws.some((d) => d.id === CREDITS && d.x === 424)) === on,
        "player 2's corner has its credit line exactly when the blink is on",
        `clock ${s.blink}`);

  await killPlayer();
  for (let i = 0; i < 10 && (await state()).phase !== 4; i++) await advance(1);
  // The frame that moved the run to phase 4 was phase 3's, which drew the
  // per-player countdown's small prompt; the next is the run's own.
  await advance(1);
  s = await state();
  console.log("continue:", JSON.stringify({ ...s, draws: s.draws.length }));
  check(s.app === 6 && s.phase === 4 && s.pstate[0] === 4,
        "the last life with credits left: player 1 at 4, the run in phase 4");
  const big = s.draws.filter((d) => d.id === CONTINUE);
  check(big.length === 1 && big[0].x === 128 && big[0].y === 200
        && digitOf(s) === 9,
        "the frame draws CONTINUE? at (128, 200) and the digit 9",
        JSON.stringify(big));
  // The HUD canvas's own pixels, not the port's list (L47).
  const word = await inked(128, 200, 340, 64);
  const nine = await inked(482, 188, 64, 128);
  check(word > 3000 && nine > 800,
        "the HUD canvas has the CONTINUE? and the 9 where the exe puts them",
        `${word} and ${nine} opaque pixels`);
  check(s.live === 0 && s.crosshair[0] === 0 && (await crosshairShown()) === false,
        "no crosshair, and the script's gate shut");
  const address = s.address;
  await shot("9");

  s = await untilDigit(6);
  check(digitOf(s) === 6 && (await inked(482, 188, 64, 128)) > 800,
        "counting down: the 6", `timer ${s.timer.toString(16)}`);
  check(s.address === address,
        "the script stands at its wait while the countdown runs",
        `${address} -> ${s.address}`);
  const at6 = await cornerShows(6);
  check(at6?.cls === "continue" && at6.text === "Continue 6" && !at6.disabled,
        "the corner button is Continue, with the game's digit on it",
        JSON.stringify(at6));
  await shot("6");
  s = await untilDigit(3);
  check(digitOf(s) === 3, "counting down: the 3",
        `timer ${s.timer.toString(16)}`);
  const line = s.draws.filter((d) => d.id === PRESS_START || d.id === CREDITS);
  console.log("credit line:", JSON.stringify(line));
  await shot("3");

  // START (`g_pad_state` bit 8) with a credit: the corner button, or Enter.
  const credits = s.credits[0];
  const at3 = await cornerShows(3);
  check(at3?.text === "Continue 3", "...and counts down with it",
        JSON.stringify(at3));
  if (flag("enter")) await page.keyboard.press("Enter");
  else await page.click("#skipbar.continue button");
  await advance(3);
  s = await state();
  console.log("continued:", JSON.stringify({ ...s, draws: s.draws.length }));
  check(s.app === 6 && s.phase === 2 && s.pstate[0] === 5 && s.lives[0] === 3
        && s.credits[0] === credits - 1,
        `START (${flag("enter") ? "Enter" : "the button"}) continues: in play, `
        + "three lives, a credit spent");
  check(!s.draws.some((d) => d.id === CONTINUE) && s.live === 1,
        "the CONTINUE? is gone and the script's gate open again");
  await page.waitForFunction(() => !document.querySelector("#skipbar.continue"),
                             null, { timeout: 5000 }).catch(() => {});
  check(!(await page.$("#skipbar.continue")), "...and so is the button");
  await advance(30);
  await shot("taken");
} catch (e) {
  failures.push(String(e));
  console.log(String(e));
} finally {
  await close();
}
console.log(failures.length ? `${failures.length} failed` : "all passed");
process.exit(failures.length ? 1 : 0);
