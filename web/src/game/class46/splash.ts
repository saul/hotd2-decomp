/**
 * The splash a shot bat leaves when its corpse reaches the water.
 *
 * `SpawnBatSplash` (`FUN_0042F980`) is five stores after an `ActorAlloc`: a
 * `0x50`-byte object whose per-frame routine is `BatSplashUpdate`
 * (`FUN_0042F930`), and whose whole state is a point and a frame.
 *
 * ```c
 * // SpawnBatSplash(x, y, z)
 * obj = ActorAlloc(BatSplashUpdate, 0x50);
 * obj+0x44 = 0;  obj+0x38 = x;  obj+0x3C = -25.0f;  obj+0x40 = z;
 *
 * // BatSplashUpdate(obj)
 * MatrixStackPush(0);
 * MatrixTranslate(obj+0x38, obj+0x3C, obj+0x40);
 * AssetDrawSlot(obj+0x44 + 0x1339);
 * MatrixStackPop(1);
 * if (++obj+0x44 > 0x1D) ActorKill();
 * ```
 *
 * `[proved]`, both from their disassembly (`0x0042F930`..`0x0042F979` and
 * `0x0042F980`..`0x0042F9AB`). Four things follow, and the port keeps all of
 * them:
 *
 * * **The caller's y is not read.** `obj+0x3C` is the literal `0xC1C80000`,
 *   -25.0, which is the plane both corpse falls test against; a corpse is
 *   somewhere under it by the time the call is made, and the splash sits on
 *   the plane regardless.
 * * **Translation and nothing else**: no rotation and no scale, so the model
 *   is drawn in the world's own axes at its authored size.
 * * **Thirty models, one a frame.** Slots `0x1339`..`0x1356` resolve to
 *   `pol/common.bin` entries 307..336 -- a flipbook, like every other effect
 *   in this game, because there is no texture animation anywhere in it.
 * * **The first frame is drawn on the frame the splash is made.** `ActorAlloc`
 *   (`FUN_004A6FA0`) appends the object to the list the bat is being walked
 *   from, and `TaskRunTree` (`FUN_004A71A0`) reads each task's `+0x1C` after
 *   running it, so the walk reaches the new object before the frame ends.
 *   Hence {@link BatSplashesTick} runs **after** the actors, as
 *   `Boss3TasksTick` does for class 0x45's own splashes.
 *
 * The sound is not here: `PlaySoundId(0x4616A9)` is the caller's, and the
 * swarm makes it only in stage 3. See `game/class46/index.ts`.
 *
 * The draw is `render/bat_splash.ts`'. This file is the state half: the
 * record, and the step the engine takes after it draws.
 */
import { G } from "../globals";

/** `obj+0x3C = 0xC1C80000` -- the y the splash is drawn at, whatever it is given. */
export const BAT_SPLASH_Y = -25.0;
/** `AssetDrawSlot(obj+0x44 + 0x1339)` -- `common.bin` 307. */
export const BAT_SPLASH_FIRST_SLOT = 0x1339;
/** `if (0x1D < obj+0x44) ActorKill()` -- the last frame drawn is `0x1D`. */
export const BAT_SPLASH_LAST_FRAME = 0x1d;

/**
 * One splash: the `0x50`-byte object, by its three fields.
 *
 * Plain data, so it goes into a snapshot as it is -- the reason it is a pool
 * in `G` and not an `Actor`: the engine's object has no class id, no
 * skeleton and none of `obj+0x100` onwards.
 */
export interface BatSplash {
  /** `[port-only]` -- the engine's identity is the task pointer. */
  id: number;
  /** `obj+0x38`, `obj+0x3C`, `obj+0x40` -- world space. */
  x: number;
  y: number;
  z: number;
  /** `obj+0x44` -- the frame the next update draws. */
  frame: number;
  /**
   * `[port-only]` -- the frame this update drew, which `render/` draws.
   * `-1` until the first update has run.
   */
  drawn: number;
  /**
   * `[port-only]` -- `ActorKill` ran at the end of this update. The record
   * stays for the frame it was killed on, because the engine had already
   * drawn that frame, and goes on the next tick.
   */
  done: boolean;
}

/**
 * `SpawnBatSplash` — `FUN_0042F980`.
 *
 * `y` is taken, as the engine's routine takes it, and not read.
 */
export function SpawnBatSplash(x: number, _y: number, z: number): void {
  G.g_bat_splashes.push({
    id: G.g_bat_splash_seq++,
    x, y: BAT_SPLASH_Y, z,
    frame: 0, drawn: -1, done: false,
  });
}

/**
 * `BatSplashUpdate` — `FUN_0042F930`, the step half of it.
 *
 * The draw is `AssetDrawSlot(BAT_SPLASH_FIRST_SLOT + frame)` under a bare
 * translation, and `render/bat_splash.ts` makes it from {@link BatSplash.drawn}.
 * Returns false once the object is gone.
 */
export function BatSplashUpdate(s: BatSplash): boolean {
  if (s.done) return false;
  s.drawn = s.frame;
  s.frame += 1;
  if (s.frame > BAT_SPLASH_LAST_FRAME) s.done = true;
  return true;
}

/** `[port-only]` — the pool step the engine gets from its task list. */
export function BatSplashesTick(): void {
  if (!G.g_bat_splashes.length) return;
  G.g_bat_splashes = G.g_bat_splashes.filter((s) => BatSplashUpdate(s));
}
