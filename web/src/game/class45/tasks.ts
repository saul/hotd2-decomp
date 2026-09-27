/**
 * The tasks class 0x45 allocates: its intro card, its sparks and splashes,
 * and variant 1's two scenery effects.
 *
 * Each is an `ActorAlloc` of its own in the engine, appended to the task list
 * and stepped where the walk reaches it; here each is a plain record in a `G`
 * pool, stepped by {@link Boss3TasksTick} after the actors, which is where an
 * appended task runs. Every one of them draws, and every draw is
 * `render/effects.ts`'s -- from the record, which carries everything the draw
 * reads. What is here is the rest: the cels, the flips, the lifetimes.
 */
import type { Events } from "../../core/events";
import { ActorByAt, G } from "../globals";
import {
  Boss3BodyState, type Boss3PathEffect, type Boss3Spark, type Boss3Splash,
} from "./state";
import {
  BOSS3_PATH_EFFECTS, BOSS3_SPARK_LAST_CEL, BOSS3_SPLASH_KIND0_END,
  BOSS3_SPLASH_KIND0_FIRST, BOSS3_SPLASH_KIND1_END, BOSS3_SPLASH_KIND1_FIRST,
  BOSS3_PATH_EFFECT_CELS,
} from "./tables";
import { PlaySoundId } from "./rand";

// -- the intro card ---------------------------------------------------------

/** Step 1 runs to frame `0x50`, step 2 to frame 300. */
const CARD_FLIP_END = 0x50;
const CARD_END = 300;
/** Eight pieces, the first six flipping: `CMP EDI, 0x6; JGE`. */
const CARD_PIECES = 8;
const CARD_FLIPPING = 6;
/** Piece `i` starts flipping on frame `5*i + 0xF`. */
const CARD_FLIP_START = 0xf;
const CARD_FLIP_STAGGER = 5;
/** `ADD EAX, 0xfffffd00` for piece 0, `0xfffffe00` for the rest; stop at `-0x8000`. */
const CARD_FLIP_FIRST = -0x300;
const CARD_FLIP_STEP = -0x200;
const CARD_FLIP_STOP = -0x8000;
/** The yaw a piece is re-stacked on, `CMP [ESI], 0xffffbe00`. */
const CARD_RESTACK = -0x4200;
/** The seeds: `0x3E3851EC`, `0xBD8F5C29`, `0x3CF5C28F`, and z from -1.0 by 0.01. */
const CARD_X = Math.fround(0.18);
const CARD_Y = Math.fround(-0.07);
const CARD_SCALE = Math.fround(0.03);
const CARD_STACK = Math.fround(0.01);
/** Step 2: `[0x004E30E0]` 0.005 off every piece but the boss's. */
const CARD_SHRINK = Math.fround(0.005);
/** The boss's piece, 6: to `[0x0055CB9C]` 0.06 by `[0x0055CB98]` 0.001, sliding. */
const CARD_BOSS_PIECE = 6;
const CARD_BOSS_SCALE = Math.fround(0.06);
const CARD_BOSS_GROW = Math.fround(0.001);
/** `[0x0055CB90]` 0.004 and `[0x0055CB88]` 0.002, both doubles. */
const CARD_BOSS_SLIDE_X = 0.004;
const CARD_BOSS_SLIDE_Y = 0.002;
/** The two sprites, and `[0x0055CB80]` -- a sixtieth -- for their fade. */
const CARD_SPRITE_A = 0xbc;
const CARD_SPRITE_B = 0xca;
const CARD_SPRITE_AX = 344;
const CARD_SPRITE_BX = 492;
const CARD_SPRITE_Y = 96;
const CARD_FADE = Math.fround(1 / 60);

/** `ActorAlloc(Boss3IntroCardUpdate, 0x13F4)` with step 0. `[port-only]` as a function. */
export function Boss3SpawnIntroCard(): void {
  G.g_boss3_intro_cards.push({ step: 0, frame: 0 });
}

/**
 * `Boss3IntroCardUpdate` — `FUN_00424900`. The stage-3 boss's own title --
 * not the shared banner, which this class never calls. Step 0 lays eight
 * card pieces out in camera space, `0.01` behind each other; step 1 flips the
 * first six over in turn, each re-stacked the frame it is edge-on, until
 * frame `0x50`; step 2 shrinks every piece but the boss's own card (piece 6)
 * to nothing, grows that one and slides it, and at frame 300 kills the task.
 * From frame `0x50` the two name sprites fade in over sixty frames. It
 * writes no flag and no shutter.
 *
 * Returns `false` on the frame it calls `ActorKill`, which skips the frame
 * counter's increment as the engine's `ActorKill` does.
 *
 * The pieces are drawn by `render/effects.ts` from `g_boss3_card_pieces`;
 * the page curl `CurlModelSlot3F7ByYaw` (`FUN_004759C0`) applies to them
 * during the flip is that layer's too.
 */
export function Boss3IntroCardUpdate(c: { step: number; frame: number }):
    boolean {
  const p = G.g_boss3_card_pieces;
  if (c.step === 0) {
    c.frame = 0;
    for (let i = 0; i < CARD_PIECES; i++) {
      p[i].x = CARD_X;
      p[i].y = CARD_Y;
      p[i].yaw = 0;
      p[i].scale = CARD_SCALE;
      p[i].z = Math.fround(-1 - i * CARD_STACK);
    }
    c.step += 1;
  } else if (c.step === 1 && c.frame !== CARD_FLIP_END) {
    for (let i = 0; i < CARD_PIECES; i++) {
      if (i >= CARD_FLIPPING) continue;
      if (c.frame < i * CARD_FLIP_STAGGER + CARD_FLIP_START) continue;
      let yaw = p[i].yaw + (i === 0 ? CARD_FLIP_FIRST : CARD_FLIP_STEP);
      if (yaw <= CARD_FLIP_STOP) yaw = CARD_FLIP_STOP;
      p[i].yaw = yaw;
      if (yaw === CARD_RESTACK) {
        p[i].z = Math.fround(-1 - (8 - i) * CARD_STACK);
      }
    }
  } else if (c.step === 1 || c.step === 2) {
    if (c.step === 1) c.step = 2;
    if (c.frame === CARD_END) return false;
    for (let i = 0; i < CARD_PIECES; i++) {
      if (i !== CARD_BOSS_PIECE) {
        p[i].scale = Math.fround(p[i].scale - CARD_SHRINK);
        if (p[i].scale <= 0) p[i].scale = 0;
      } else if (p[i].scale < CARD_BOSS_SCALE) {
        p[i].scale = Math.fround(p[i].scale + CARD_BOSS_GROW);
        p[i].x = Math.fround(p[i].x - CARD_BOSS_SLIDE_X);
        p[i].y = Math.fround(p[i].y + CARD_BOSS_SLIDE_Y);
      }
    }
  }
  if (c.step >= 2 && c.step <= 3 && c.frame >= CARD_FLIP_END) {
    let a = Math.fround((c.frame - CARD_FLIP_END) * CARD_FADE);
    if (!(a < 1)) a = 1;
    // `SpriteDrawCheckedBank` (`FUN_0041C630`) records with the anchor at the
    // top left, scale 1 -- `ScreenSpriteDraw`'s shape with flags 0.
    G.g_screen_sprite_draws.push(
      { id: CARD_SPRITE_A, x: CARD_SPRITE_AX, y: CARD_SPRITE_Y, depth: 1,
        sx: 1, sy: 1, alpha: a, flags: 0 },
      { id: CARD_SPRITE_B, x: CARD_SPRITE_BX, y: CARD_SPRITE_Y, depth: 1,
        sx: 1, sy: 1, alpha: a, flags: 0 });
  }
  c.frame += 1;
  return true;
}

// -- the spark --------------------------------------------------------------

/**
 * `Boss3SpawnBoneSpark` — `FUN_004247D0`. `ActorAlloc(Boss3SparkUpdate,
 * 0x50)` holding the actor, the bone and a cel of 0: a miss sparks on the
 * bone the shot entered.
 */
export function Boss3SpawnBoneSpark(at: number, bone: number): void {
  G.g_boss3_sparks.push({ at, bone, cel: 0, shown: 0, done: false });
}

/**
 * `Boss3SparkUpdate` — `FUN_004246F0`. Draws `common.bin` cel `0xE25 + cel`
 * at the bone's hit sphere, in camera space and sized by its depth (the
 * draw is `render/`'s), then steps the cel; past `0xE` it kills itself.
 */
export function Boss3SparkUpdate(s: Boss3Spark): boolean {
  if (s.done) return false;
  s.shown = s.cel;
  s.cel = ((s.cel + 1) << 16) >> 16;
  if (s.cel > BOSS3_SPARK_LAST_CEL) s.done = true;
  return true;
}

// -- the splash --------------------------------------------------------------

/**
 * `Boss3SpawnSplashAt` — `FUN_004248B0`. `ActorAlloc(Boss3SplashUpdate,
 * 0x50)` at a world point, `kind` 0 starting on slot `0x1339` and anything
 * else on `0x94`.
 */
export function Boss3SpawnSplashAt(x: number, y: number, z: number,
                                   kind: number): void {
  const slot = kind === 0 ? BOSS3_SPLASH_KIND0_FIRST : BOSS3_SPLASH_KIND1_FIRST;
  G.g_boss3_splashes.push({ x, y, z, kind, slot, shown: slot, done: false });
}

/**
 * `Boss3SplashUpdate` — `FUN_00424800`. Draws the slot (kind 0 scaled by 3,
 * kind 1 lifted 4.5 and stretched 2 high) and steps it; on reaching `0x1356`
 * or `0xA2` it kills itself.
 */
export function Boss3SplashUpdate(s: Boss3Splash): boolean {
  if (s.done) return false;
  s.shown = s.slot;
  s.slot = ((s.slot + 1) << 16) >> 16;
  if (s.slot === BOSS3_SPLASH_KIND0_END || s.slot === BOSS3_SPLASH_KIND1_END) {
    s.done = true;
  }
  return true;
}

// -- variant 1's scenery -------------------------------------------------------

/**
 * `Boss3SpawnMeshBulge` — `FUN_00424D90`. `ActorAlloc(Boss3MeshBulgeUpdate,
 * 0xA8)`: the step it was made on, a latch, and the ten piece positions
 * (`render/`'s constants).
 */
export function Boss3SpawnMeshBulge(): void {
  G.g_boss3_mesh_bulges.push({ step: G.g_evt_step_index, stopped: 0 });
}

/**
 * `Boss3MeshBulgeUpdate` — `FUN_00424C10`. Dies on `g_script_flags[4]`;
 * latches once the body (`g_boss3_heads[0]`) is dead; until then, while the
 * canal mesh's own flag allows, presses the canal's vertices near the body
 * down -- which is `render/`'s, from the body's point and this latch -- and
 * draws `st1_1.bin[35]` and ten `st3_tika_bos.bin` pieces.
 */
export function Boss3MeshBulgeUpdate(b: { stopped: number }): boolean {
  if (G.g_script_flags[4] === 1) return false;
  const body = ActorByAt(G.g_boss3_heads[0]);
  if (body && body.state === Boss3BodyState.Dead) b.stopped = 1;
  return true;
}

/**
 * `Boss3SpawnPathEffects` — `FUN_00424FE0`. `ActorAlloc(Boss3PathEffectUpdate,
 * 0x13F4)` with the step, row 0 and cel 0.
 */
export function Boss3SpawnPathEffects(): void {
  G.g_boss3_path_effects.push({ step: G.g_evt_step_index, row: 0, cel: 0,
                                shown: -1, shownRow: 0, shownAlpha: 1 });
}

/** `COMMON\ENE_WALK6_22`, every eighth path point inside a window. */
const SOUND_ENE_WALK6 = 0x2916a9;
/** A window stays drawn `0x14` path points past its end, fading by `[0x0055CBB8]`, 0.05. */
const PATH_EFFECT_TAIL = 0x14;
const PATH_EFFECT_FADE = Math.fround(0.05);

/**
 * `Boss3PathEffectUpdate` — `FUN_00424E10`. Variant 1's four effects along
 * the body's path, `g_boss3_path_effects` (`0x00589090`): dies with the
 * body; on the first lap skips (twice, at most) the rows marked for it;
 * inside a row's window of the body's path cursor it draws `eff_boss3.bin`
 * cel `0x1987 + cel` at the row's point -- fading out over the last `0x14`
 * points -- steps the cel through fifteen, plays `ENE_WALK6` on every eighth
 * point, and moves to the next row (of four, wrapping) on the window's last.
 */
export function Boss3PathEffectUpdate(e: Boss3PathEffect,
                                      events?: Events): boolean {
  const body = ActorByAt(G.g_boss3_heads[0]);
  if (!body || body.cls !== 0x45 || !body.boss3.block) return true;
  if (body.state === Boss3BodyState.Dead) return false;
  const blk = body.boss3.block;
  for (let k = 0; k < 2; k++) {
    if (blk.laps === 0 && BOSS3_PATH_EFFECTS[e.row]?.skipFirstLap === 1) {
      e.row += 1;
    }
  }
  e.shown = -1;
  const row = BOSS3_PATH_EFFECTS[e.row];
  if (!row) return true;
  const cur = blk.pathCursor;
  if (row.start <= cur && cur <= row.end + PATH_EFFECT_TAIL) {
    // `AssetDrawSlotWithAlpha(0x1987 + cel, (end - cur + 0x14) * 0.05)` past
    // the row's end, `AssetDrawSlot` before it -- `render/`'s, from these.
    e.shown = e.cel;
    e.shownRow = e.row;
    e.shownAlpha = row.end < cur
      ? Math.fround((row.end - cur + PATH_EFFECT_TAIL) * PATH_EFFECT_FADE) : 1;
    e.cel += 1;
    if (e.cel > BOSS3_PATH_EFFECT_CELS - 1) e.cel = 0;
    if ((cur & 7) === 0) PlaySoundId(SOUND_ENE_WALK6, events);
    if (cur >= row.end + PATH_EFFECT_TAIL) {
      e.row += 1;
      if (e.row > 3) e.row = 0;
    }
  }
  return true;
}

/**
 * `[port-only]` -- the class's task pools, stepped in creation order within
 * each and after the actors, which is where `ActorAlloc` appends.
 */
export function Boss3TasksTick(events?: Events): void {
  if (G.g_boss3_intro_cards.length) {
    G.g_boss3_intro_cards = G.g_boss3_intro_cards.filter(
      (c) => Boss3IntroCardUpdate(c));
  }
  if (G.g_boss3_sparks.length) {
    G.g_boss3_sparks = G.g_boss3_sparks.filter((s) => Boss3SparkUpdate(s));
  }
  if (G.g_boss3_splashes.length) {
    G.g_boss3_splashes = G.g_boss3_splashes.filter(
      (s) => Boss3SplashUpdate(s));
  }
  if (G.g_boss3_mesh_bulges.length) {
    G.g_boss3_mesh_bulges = G.g_boss3_mesh_bulges.filter(
      (b) => Boss3MeshBulgeUpdate(b));
  }
  if (G.g_boss3_path_effects.length) {
    G.g_boss3_path_effects = G.g_boss3_path_effects.filter(
      (e) => Boss3PathEffectUpdate(e, events));
  }
}
