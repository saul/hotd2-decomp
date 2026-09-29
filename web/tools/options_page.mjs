/**
 * The options screen in the real page: the menu's Options, the arrows and a
 * click on the list, EXIT, and the game that follows playing by what was set.
 *
 * Opens stage 1 under `?drive=1`, starts, and opens the options through the
 * menu -- `≡`, then **Options** -- which asks for app state `0x0C` the way the
 * title's OPTION row does. On `OptionsRunPhase` (`FUN_004869E0`) it presses
 * the page's own keys: down to Life and right twice (three lives to five),
 * down to Continue and right three times (free play to 3), a click on the
 * Sight Graphic row's right, then up to EXIT and Enter. EXIT hands back to the
 * title, which the page is by starting the stage again; the new game is read
 * back out of `G` -- five lives, four credits spent to three, no free play.
 * Every claim is read
 * back out of the page, never echoed from this script (L44, L47): `G`, the HUD
 * canvas's own pixels, the DOM. Screenshots go to `web/shots/`.
 *
 *   node tools/options_page.mjs --headless
 */
import { join } from "node:path";
import { openPlayer, requireBundle, waitForLoad, SHOTS } from "./lib/player.mjs";

requireBundle("options_page");

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const STAGE = 1;
/** `OptionsSprite.Options`, "OPTIONS" -- `PUSH 0xB31` at `0x00486E21`. */
const TITLE = 0xb31;

const { page, close, state: faults } = await openPlayer({
  url: `?stage=${STAGE}&drive=1&seed=1`,
  size: "1280x960", headless: flag("headless"), quiet: !flag("loud"),
  // A fresh profile every run: whatever an earlier run saved is not this
  // one's starting point.
  init: () => {
    try { localStorage.removeItem("hod2.profile"); } catch { /* */ }
  },
});

const failures = [];
const check = (ok, what, detail = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures.push(what);
};
const advance = (n) =>
  page.evaluate((k) => globalThis.__hotd2Drive.advance(k), n);
const state = () => page.evaluate(async () => {
  const { G } = await import("/src/game/globals.ts");
  return {
    app: G.g_app_state, phase: G.g_nRunPhase, cursor: G.g_options_cursor,
    frameFn: G.g_options_frame, lives: [...G.g_player_lives],
    optLives: G.g_option_lives, optCredits: G.g_option_credits,
    startLives: G.g_start_lives, credits: [...G.g_credits],
    free: G.g_free_play, sight: [...G.g_player_sight_graphic],
    unloaded: G.g_stage_unloaded, pstate: [...G.g_player_state],
    search: location.search,
    draws: G.g_screen_sprite_draws.length,
    title: G.g_screen_sprite_draws.find((d) => d.id === 0xb31) ?? null,
    red: G.g_screen_sprite_draws.filter((d) => d.tint === 0xff0000).length,
  };
});
/** Pixels of the HUD canvas inside a 640x480 rectangle that are opaque. */
const inked = (x, y, w, h) => page.evaluate(([x, y, w, h]) => {
  const cv = document.querySelector(".hud-screen");
  if (!(cv instanceof HTMLCanvasElement)) return -1;
  const px = cv.getContext("2d")?.getImageData(x, y, w, h).data;
  if (!px) return -1;
  let n = 0;
  for (let i = 3; i < px.length; i += 4) if (px[i] > 200) n += 1;
  return n;
}, [x, y, w, h]);
/** Of those, how many are red and not white: the highlighted row. */
const reddish = (x, y, w, h) => page.evaluate(([x, y, w, h]) => {
  const cv = document.querySelector(".hud-screen");
  if (!(cv instanceof HTMLCanvasElement)) return -1;
  const px = cv.getContext("2d")?.getImageData(x, y, w, h).data;
  if (!px) return -1;
  let n = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] > 200 && px[i] > 150 && px[i + 1] < 60 && px[i + 2] < 60) n += 1;
  }
  return n;
}, [x, y, w, h]);
const key = async (code, times = 1) => {
  for (let i = 0; i < times; i++) {
    await page.keyboard.press(code);
    await advance(2);
  }
};
/**
 * The page draws on its own frame, not the drive's, and a sprite image still
 * decoding is skipped until the next draw: wait, run one more frame -- a
 * zero-frame pump redraws the last pose and draws no new HUD (L69) -- and
 * wait again. A frame with nothing pressed changes nothing on this screen.
 */
const settle = async () => {
  await page.waitForTimeout(300);
  await advance(1);
  await page.waitForTimeout(300);
};

async function untilInPlay() {
  for (let i = 0; i < 120; i++) {
    const t = await state();
    if (t.app === 6 && t.lives[0] > 0 && t.unloaded === 0) return t;
    await advance(1).catch(() => {});
    await page.waitForTimeout(250);
  }
  throw new Error("the stage never came back into play: "
                  + JSON.stringify(await state()));
}

try {
  await waitForLoad(page);
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press("Space");
  await advance(60);
  let s = await state();
  check(s.app === 6 && s.optCredits === -1 && s.startLives === 3,
        "a fresh profile: in play, free play, three lives",
        `app ${s.app} credits ${s.optCredits} lives ${s.startLives}`);

  // The menu's Options.
  await page.click(".crumb-trail");
  await page.click(".options-open");
  await advance(3);
  s = await state();
  check(s.app === 0x0c && s.phase === 1 && s.cursor === 0 && s.unloaded === 1,
        "the menu's Options: app state 0x0C, the list armed, the stage "
        + "released", `app ${s.app} phase ${s.phase}`);
  check(s.title?.x === 344 && s.title?.y === 16 && s.red > 0,
        "\"OPTIONS\" at (344, 16), and the highlighted row lit red",
        JSON.stringify(s.title));
  await settle();
  const titleInk = await inked(216, 16, 256, 64);
  check(titleInk > 1500, "the HUD canvas has the title's texture where it is",
        `${titleInk} opaque pixels`);
  const rowRed = await reddish(32, 72, 160, 32);
  check(rowRed > 100, "...and \"Difficulty\" in red on line 3",
        `${rowRed} red pixels`);
  await page.screenshot({ path: join(SHOTS, "options-list.png") });

  await key("ArrowDown");
  await key("ArrowRight", 2);
  s = await state();
  check(s.cursor === 1 && s.optLives === 4,
        "down and right twice: Life, set to 4 (five lives)",
        `cursor ${s.cursor} life ${s.optLives}`);
  await key("ArrowDown");
  await key("ArrowRight", 3);
  s = await state();
  check(s.cursor === 2 && s.optCredits === 3,
        "down and right three times: Continue, free play to 1, 2, 3",
        `cursor ${s.cursor} credits ${s.optCredits}`);
  await key("ArrowDown");
  s = await state();
  check(s.cursor === 4, "down again steps over Blood Color: Sight Graphic",
        `cursor ${s.cursor}`);
  await key("ArrowRight");
  s = await state();
  check(s.sight[0] === 1, "right on Sight Graphic: player 1's crosshair 1",
        `${s.sight}`);
  await settle();
  await page.screenshot({ path: join(SHOTS, "options-changed.png") });

  // A held right on the SE test runs it.
  await key("ArrowDown");
  s = await state();
  check(s.cursor === 6, "down steps over Sight Speed to the SE test",
        `cursor ${s.cursor}`);
  await page.keyboard.down("ArrowRight");
  await advance(40);
  await page.keyboard.up("ArrowRight");
  await advance(1);
  const se = await page.evaluate(async () => {
    const { G } = await import("/src/game/globals.ts");
    return G.g_options_se_test;
  });
  check(se > 5, "a right held 40 frames runs the SE test's number on",
        `No. ${se}`);
  await settle();
  await page.screenshot({ path: join(SHOTS, "options-sound-test.png") });

  // A click is A: on the music test it plays; on EXIT it leaves.
  for (let i = 0; i < 12; i++) {
    s = await state();
    if (s.cursor === 10) break;
    await key("ArrowUp");
  }
  s = await state();
  check(s.cursor === 10, "up to EXIT", `cursor ${s.cursor}`);
  await settle();
  await page.screenshot({ path: join(SHOTS, "options-exit.png") });
  await page.keyboard.press("Enter");
  await advance(3);

  s = await untilInPlay();
  // The reticle is up once the stage's script opens the firing gate; START
  // skips the opening's cutscenes on the way (Enter, both of its readers).
  for (let i = 0; i < 6000; i += 20) {
    const drawn = await page.evaluate(async () => {
      const { G } = await import("/src/game/globals.ts");
      return G.g_crosshair_drawn[0];
    });
    if (drawn) break;
    if (i % 120 === 0) await page.keyboard.press("Enter");
    await advance(20);
  }
  await settle();
  s = await state();
  check(new URLSearchParams(s.search).get("stage") === String(STAGE),
        "the title hands back to the same stage, from its start",
        s.search);
  check(s.lives[0] === 5 && s.startLives === 5,
        "the next game starts with five lives", `lives ${s.lives}`);
  check(s.free === 0 && s.credits[0] === 3,
        "...and four credits, the start having spent one -- no free play",
        `credits ${s.credits} free ${s.free}`);
  const reticle = await page.evaluate(() => {
    const el = document.querySelector(".crosshair");
    return el instanceof HTMLElement
      ? { cls: el.className, bg: el.style.backgroundImage.slice(0, 30) } : null;
  });
  check(!!reticle && reticle.cls.includes("sprite") && reticle.bg.includes("url("),
        "the reticle is the game's crosshair sprite -- the Sight Graphic chosen",
        JSON.stringify(reticle));
  check(faults.faults === 0, "no console error or throw on the way",
        faults.faultLines.join(" | "));
} catch (e) {
  failures.push(String(e));
  console.log(`  FAIL  ${e}`);
} finally {
  await close();
}
console.log(failures.length ? `\n${failures.length} failed` : "\nall passed");
process.exit(failures.length ? 1 : 0);
