/**
 * The game-over screen in the real page, and its two port-only buttons.
 *
 * Opens a stage under `?drive=1`, takes the last life with no credit left
 * through the ported `PlayerTakeDamage` (`FUN_00415300`) -- a strike, not a
 * hand-set state -- and drives the frames `GameOverRunPhase` (`FUN_00460960`)
 * runs: the fly-over, the logo, the wait for a button. Screenshots of the logo
 * and of each button's result go to `web/shots/`. Every claim is read back
 * out of the page's own `G` and DOM, never echoed from this script (`L47`).
 *
 *   node tools/game_over_page.mjs --headless
 */
import { join } from "node:path";
import { openPlayer, waitForLoad, SHOTS } from "./lib/player.mjs";

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const STAGE = 2;

const { page, close } = await openPlayer({
  url: `?stage=${STAGE}&drive=1&seed=1`,
  size: "1280x800", headless: flag("headless"), quiet: !flag("loud"),
});

const failures = [];
const check = (ok, what) => {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}`);
  if (!ok) failures.push(what);
};
const advance = (n) =>
  page.evaluate((k) => globalThis.__hotd2Drive.advance(k), n);
const state = () => page.evaluate(async () => {
  const { G } = await import("/src/game/globals.ts");
  return {
    app: G.g_app_state, phase: G.g_nRunPhase, timer: G.g_game_over_timer,
    logo: G.g_game_over_logo_frame, lives: [...G.g_player_lives],
    credits: [...G.g_credits], score: [...G.g_player_score],
    pstate: [...G.g_player_state], sprites: G.g_screen_sprite_anims.length,
    search: location.search, frame: G.g_frame, major: G.g_scene_state_major, entered: G.g_scene_state_major_entered,
  };
});
const dom = () => page.evaluate(() => {
  const el = document.querySelector("#gameover");
  // The HUD canvas's own pixels over the plate's 512x64 rectangle: what the
  // page drew, not what the port says it drew (L47).
  const cv = document.querySelector(".hud-screen");
  let inked = -1;
  if (cv instanceof HTMLCanvasElement) {
    const px = cv.getContext("2d")?.getImageData(64, 208, 512, 64).data;
    if (px) {
      inked = 0;
      for (let i = 3; i < px.length; i += 4) if (px[i] > 200) inked += 1;
    }
  }
  return el ? { phase: el.dataset.phase, text: el.innerText, inked } : null;
});
const draws = () => page.evaluate(async () => {
  const { G } = await import("/src/game/globals.ts");
  return G.g_screen_sprite_draws.map((d) => ({ ...d }));
});

// The last life only goes on the path camera: off it, `PlayerTakeDamage`
// floors the player at one (`PlayerFloorLivesOffPath`). So play on until the
// scene is on the path camera (scene major 2) and strike there.
// Two routes into the game-over screen, and they draw different bodies.
// With credits the run's own continue screen (phase 4) counts down while the
// player waits at state 4, and phase 0 arms them: the fall, motion 0x338.
// With none the player's own countdown ends at once and puts them at 6 in
// play, so phase 0 leaves them be and the fresh body keeps motion 0x32C.
async function killPlayer(zeroCredits) {
  await page.evaluate(async (zero) => {
    const { G } = await import("/src/game/globals.ts");
    if (zero) { G.g_credits[0] = 0; G.g_credits[1] = 0; }
    G.g_player_no_damage[0] = 0;
  }, zeroCredits);
  for (let i = 0; i < 4000; i += 5) {
    const struck = await page.evaluate(async () => {
      const { G } = await import("/src/game/globals.ts");
      const { PlayerTakeDamage } = await import("/src/game/combat/player.ts");
      if (G.g_app_state !== 6) return true;
      if (G.g_scene_state_major !== 2 && G.g_scene_state_major_entered !== 2)
        return false;
      G.g_player_lives[0] = 1;
      G.g_player_invuln_frames[0] = 0;
      PlayerTakeDamage(0, 1, 0);
      return G.g_player_lives[0] === 0;
    });
    if (struck) return;
    await advance(5);
  }
  throw new Error("never reached the path camera to strike on: " +
                  JSON.stringify(await state()));
}

// A new game is an async stage load; poll the page's own state for it
// (`waitForFunction` does not await an async predicate, so it cannot).
async function untilInPlay(stage) {
  for (let i = 0; i < 60; i++) {
    const t = await state();
    if (t.app === 6 && t.lives[0] > 0 &&
        new URLSearchParams(t.search).get("stage") === String(stage)) return;
    await page.waitForTimeout(500);
  }
  throw new Error(`stage ${stage} never came back into play`);
}

async function untilGameOverPhase(ph, budget = 2000) {
  for (let i = 0; i < budget; i += 5) {
    const s = await state();
    if (s.app === 7 && s.phase >= ph) return s;
    await advance(5);
  }
  return state();
}

try {
  await waitForLoad(page);
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press("Space");
  await advance(120);
  let s = await state();
  console.log("before:", JSON.stringify(s));
  check(s.app === 6 && (await dom()) === null,
        "in play, no game-over layer");

  await killPlayer(false);
  console.log("struck:", JSON.stringify(await state()));
  s = await untilGameOverPhase(1);
  console.log("fly-over:", JSON.stringify(s));
  check(s.app === 7, "the last life, through the run's continue screen, reaches app state 7");

  // The fly-over: the stage released, the camera on `cp_gmovr`'s path, and
  // the player's body falling from path frame 0x3C. Shot twice -- standing,
  // and most of the way down.
  const fly = () => page.evaluate(async () => {
    const { G } = await import("/src/game/globals.ts");
    const b = G.g_player_bodies[0];
    return { phase: G.g_nRunPhase, frame: G.g_game_over_fly_frame,
             unloaded: G.g_stage_unloaded,
             eye: { ...G.g_camera_block_eye },
             body: b ? { drawn: b.drawn, ticks: b.playTicks, motion: b.motion,
                         pos: { ...b.pos } } : null };
  });
  const untilFly = async (frame) => {
    for (let i = 0; i < 400; i += 1) {
      const t = await fly();
      if (t.phase !== 1 || t.frame >= frame) return t;
      await advance(1);
    }
    return fly();
  };
  let t = await untilFly(0x30);
  console.log("fly-over start:", JSON.stringify(t));
  check(t.phase === 1 && t.unloaded === 1 && !!t.body && t.body.drawn === 1
        && t.body.motion === 0x338 && t.body.ticks === 0,
        "the fly-over draws the body on motion 0x338, not yet falling, "
        + "with the stage released");
  check(t.eye.x !== 0 || t.eye.y !== 0 || t.eye.z !== 0,
        "the camera block is on the fly-over path, not the stage's shot");
  await page.screenshot({ path: join(SHOTS, "gameover-fly-start.png") });
  t = await untilFly(0x96);
  console.log("fly-over fall:", JSON.stringify(t));
  check(t.phase === 1 && !!t.body && t.body.drawn === 1
        && t.body.ticks === t.frame - 0x3c,
        "from path frame 0x3C the body's cursor steps once a frame");
  await page.screenshot({ path: join(SHOTS, "gameover-fly-fall.png") });

  // Into the logo. `GameOverLogoTask` fades the plate in over 50 frames
  // and spawns the flashes from 0x78; shoot the plate at full strength and
  // then the flashes.
  s = await untilGameOverPhase(3);
  const untilLogo = async (frame) => {
    for (let i = 0; i < 400; i += 1) {
      if ((await state()).logo >= frame) break;
      await advance(1);
    }
  };
  await untilLogo(0x64);
  s = await state();
  let d = await dom();
  const plate = await page.evaluate(async () => {
    const { G } = await import("/src/game/globals.ts");
    return G.g_screen_sprite_anims.find((a) => a.id === 0x43a) ?? null;
  });
  console.log("logo:", JSON.stringify(s), JSON.stringify(d),
              JSON.stringify(plate));
  check(s.phase === 3 && plate !== null && plate.alpha >= 1,
        "phase 3 has the GAME OVER plate up at full alpha");
  const dr = await draws();
  check(dr.some((x) => x.id === 0x43a && x.alpha >= 1 && x.flags === 10
                && x.x === 320 && x.y === 240),
        "the plate goes through ScreenSpriteDraw: centred at (320, 240), "
        + "alpha 1");
  check(!!d && d.inked > 2000,
        "the HUD canvas has the plate's texture where the plate is",
        `${d?.inked} opaque pixels`);
  await page.screenshot({ path: join(SHOTS, "gameover-logo.png") });
  await untilLogo(0x8a);
  s = await state();
  d = await dom();
  console.log("flashes:", JSON.stringify(s), JSON.stringify(d));
  check(s.sprites >= 4, "the flashes are out");
  await page.screenshot({ path: join(SHOTS, "gameover-flashes.png") });

  // The route map: the figure walking the run's route over the map.
  s = await untilGameOverPhase(5);
  await advance(60);
  s = await state();
  const route = await page.evaluate(async () => {
    const { G } = await import("/src/game/globals.ts");
    return { map: { ...G.g_route_map }, figures: G.g_route_figures.length,
             motion: G.g_route_figures[0]?.motion ?? -1,
             marks: G.g_route_marks.length,
             tiles: G.g_screen_sprite_draws.length,
             done: G.g_game_over_route_done };
  });
  console.log("route:", JSON.stringify(s), JSON.stringify(route));
  check(s.app === 7 && s.phase === 5 && route.figures === 1
        && (route.motion === 0x35b || route.done !== 0) && route.tiles === 300
        && route.marks > 0,
        "phase 5 walks player 1's figure on 0x35B over the 300-tile map, "
        + "leaving footprints");
  await page.screenshot({ path: join(SHOTS, "gameover-route.png") });
  await advance(240);
  await page.screenshot({ path: join(SHOTS, "gameover-route-later.png") });

  // Restart this stage.
  await page.click("#gameover-restart");
  // Take the mouse off the page again. The click left the aim on the
  // button, and the aim is game input (`g_crosshair_x/y`, the gun light):
  // stage 2's block 0 then plays out differently from the first run and the
  // script parks at 0/4 on an enemy gate nobody is shooting at. Measured by
  // diffing `G` after the restart against a fresh load: the aim and player
  // 1's camera hook were the only differences, and moving the mouse away
  // made the second run replay the first.
  await page.mouse.move(-1, -1);
  await untilInPlay(STAGE);
  await advance(120);
  s = await state();
  console.log("restart:", JSON.stringify(s));
  check(s.app === 6 && new URLSearchParams(s.search).get("stage") ===
        String(STAGE), `restart plays stage ${STAGE} again`);
  check(s.lives[0] > 0 && s.credits[0] > 0 && s.score[0] === 0,
        "restart gives fresh lives, credits and score");
  check((await dom()) === null, "the game-over layer is gone");
  await page.screenshot({ path: join(SHOTS, "gameover-restarted.png") });

  // And again, to stage 1 -- this time with no credit, the other route.
  await killPlayer(true);
  s = await untilGameOverPhase(1);
  t = await untilFly(0x60);
  console.log("fly-over, no credit:", JSON.stringify(t));
  check(t.phase === 1 && !!t.body && t.body.drawn === 1
        && t.body.motion === 0x338,
        "with no credit the body falls on 0x338 too: the fly-over's "
        + "PlayerTasksCreate arms a player already at 6 again");
  await page.screenshot({ path: join(SHOTS, "gameover-fly-nocredit.png") });
  s = await untilGameOverPhase(3);
  check(s.app === 7, "a second game over");
  await page.click("#gameover-first");
  await page.mouse.move(-1, -1);
  await untilInPlay(1);
  await advance(60);
  s = await state();
  console.log("stage 1:", JSON.stringify(s));
  check(s.app === 6 && new URLSearchParams(s.search).get("stage") === "1",
        "stage 1 button plays stage 1");
  check(s.lives[0] > 0 && s.credits[0] > 0 && s.score[0] === 0,
        "stage 1 starts with fresh lives, credits and score");
  await page.screenshot({ path: join(SHOTS, "gameover-stage1.png") });
} catch (e) {
  failures.push(String(e));
  console.log(String(e));
} finally {
  await close();
}
console.log(failures.length ? `${failures.length} failed` : "all passed");
process.exit(failures.length ? 1 : 0);
