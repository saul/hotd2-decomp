/**
 * What a class-0x30 actor throws up when it strikes, or comes up, **in the
 * water**: the two water rings `SpawnWaterRing` (`FUN_004567C0`) lays at 1.0
 * and 0.5, a splash sprite, and `COMMON\SIBUKI2`.
 *
 * Three routines of the engine's, and one block it writes out twice:
 *
 * | routine | when | wet test | rings | sprite |
 * |---|---|---|---|---|
 * | `ZombieStrikeStartSplash` | the swing starts (and state 23's grab) | body condition 6, and the floor 20 units down is surface 5 or 0x37 | yes | 0x61, 0x62 in state 0x17 |
 * | `ZombieStrikeFrameSplash` | 0x14 play frames before the clip ends, once | the same, and `obj+0x136C` bit 0x10000 down | yes | 0x61 |
 * | the wading clip `0xB8` | play frames 0x15 and 0x1B | none: the clip is the test | at 0x1B only | 0x62, 1.5 ahead |
 *
 * The first two are `g_class30_states[0x39]` and `[0x3A]` -- `CALL dword ptr
 * [0x00592BCC]` and `[0x00592BD0]` -- so the states reach them through the
 * table, as they reach the death hooks at `[0x37]` and `[0x38]`
 * (`class30/death_effects.ts`). `[proved]` by the byte search for the two
 * slot addresses: `0x00592BCC` is read at `0x00455B69` (`ZombieStateStrike`)
 * and `0x00457C2D` (`ZombieStateScriptedGrabAndDespawn`), `0x00592BD0` at
 * `0x00455BED` alone.
 *
 * Every position here is the **traced floor** under the actor, not its own
 * y: the parameter block each routine hands `SpawnWaterRing` and
 * `SpawnSpriteEffect` is `{obj+0x40, ground, obj+0x48}`.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import type { ZombieActor } from "../actor";
import { ZombieFlag2 } from "../actor";
import { QueryGroundHeightAt } from "../coli";
import { SpawnSpriteEffect, SpriteEffectKind } from "../effects/sprite";
import { SpawnWaterRing } from "../effects/water_ring";
import { G } from "../globals";
import type { GameHost } from "../host";
import {
  MatIdentity, MatrixRotateY, MatrixTransformPoint, MatrixTranslate,
} from "../matrix";
import { MotionOf, MotionPlayFrame, MotionPlayLength } from "../tables";
import { vec3 } from "../vec";
import { TrackRootAtCursor } from "../root_motion";
import { SpawnBothAttachedEffects } from "../effects/attached_effect";
import { ZombieState } from "./states";
import { Zombie1368Flag } from "./state";

/** `CMP dword ptr [ESI+0x130C], 0x6` -- the body condition that wades. */
export const COND_WADING = 6;
/** `FADD [0x004C4C8C]` -- 20.0, where every trace here starts. */
const SPLASH_PROBE_RISE = 20.0;
/** `CMP EAX, 0x37` / `CMP EAX, 0x5` on `g_coli_hit_surface` -- the water. */
const SURFACE_WATER = 5;
const SURFACE_WATER_ALT = 0x37;
/** `PUSH 0x3F800000` / `PUSH 0x3F000000` -- the two rings' sizes. */
export const SPLASH_RING_BIG = 1.0;
export const SPLASH_RING_SMALL = 0.5;
/** `PUSH 0x4116A9` -- `COMMON\SIBUKI2`. */
export const SND_WADE_SPLASH = 0x4116a9;
/** `PUSH 0x1; PUSH -0x1` -- face the camera, no player. */
const FACE_CAMERA = 1;
const NO_PLAYER = -1;
/**
 * `SUB ECX, 0x14` at `0x00456D49`: the frame splash fires 0x14 play frames
 * before `g_motion_play_length[obj+0x1B4]`.
 */
export const STRIKE_FRAME_SPLASH_LEAD = 0x14;
/** The wading clip, and the two play frames it splashes on. */
export const WADE_MOTION = 0xb8;
export const WADE_SPLASH_FRAME = 0x15;
export const WADE_SPLASH_RING_FRAME = 0x1b;
/**
 * `MOV [ESP+..], 0xBFC00000` -- the wading splash stands at `(0, 0, -1.5)`
 * in the actor's own frame, 1.5 units ahead of it.
 */
export const WADE_SPLASH_AHEAD = -1.5;

const _p = vec3();
const _q = vec3();

function onWater(): boolean {
  return G.g_coli_hit_surface === SURFACE_WATER_ALT
      || G.g_coli_hit_surface === SURFACE_WATER;
}

/**
 * `ZombieStrikeStartSplash` — `FUN_00456C50`, `g_class30_states[0x39]`.
 *
 * ```
 * 00456c58  if (obj+0x130C != 6) return
 * 00456c92  g = QueryGroundHeightAt(x, y + 20, z)
 * 00456ca3  if (g_coli_hit_surface != 0x37 && != 5) return
 * 00456cad  PlaySoundId(0x4116A9)
 * 00456cc1  SpawnWaterRing({x, g, z}, 1.0); SpawnWaterRing({x, g, z}, 0.5)
 * 00456cd8  SpawnSpriteEffect({x, g, z}, state == 0x17 ? 0x62 : 0x61, 1, -1)
 * ```
 *
 * `[proved]` from the disassembly, which is where the block's second word --
 * the trace, `FSTP [ESP+0xC]` at `0x00456C9F` -- has to be read: the three
 * floats handed to all three spawns are `x`, the floor, `z`.
 */
export function ZombieStrikeStartSplash(obj: ZombieActor, rng: Rng,
                                        host?: GameHost,
                                        events?: Events): void {
  if (obj.condition !== COND_WADING) return;
  const g = QueryGroundHeightAt(obj.pos.x, obj.pos.y + SPLASH_PROBE_RISE,
                                obj.pos.z);
  if (!onWater()) return;
  events?.emit("sound.play", { id: SND_WADE_SPLASH });
  const at = vec3(obj.pos.x, g, obj.pos.z);
  SpawnWaterRing(at, SPLASH_RING_BIG, rng);
  SpawnWaterRing(at, SPLASH_RING_SMALL, rng);
  const kind = obj.state === ZombieState.ScriptedGrabAndDespawn
    ? SpriteEffectKind.SplashLarge : SpriteEffectKind.Splash;
  SpawnSpriteEffect(at, 0, 0, kind, FACE_CAMERA, NO_PLAYER, host, events);
}

/**
 * `ZombieStrikeFrameSplash` — `FUN_00456D10`, `g_class30_states[0x3A]`.
 * `ZombieStateStrike` calls it on every frame of its swing.
 *
 * ```
 * 00456d18  if (obj+0x136C & 0x10000) return
 * 00456d28  if (obj+0x130C != 6) return
 * 00456d35  if (obj+0x19C != g_motion_play_length[obj+0x1B4] - 0x14) return
 * 00456d69  g = QueryGroundHeightAt(x, y + 20, z)
 * 00456d76  if (g_coli_hit_surface != 0x37 && != 5) return
 * 00456d9c  SpawnWaterRing({x, g, z}, 1.0); SpawnWaterRing({x, g, z}, 0.5)
 * 00456dbb  SpawnSpriteEffect({x, g, z}, 0x61, 1, -1)
 * 00456dcb  obj+0x136C |= 0x10000; PlaySoundId(0x4116A9)
 * ```
 *
 * `[proved]`. The latch is {@link ZombieFlag2.OneShotFired}, the bit
 * `ZombieStateStrike` takes down as the swing starts (`0x00455B77`), so this
 * fires at most once a swing -- and only on the wet arm, which is the only
 * one that raises it. The sound comes **after** the sprite here and before
 * the rings in the start splash.
 *
 * `obj+0x19C` and `obj+0x1B4` are the one track's cursor and clip. The port
 * plays the swing on the one-shot channel, so while one is up it is that
 * clip's cursor this reads -- the same reading `ZombieStateStrike`'s own hit
 * and end tests make.
 */
export function ZombieStrikeFrameSplash(obj: ZombieActor, rng: Rng,
                                        host?: GameHost,
                                        events?: Events): void {
  if (obj.flags2 & ZombieFlag2.OneShotFired) return;
  if (obj.condition !== COND_WADING) return;
  const motion = obj.action ? obj.action.motion : obj.motion;
  const cursor = obj.action ? obj.action.ticks : obj.playTicks;
  if (cursor !== MotionPlayLength(obj, motion) - STRIKE_FRAME_SPLASH_LEAD) {
    return;
  }
  const g = QueryGroundHeightAt(obj.pos.x, obj.pos.y + SPLASH_PROBE_RISE,
                                obj.pos.z);
  if (!onWater()) return;
  const at = vec3(obj.pos.x, g, obj.pos.z);
  SpawnWaterRing(at, SPLASH_RING_BIG, rng);
  SpawnWaterRing(at, SPLASH_RING_SMALL, rng);
  SpawnSpriteEffect(at, 0, 0, SpriteEffectKind.Splash, FACE_CAMERA, NO_PLAYER,
                    host, events);
  obj.flags2 |= ZombieFlag2.OneShotFired;
  events?.emit("sound.play", { id: SND_WADE_SPLASH });
}

/**
 * `obj+0x204` -- `model+0x70`, the root's height as the draw just posed it.
 *
 * `[port-only]`. `SkeletonPoseRootFrame` (`FUN_00410920`) writes
 * `model+0x6C..0x74` on every draw -- the track's root at its cursor, between
 * two authored frames on an odd one, lerped from the fade's snapshot by the
 * fade's weight while one holds -- and `ActorCheckWaterEntry` runs after that
 * draw. The port has no model block for this class, so the same number is
 * worked out of the clip the way the renderer poses it: the one-shot's while
 * one runs, the base track's otherwise, and slot B's clip under a fade whose
 * clip was stored over ({@link Actor.fadeInto}).
 */
function ZombiePoseRootHeight(obj: ZombieActor): number {
  const act = obj.action;
  const into = act ? null : obj.fadeInto;
  const motion = act ? act.motion : into ? into.motion : obj.motion;
  const m = MotionOf(obj, motion);
  if (!m) return 0;
  const play = MotionPlayLength(obj, motion);
  const cursor = act ? act.ticks : into ? into.ticks : MotionPlayFrame(obj);
  TrackRootAtCursor(m, play, cursor, _root);
  const fade = obj.fadeFrom;
  if (!fade || obj.fade <= 0 || obj.fadeLen <= 0) return _root.y;
  let from = fade.root?.y;
  if (from === undefined) {
    const fm = MotionOf(obj, fade.motion);
    if (!fm) return _root.y;
    TrackRootAtCursor(fm, MotionPlayLength(obj, fade.motion), fade.ticks, _from);
    from = _from.y;
  }
  const w = Math.min(1, Math.max(0, 1 - obj.fade / obj.fadeLen));
  return from + (_root.y - from) * w;
}

const _root = vec3();
const _from = vec3();

/**
 * `ActorCheckWaterEntry` — `FUN_00456920`, `g_class30_states[0x36]`, called
 * through the table from `EnemyZombieUpdate` (`CALL dword ptr [0x00592BC0]`
 * at `0x00453480`) after the draw, every frame of every class-0x30 and
 * class-0x18 actor.
 *
 * ```
 * 00456925  if (obj+0x1368 & 2) return                       ; once a life
 * 00456943  g = QueryGroundHeightAt(x, y + 20, z)
 * 00456954  if (g_coli_hit_surface != 0x37 && != 5) return   ; not water
 * 0045695e  if (!(y < g)) return                              ; not under it
 * 0045696c  if (obj+0x130C != 6 && !(obj+0x204 + y > g)) return
 * 00456993  SpawnBothAttachedEffects(obj, g, obj+0x68)
 * 004569a1  obj+0x1368 |= 2
 * ```
 *
 * `[proved]`. An actor whose feet are under a water surface gets its wake
 * once: body condition 6, the wading one, as soon as it is under at all; any
 * other only while its root -- its hips, `obj+0x204` -- is still above the
 * surface. {@link Zombie1368Flag.InWater} is also what silences
 * `ZombiePlayMotionFrameSe` from then on.
 */
export function ActorCheckWaterEntry(obj: ZombieActor): void {
  if (obj.zom.flags1368 & Zombie1368Flag.InWater) return;
  const g = Math.fround(QueryGroundHeightAt(
    obj.pos.x, obj.pos.y + SPLASH_PROBE_RISE, obj.pos.z));
  if (!onWater()) return;
  if (!(obj.pos.y < g)) return;
  if (obj.condition !== COND_WADING
      && !(ZombiePoseRootHeight(obj) + obj.pos.y > g)) return;
  SpawnBothAttachedEffects(obj, g, obj.yaw);
  obj.zom.flags1368 |= Zombie1368Flag.InWater;
}

/**
 * The wading clip's splash: the same forty instructions at
 * `0x00456FF3`..`0x004570E6` in `ZombieStateSurfaceOnCameraCue`
 * (`FUN_00456F50`) and at `0x0045AC1C`..`0x0045AD0E` in
 * `ZombieStateTargetMotionScript` (`FUN_0045AAA0`), both behind
 * `obj+0x1B4 == 0xB8`:
 *
 * ```
 * if (obj+0x19C == 0x15 || obj+0x19C == 0x1B) {
 *     g = QueryGroundHeightAt(x, y + 20, z);
 *     if (obj+0x19C == 0x1B) {
 *         SpawnWaterRing({x, g, z}, 1.0); SpawnWaterRing({x, g, z}, 0.5);
 *     }
 *     Push; Identity; Translate(x, g, z); RotY(obj+0x68);
 *     p = MatrixTransformPoint((0, 0, -1.5)); Pop;       // past L35's pop
 *     SpawnSpriteEffect(p, 0x62, 1, -1);
 * }
 * ```
 *
 * `[proved]`, with the rings' block and the sprite's both read off the
 * listing: the rings sit on the traced floor under the actor, the splash 1.5
 * units ahead of it at the same height. **No surface test**: the clip is only
 * ever played in the water.
 *
 * `[port-only]` as a function -- the engine has the block twice inline, and
 * two copies of it here would be two places for one to drift. `cursor` is
 * the caller's `obj+0x19C`.
 */
export function ZombieWadeSplash(obj: ZombieActor, cursor: number, rng: Rng,
                                 host?: GameHost, events?: Events): void {
  if (cursor !== WADE_SPLASH_FRAME && cursor !== WADE_SPLASH_RING_FRAME) return;
  const g = QueryGroundHeightAt(obj.pos.x, obj.pos.y + SPLASH_PROBE_RISE,
                                obj.pos.z);
  if (cursor === WADE_SPLASH_RING_FRAME) {
    const at = vec3(obj.pos.x, g, obj.pos.z);
    SpawnWaterRing(at, SPLASH_RING_BIG, rng);
    SpawnWaterRing(at, SPLASH_RING_SMALL, rng);
  }
  const m = MatIdentity();
  MatrixTranslate(m, obj.pos.x, g, obj.pos.z);
  MatrixRotateY(m, obj.yaw);
  _p.x = 0; _p.y = 0; _p.z = WADE_SPLASH_AHEAD;
  MatrixTransformPoint(m, _p, _q);
  SpawnSpriteEffect(vec3(_q.x, _q.y, _q.z), 0, 0, SpriteEffectKind.SplashLarge,
                    FACE_CAMERA, NO_PLAYER, host, events);
}
