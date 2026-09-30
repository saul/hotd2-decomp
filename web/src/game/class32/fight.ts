/**
 * Class 0x32's fight: states 5..11.
 *
 * `g_class32_phases` walks the boss through five rounds as its hit points
 * fall: state 6 (hop to a point beside the camera, then cast), state 8
 * (circle the camera and lunge), 6 again, 8 again, and state 10, the final
 * barrage, until it dies. Each round's state writes its attack kind at
 * `obj+0x131A`, and a hit that crosses the round's floor -- or, in the
 * circling round, the hit that runs `obj+0x1368` out -- sends it to state 5,
 * which plays a reaction and returns it to the round it was in, or on to
 * the next.
 *
 * A **cast** (state 7) releases two or four projectiles from its hands on a
 * cue frame of its clip, which fly at the camera and hurt the player they
 * reach; the **lunge** (state 9) flies the boss at the camera itself, a
 * projectile held in its right hand, and hurts every attackable player on
 * arrival; the **barrage** (state 10) rises, gathers projectiles between its
 * hands one every fifteen frames and scatters them across the screen.
 */
import type { Boss5Actor } from "../actor";
import { ActorFlag } from "../actor";
import { ActorSetMotionBlended } from "../class30/motion_cue";
import { IsPlayerAttackable, PlayerTakeDamage } from "../combat/player";
import { G } from "../globals";
import { CameraBlockViewToWorld, CameraBlockWorldToView } from "../camera/view";
import { MatrixTransformPoint } from "../matrix";
import type { ClassFrame } from "../registry";
import { MotionPlayLength } from "../tables";
import { vec3 } from "../vec";
import {
  Class32AdjustRank, Class32ReleaseAttackPermit, Class32StopMoving,
  Class32TryClaimAttackPermit,
} from "./common";
import { Class32SpawnProjectile } from "./projectile";
import {
  Class32Attack, Class32Flag2, Class32ProjectileKind, Class32State,
} from "./state";
import {
  Class32BarrageRow, Class32CircleOffset, Class32HopFrames, Class32HopOffset,
  Class32Phase, Class32RankRow, Class32TailOf,
} from "./tables";
import {
  Class32SpawnAfterimage, Class32SpawnBodyLoopEffect, Class32SpawnHandsEffect,
} from "./tasks";

/** `PlaySoundId(0x1123A9)` -- the reaction. */
const SND_REACT = 0x1123a9;
/** `PlaySoundId(0xF23A9)` -- a hop, a circling move, the barrage's glide. */
const SND_MOVE = 0xf23a9;
/** `PlaySoundId(0x4817A9)` -- the lunge's last thirty frames, every other one. */
const SND_LUNGE = 0x4817a9;
/** `PlaySoundId(0xD23A9)` -- the lunge's arrival. */
const SND_STRIKE = 0xd23a9;
/** `PlaySoundId(0xB23A9)` and `(0xC23A9)` -- the barrage's rise and its cue. */
const SND_BARRAGE = 0xb23a9;
const SND_BARRAGE_CUE = 0xc23a9;

/** The clips. `ActorSetMotionBlended(clip, 0, 4)` unless said. */
const CLIP_REACT_LIGHT = 0x88;
const CLIP_REACT_HEAVY = 0x89;
const CLIP_RECOVER = 0x8d;
const CLIP_HOVER = 0x8e;
const CLIP_CAST_LEFT = 0x8c;
const CLIP_CAST_LEFT_ALT = 0x82;
const CLIP_CAST_RIGHT = 0x8b;
const CLIP_CAST_BOTH = 0x8a;
const CLIP_LUNGE = 0x84;
const CLIP_BARRAGE = 0x94;
const FADE = 4;

/** `IMUL 0x66666667; SAR EDX, 2` -- the floor is `(maxHp / 10) * floor`. */
const PHASE_DIVISOR = 10;
/** `obj+0x132C == 2` forces volley 0 and its alternative clip. Nothing writes 2. */
const CAST_MODE_ALT = 2;
/** `obj+0x1360` steps 0, 1, 2 and back: `CMP EAX, 2; JLE`. */
const VOLLEY_LAST = 2;
/** `obj+0x1354` steps round four points: below 0 to 3, above 3 to 0. */
const POINT_LAST = 3;

/** `FADD float ptr [0x004C4CB8]` -- the lunge aims 1.5 above the eye... */
const LUNGE_AIM_RISE = 1.5;
/** ...and `FSUB float ptr [0x005691B4]` -- 28.0 short of it, along the view. */
const LUNGE_SHORT = 28.0;
/** `CMP EAX, 0x1E; JGE` -- the lunge's sound, its last thirty frames. */
const LUNGE_SOUND_FRAMES = 0x1e;
/** `CMP [obj+0x19C], 0x19` -- the cursor the clip is re-set at `0x1A` on... */
const LUNGE_HOLD_AT = 0x19;
const LUNGE_HOLD_FROM = 0x1a;
/** ...with a fade of the frames left less `0x16`. */
const LUNGE_HOLD_TAIL = 0x16;
/** `PlayerTakeDamage(p, 1, 7)` -- the overlay kind. */
const STRIKE_OVERLAY = 7;
/** `Class32AdjustRank(obj, -3)` -- a player hurt. */
const RANK_HURT = -3;

/** `obj+0x13C0..0x13C8 = 0x44110000, 0xC0400000, 0xC6079400` -- the barrage's point. */
const BARRAGE_POINT = { x: 580.0, y: -3.0, z: -8677.0 };
/** `obj+0x1330 = 0x1E` -- the glide there; `0x96` the wait; `0x28` the glide back. */
const BARRAGE_GLIDE = 0x1e;
const BARRAGE_WAIT = 0x96;
const BARRAGE_RETURN = 0x28;
/** `obj+0x50 = 0x3E4CCCCD` -- 0.2 a frame, the rise. */
const BARRAGE_RISE = Math.fround(0.2);
/** `CMP [obj+0x19C], 0xA5` -- the cue; `0x95` the last frame of the hands effect. */
const BARRAGE_CUE = 0xa5;
const BARRAGE_HANDS_UNTIL = 0x95;
/** `g_frame_counter % 0x2D` -- no hands effect on the frames it divides... */
const BARRAGE_HANDS_SKIP = 0x2d;
/** ...and `g_frame_counter % 0xF == 1` -- one launch every fifteen. */
const BARRAGE_LAUNCH_EVERY = 0xf;
/** `ADD EAX, 3` with two players in play. */
const BARRAGE_TWO_PLAYER_AIMED = 3;
/** `obj+0x1312 = 3` -- sub 7 goes back to the rise. */
const BARRAGE_AGAIN = 3;

const _eye = vec3();
const _v = vec3();
const _w = vec3();

/** `[port-only]` `(maxHp / 10) * g_class32_phases[row].floor`, on the FPU. */
function PhaseFloor(obj: Boss5Actor, row: number): number {
  return Math.trunc(obj.maxHp / PHASE_DIVISOR) * Class32Phase(row)[1];
}

/** `[port-only]` The velocity that reaches `dest` in `frames`: `(dest - pos) / (float)frames`. */
function GlideTo(obj: Boss5Actor, frames: number): void {
  const d = obj.boss5.dest;
  obj.vel.x = Math.fround((d.x - obj.pos.x) / frames);
  obj.vel.y = Math.fround((d.y - obj.pos.y) / frames);
  obj.vel.z = Math.fround((d.z - obj.pos.z) / frames);
}

/** `[port-only]` The cursor the states read, `obj+0x19C` -- the model block's. */
function Cursor(obj: Boss5Actor): number {
  return obj.skel?.cursor ?? 0;
}

/** `[port-only]` `PlaySoundId(id)`: the port raises `sound.play`. */
function Play(f: ClassFrame, id: number): void {
  f.events?.emit("sound.play", { id });
}

/** `[port-only]` The afterimage cadence the three moving states share. */
function AfterimageStep(obj: Boss5Actor): void {
  const t = obj.boss5;
  t.afterimageCount += 1;
  const every = Class32TailOf(obj)?.afterimage_interval ?? 0;
  if (t.afterimageCount % every === 0) Class32SpawnAfterimage(obj);
}

/**
 * `Class32StateHitReaction` — `FUN_0047CA50`.
 *
 * ```
 * sub 0: k = (s8)obj+0x131A
 *        if (k >= 0 && (k <= 1 || k == 3)) {
 *            PlaySoundId(0x1123A9)
 *            ActorSetMotionBlended(hp >= floor(phase) ? 0x88 : 0x89, 0, 4)
 *        }
 *        obj+0x34 |= 0x40000000; Class32StopMoving; Class32ReleaseAttackPermit; sub++
 * sub 1: if (obj+0x19C <= play_length - 2) return
 *        ActorSetMotionBlended(0x8D, 0, 4); obj+0x34 &= ~0x40000000
 *        k == 0: state 6 sub 1;  k == 1: state 8 sub 1;  k == 3: state 10 sub 3
 *        if (hp < floor(phase)) { phase++; state = phases[phase].state; sub 0 }
 *        obj+0x131B = 0xFF
 * ```
 *
 * `obj+0x34` bit `0x40000000` is what bursts every projectile alive
 * (`Class32ProjectileDispatchAndDraw`). A kind outside 0, 1 and 3 keeps the
 * state and the sub; the only other kind is the death's `0xFF`, and the
 * death does not react.
 */
export function Class32StateHitReaction(obj: Boss5Actor, f: ClassFrame): void {
  const t = obj.boss5;
  if (obj.sub === 0) {
    const k = t.attack;
    if (k >= 0 && (k <= 1 || k === 3)) {
      Play(f, SND_REACT);
      ActorSetMotionBlended(obj, obj.hp >= PhaseFloor(obj, t.phase)
        ? CLIP_REACT_LIGHT : CLIP_REACT_HEAVY, 0, FADE);
    }
    obj.flags |= ActorFlag.Reacting;
    Class32StopMoving(obj);
    Class32ReleaseAttackPermit(obj);
    obj.sub += 1;
  } else if (obj.sub !== 1) {
    return;
  }
  if (Cursor(obj) <= MotionPlayLength(obj, obj.motion) - 2) return;
  ActorSetMotionBlended(obj, CLIP_RECOVER, 0, FADE);
  const k = t.attack;
  obj.flags &= ~ActorFlag.Reacting;
  if (k === Class32Attack.Hop) {
    obj.state = Class32State.HopNearCamera;
    obj.sub = 1;
  } else if (k === Class32Attack.Circle) {
    obj.state = Class32State.CircleCamera;
    obj.sub = 1;
  } else if (k === Class32Attack.Barrage) {
    obj.state = Class32State.FinalBarrage;
    obj.sub = BARRAGE_AGAIN;
  }
  if (obj.hp < PhaseFloor(obj, t.phase)) {
    t.phase += 1;
    obj.state = Class32Phase(t.phase)[0];
    obj.sub = 0;
  }
  t.interrupted = 0xff;
}

/**
 * `Class32StateHopNearCamera` — `FUN_0047D220`. The subs fall through.
 *
 * ```
 * 0: obj+0x131A = 0; obj+0x1350 = 0; obj+0x1354 = rand() % 4; sub++
 *    obj+0x1360 = -1; obj+0x138C = 0
 * 1: obj+0x34 &= ~0x100; ActorSetMotionBlended(0x8E, 0, 4)
 *    obj+0x1354 += 1 - 2*(rand() % 2); below 0 to 3, above 3 to 0
 *    dest = g_camera_eye + g_class32_hop_offsets[obj+0x1354]
 *    Class32StopMoving; obj+0x1330 = g_class32_hop_frames[rank]
 *    vel = (dest - pos) / obj+0x1330; PlaySoundId(0xF23A9); sub++
 * 2: if (++obj+0x133C % tail+0x19 == 0) Class32SpawnAfterimage(obj)
 *    if (--obj+0x1330 >= 1) return; Class32StopMoving; sub++
 * 3: if (Class32TryClaimAttackPermit(obj)) { state 7; sub 0 }
 * ```
 */
export function Class32StateHopNearCamera(obj: Boss5Actor, f: ClassFrame): void {
  const t = obj.boss5;
  let s = obj.sub;
  if (s === 0) {
    t.attack = Class32Attack.Hop;
    t.liveProjectiles = 0;
    t.hop = f.rng.int(4);
    obj.sub += 1;
    t.volley = -1;
    t.clock = 0;
    s = 1;
  }
  if (s === 1) {
    obj.flags &= ~ActorFlag.ShotImmune;
    ActorSetMotionBlended(obj, CLIP_HOVER, 0, FADE);
    t.hop = t.hop + 1 - 2 * f.rng.int(2);
    if (t.hop < 0) t.hop = POINT_LAST;
    if (t.hop > POINT_LAST) t.hop = 0;
    const o = Class32HopOffset(t.hop);
    const eye = G.g_camera_eye;
    t.dest.x = Math.fround(eye.x + o[0]);
    t.dest.y = Math.fround(eye.y + o[1]);
    t.dest.z = Math.fround(eye.z + o[2]);
    Class32StopMoving(obj);
    t.timer = Class32HopFrames(t.rank);
    GlideTo(obj, t.timer);
    Play(f, SND_MOVE);
    obj.sub += 1;
    s = 2;
  }
  if (s === 2) {
    AfterimageStep(obj);
    t.timer -= 1;
    if (t.timer >= 1) return;
    Class32StopMoving(obj);
    obj.sub += 1;
    s = 3;
  }
  if (s === 3) {
    if (Class32TryClaimAttackPermit(obj, f.rng, f.host)) {
      obj.state = Class32State.CastProjectiles;
      obj.sub = 0;
    }
  }
}

/**
 * `Class32StateCastProjectiles` — `FUN_0047D410`.
 *
 * ```
 * sub 0: v = obj+0x1360 + 1; obj+0x34 &= ~0x4100; obj+0x136C |= 1
 *        obj+0x1360 = v > 2 ? 0 : v; if (obj+0x132C == 2) obj+0x1360 = 0
 *        v 0: clip obj+0x132C == 2 ? 0x82 : 0x8C; projectiles 0, 0 (+ 0, 0 with two players)
 *        v 1: clip 0x8B; projectiles 1, 1 (+ 1, 1 with two players)
 *        v 2: clip 0x8A; projectiles 0, 0, 1, 1
 *        Class32ReleaseAttackPermit; sub++
 * sub 1: if (obj+0x19C < play_length - 2) return
 *        ActorSetMotionBlended(0x8E, 0, 4); sub++
 * sub 2: if (obj+0x1350 < 1) { state 6; sub 1 }
 * ```
 *
 * The projectiles gather at the hands and go when the clip reaches their
 * cue (`Class32ProjectileStateGather`). Nothing writes `obj+0x132C` but
 * `Class32StateMoveToFixedPoint`'s zero, so the `0x82` arm never plays.
 */
export function Class32StateCastProjectiles(obj: Boss5Actor): void {
  const t = obj.boss5;
  let s = obj.sub;
  if (s === 0) {
    const v = t.volley + 1;
    obj.flags &= ~(ActorFlag.PoseFrozen | ActorFlag.ShotImmune);
    obj.flags2 |= Class32Flag2.LaunchSound;
    t.volley = v;
    if (t.volley > VOLLEY_LAST) t.volley = 0;
    if (t.castMode === CAST_MODE_ALT) t.volley = 0;
    const two = G.g_players_in_play === 2;
    if (t.volley === 0) {
      ActorSetMotionBlended(obj, t.castMode === CAST_MODE_ALT
        ? CLIP_CAST_LEFT_ALT : CLIP_CAST_LEFT, 0, FADE);
      Class32SpawnProjectile(obj, Class32ProjectileKind.LeftHand);
      Class32SpawnProjectile(obj, Class32ProjectileKind.LeftHand);
      if (two) {
        Class32SpawnProjectile(obj, Class32ProjectileKind.LeftHand);
        Class32SpawnProjectile(obj, Class32ProjectileKind.LeftHand);
      }
    } else if (t.volley === 1) {
      ActorSetMotionBlended(obj, CLIP_CAST_RIGHT, 0, FADE);
      Class32SpawnProjectile(obj, Class32ProjectileKind.RightHand);
      Class32SpawnProjectile(obj, Class32ProjectileKind.RightHand);
      if (two) {
        Class32SpawnProjectile(obj, Class32ProjectileKind.RightHand);
        Class32SpawnProjectile(obj, Class32ProjectileKind.RightHand);
      }
    } else if (t.volley === 2) {
      ActorSetMotionBlended(obj, CLIP_CAST_BOTH, 0, FADE);
      Class32SpawnProjectile(obj, Class32ProjectileKind.LeftHand);
      Class32SpawnProjectile(obj, Class32ProjectileKind.LeftHand);
      Class32SpawnProjectile(obj, Class32ProjectileKind.RightHand);
      Class32SpawnProjectile(obj, Class32ProjectileKind.RightHand);
    }
    Class32ReleaseAttackPermit(obj);
    obj.sub += 1;
    s = 1;
  }
  if (s === 1) {
    if (Cursor(obj) < MotionPlayLength(obj, obj.motion) - 2) return;
    ActorSetMotionBlended(obj, CLIP_HOVER, 0, FADE);
    obj.sub += 1;
    s = 2;
  }
  if (s === 2) {
    if (t.liveProjectiles < 1) {
      obj.state = Class32State.HopNearCamera;
      obj.sub = 1;
    }
  }
}

/**
 * `Class32StateCircleCamera` — `FUN_0047D5E0`. The subs fall through.
 *
 * ```
 * 0: obj+0x131A = 1; obj+0x1354 = 0; obj+0x1360 = 0; obj+0x1338 = -1
 *    obj+0x138C = 0; sub++
 * 1: obj+0x34 |= 0x100; if (obj+0x1B4 != 0x8E) ActorSetMotionBlended(0x8E, 0, 4)
 *    if (!g_players_in_play) return
 *    Class32ReleaseAttackPermit; obj+0x135C = 0; obj+0x1358 = 1 - 2*(rand() % 2)
 *    obj+0x1368 = g_players_in_play == 1 ? 1 : 2; Class32AdjustRank(obj, 1); sub++
 * 2: obj+0x1354 += obj+0x1358; below 0 to 3, above 3 to 0
 *    dest = g_camera_eye + g_class32_circle_offsets[obj+0x1354]
 *    obj+0x1330 = g_class32_rank_rows[rank].circle_frames; Class32StopMoving
 *    vel = (dest - pos) / obj+0x1330; PlaySoundId(0xF23A9); sub++
 * 3: afterimage cadence; if (--obj+0x1330 >= 1) return
 *    Class32StopMoving; sub++; obj+0x1330 = .circle_hold
 * 4: if (--obj+0x1330 >= 1) return
 *    if (++obj+0x135C < .circle_laps) { sub = 2; return }  sub++
 * 5: if (Class32TryClaimAttackPermit(obj)) { state 9; sub 0 }
 * ```
 *
 * The hops are `ShotImmune` (`0x100`): the boss cannot be hurt while it
 * circles, only when it lunges -- the lunge clears the bit.
 */
export function Class32StateCircleCamera(obj: Boss5Actor, f: ClassFrame): void {
  const t = obj.boss5;
  let s = obj.sub;
  if (s === 0) {
    t.attack = Class32Attack.Circle;
    t.hop = 0;
    t.volley = 0;
    t.circleWord = -1;
    t.clock = 0;
    obj.sub += 1;
    s = 1;
  }
  if (s === 1) {
    obj.flags |= ActorFlag.ShotImmune;
    if (obj.motion !== CLIP_HOVER) {
      ActorSetMotionBlended(obj, CLIP_HOVER, 0, FADE);
    }
    if (G.g_players_in_play === 0) return;
    Class32ReleaseAttackPermit(obj);
    t.laps = 0;
    t.hopStep = 1 - 2 * f.rng.int(2);
    t.hitsToReact = G.g_players_in_play === 1 ? 1 : 2;
    Class32AdjustRank(obj, 1);
    obj.sub += 1;
    s = 2;
  }
  if (s === 2) {
    t.hop += t.hopStep;
    if (t.hop < 0) t.hop = POINT_LAST;
    if (t.hop > POINT_LAST) t.hop = 0;
    const o = Class32CircleOffset(t.hop);
    const eye = G.g_camera_eye;
    t.dest.x = Math.fround(eye.x + o[0]);
    t.dest.y = Math.fround(eye.y + o[1]);
    t.dest.z = Math.fround(eye.z + o[2]);
    t.timer = Class32RankRow(t.rank)[0];
    Class32StopMoving(obj);
    GlideTo(obj, t.timer);
    Play(f, SND_MOVE);
    obj.sub += 1;
    s = 3;
  }
  if (s === 3) {
    AfterimageStep(obj);
    t.timer -= 1;
    if (t.timer >= 1) return;
    Class32StopMoving(obj);
    const hold = Class32RankRow(t.rank)[1];
    obj.sub += 1;
    t.timer = hold;
    s = 4;
  }
  if (s === 4) {
    t.timer -= 1;
    if (t.timer >= 1) return;
    t.laps += 1;
    if (t.laps < Class32RankRow(t.rank)[2]) {
      obj.sub = 2;
      return;
    }
    obj.sub += 1;
    s = 5;
  }
  if (s === 5) {
    if (Class32TryClaimAttackPermit(obj, f.rng, f.host)) {
      obj.state = Class32State.LungeAtCamera;
      obj.sub = 0;
    }
  }
}

/**
 * `Class32StateLungeAtCamera` — `FUN_0047D890`.
 *
 * ```
 * sub 0: obj+0x34 = (obj+0x34 & ~0x100) | 0x10000000
 *        v = g_camera_world_to_view * (eye.x, eye.y + 1.5, eye.z)
 *        dest = g_camera_blocks[cam] * (v.x, v.y, v.z - 28.0)
 *        ActorSetMotionBlended(0x84, 0, 4)
 *        n = g_class32_rank_rows[rank].lunge_frames; Class32StopMoving
 *        obj+0x1330 = n; vel = (dest - pos) / n
 *        Class32SpawnProjectile(obj, 2); sub++
 * sub 1: n = --obj+0x1330; if (n < 0x1E && (g_frame_counter & 1)) PlaySoundId(0x4817A9)
 *        if (obj+0x19C == 0x19) ActorSetMotionBlended(0x84, 0x1A, obj+0x1330 - 0x16)
 *        if (obj+0x1330 > 0) return
 *        Class32StopMoving; PlaySoundId(0xD23A9)
 *        a0 = IsPlayerAttackable(0); if (a0 == 1) PlayerTakeDamage(0, 1, 7)
 *        a1 = IsPlayerAttackable(1); if (a1 == 1) PlayerTakeDamage(1, 1, 7)
 *        if (a0 == 1 || a1 == 1) Class32AdjustRank(obj, -3)
 *        sub++
 * sub 2: if (obj+0x19C >= play_length - 2) { state 8; sub 1; obj+0x34 &= ~0x10000000 }
 * ```
 *
 * The destination is the eye, 1.5 up, brought 28 units back toward the boss
 * along the camera's own axis -- right in the player's face. The clip is
 * re-set on its cursor `0x19` with a fade the length of what is left of the
 * approach, which holds its strike pose until the boss arrives. The strike
 * lands on every player the attack test lets through, on arrival, whether
 * the lunge was shot or not; only a reaction (state 5) stops it.
 */
export function Class32StateLungeAtCamera(obj: Boss5Actor, f: ClassFrame): void {
  const t = obj.boss5;
  let s = obj.sub;
  if (s === 0) {
    obj.flags = (obj.flags & ~ActorFlag.ShotImmune) | ActorFlag.Committed;
    const w2v = CameraBlockWorldToView(G.g_camera_index);
    const v2w = CameraBlockViewToWorld(G.g_camera_index);
    const eye = G.g_camera_eye;
    _eye.x = eye.x;
    _eye.y = Math.fround(eye.y + LUNGE_AIM_RISE);
    _eye.z = eye.z;
    MatrixTransformPoint(w2v, _eye, _v);
    t.dest.x = Math.fround(_v.x);
    t.dest.y = Math.fround(_v.y);
    t.dest.z = Math.fround(_v.z);
    _v.x = t.dest.x;
    _v.y = t.dest.y;
    _v.z = Math.fround(t.dest.z - LUNGE_SHORT);
    MatrixTransformPoint(v2w, _v, _w);
    t.dest.x = Math.fround(_w.x);
    t.dest.y = Math.fround(_w.y);
    t.dest.z = Math.fround(_w.z);
    ActorSetMotionBlended(obj, CLIP_LUNGE, 0, FADE);
    const n = Class32RankRow(t.rank)[3];
    Class32StopMoving(obj);
    t.timer = n;
    GlideTo(obj, n);
    Class32SpawnProjectile(obj, Class32ProjectileKind.Held);
    obj.sub += 1;
    s = 1;
  }
  if (s === 1) {
    t.timer -= 1;
    if (t.timer < LUNGE_SOUND_FRAMES && (G.g_frame_counter & 1) !== 0) {
      Play(f, SND_LUNGE);
    }
    if (Cursor(obj) === LUNGE_HOLD_AT) {
      ActorSetMotionBlended(obj, CLIP_LUNGE, LUNGE_HOLD_FROM,
                            t.timer - LUNGE_HOLD_TAIL);
    }
    if (t.timer > 0) return;
    Class32StopMoving(obj);
    Play(f, SND_STRIKE);
    const a0 = IsPlayerAttackable(0);
    if (a0) PlayerTakeDamage(0, 1, STRIKE_OVERLAY, f.events, obj);
    const a1 = IsPlayerAttackable(1);
    if (a1) PlayerTakeDamage(1, 1, STRIKE_OVERLAY, f.events, obj);
    if (a0 || a1) Class32AdjustRank(obj, RANK_HURT);
    obj.sub += 1;
    s = 2;
  }
  if (s === 2) {
    if (MotionPlayLength(obj, obj.motion) - 2 <= Cursor(obj)) {
      obj.state = Class32State.CircleCamera;
      obj.sub = 1;
      obj.flags &= ~ActorFlag.Committed;
    }
  }
}

/**
 * `Class32StateFinalBarrage` — `FUN_0047DD50`, states 10 and 11. The subs
 * fall through.
 *
 * ```
 * 0: obj+0x131A = 3; obj+0x34 |= 0x100; dest = (580.0, -3.0, -8677.0)
 *    obj+0x1330 = 0x1E; Class32StopMoving; vel = (dest - pos) / 30
 *    ActorSetMotionBlended(0x8D, 0, 4); PlaySoundId(0xF23A9)
 *    obj+0x136C |= 0x20; Class32SpawnBodyLoopEffect(obj); sub++
 * 1: afterimage cadence; if (--obj+0x1330 >= 1) return
 *    Class32StopMoving; ActorSetMotionBlended(0x8D, 0, 4); sub++; obj+0x1330 = 0x96
 * 2: if (!g_players_in_play) return; if (--obj+0x1330 >= 1) return
 *    obj+0x138C = 0; sub++; obj+0x34 &= ~0x100
 * 3: if (!g_players_in_play) return
 *    obj+0x50 = 0.2; ActorSetMotionBlended(0x94, 0, 4); PlaySoundId(0xB23A9)
 *    sub++; obj+0x1328 = 0
 * 4: if (obj+0x19C == 0xA5) { PlaySoundId(0xC23A9); Class32StopMoving; sub++ }
 *    else {
 *        if (obj+0x19C < 0x95 && g_frame_counter % 0x2D) Class32SpawnHandsEffect(obj)
 *        if (g_frame_counter % 0xF == 1 && obj+0x1350 < row.max_live) {
 *            n = row.aimed_count (+3 with two players)
 *            Class32SpawnProjectile(obj, n < ++obj+0x1328 ? 5 : 4)
 *        }
 *        return
 *    }
 * 5: if (obj+0x19C < play_length - 2) return
 *    if (obj+0x1B4 != 0x8D) ActorSetMotionBlended(0x8D, 0, 4)
 *    if (obj+0x1350 >= 1) return
 *    obj+0x1330 = 0x28; Class32StopMoving; sub++; vel = (dest - pos) / 40
 * 6: if (--obj+0x1330 >= 1) return; Class32StopMoving; sub++; obj+0x34 &= ~0x4000
 * 7: Class32AdjustRank(obj, 1); sub = 3
 * ```
 *
 * `row` is `g_class32_barrage_rows[rank]`. The rise in sub 3 is the one
 * velocity the class sets by hand; `Class32Update` integrates it until the
 * cue stops it.
 */
export function Class32StateFinalBarrage(obj: Boss5Actor, f: ClassFrame): void {
  const t = obj.boss5;
  let s = obj.sub;
  if (s === 0) {
    t.attack = Class32Attack.Barrage;
    obj.flags |= ActorFlag.ShotImmune;
    t.dest.x = BARRAGE_POINT.x;
    t.dest.y = BARRAGE_POINT.y;
    t.dest.z = BARRAGE_POINT.z;
    t.timer = BARRAGE_GLIDE;
    Class32StopMoving(obj);
    GlideTo(obj, t.timer);
    ActorSetMotionBlended(obj, CLIP_RECOVER, 0, FADE);
    Play(f, SND_MOVE);
    obj.flags2 |= Class32Flag2.BodyLoop;
    Class32SpawnBodyLoopEffect(obj);
    obj.sub += 1;
    s = 1;
  }
  if (s === 1) {
    AfterimageStep(obj);
    t.timer -= 1;
    if (t.timer >= 1) return;
    Class32StopMoving(obj);
    ActorSetMotionBlended(obj, CLIP_RECOVER, 0, FADE);
    obj.sub += 1;
    t.timer = BARRAGE_WAIT;
    s = 2;
  }
  if (s === 2) {
    if (G.g_players_in_play === 0) return;
    t.timer -= 1;
    if (t.timer >= 1) return;
    t.clock = 0;
    obj.sub += 1;
    obj.flags &= ~ActorFlag.ShotImmune;
    s = 3;
  }
  if (s === 3) {
    if (G.g_players_in_play === 0) return;
    obj.vel.y = BARRAGE_RISE;
    ActorSetMotionBlended(obj, CLIP_BARRAGE, 0, FADE);
    Play(f, SND_BARRAGE);
    obj.sub += 1;
    t.launches = 0;
    s = 4;
  }
  if (s === 4) {
    if (Cursor(obj) !== BARRAGE_CUE) {
      if (Cursor(obj) < BARRAGE_HANDS_UNTIL
          && G.g_frame_counter % BARRAGE_HANDS_SKIP !== 0) {
        Class32SpawnHandsEffect(obj, f.rng);
      }
      if (G.g_frame_counter % BARRAGE_LAUNCH_EVERY === 1) {
        const row = Class32BarrageRow(t.rank);
        if (t.liveProjectiles < row[2]) {
          let n = row[3];
          if (G.g_players_in_play === 2) n += BARRAGE_TWO_PLAYER_AIMED;
          t.launches += 1;
          Class32SpawnProjectile(obj, n < t.launches
            ? Class32ProjectileKind.BarrageWide : Class32ProjectileKind.Barrage);
        }
      }
      return;
    }
    Play(f, SND_BARRAGE_CUE);
    Class32StopMoving(obj);
    obj.sub += 1;
    s = 5;
  }
  if (s === 5) {
    if (Cursor(obj) < MotionPlayLength(obj, obj.motion) - 2) return;
    if (obj.motion !== CLIP_RECOVER) {
      ActorSetMotionBlended(obj, CLIP_RECOVER, 0, FADE);
    }
    if (t.liveProjectiles >= 1) return;
    t.timer = BARRAGE_RETURN;
    Class32StopMoving(obj);
    obj.sub += 1;
    GlideTo(obj, t.timer);
    s = 6;
  }
  if (s === 6) {
    t.timer -= 1;
    if (t.timer >= 1) return;
    Class32StopMoving(obj);
    obj.sub += 1;
    obj.flags &= ~ActorFlag.PoseFrozen;
    s = 7;
  }
  if (s === 7) {
    Class32AdjustRank(obj, 1);
    obj.sub = BARRAGE_AGAIN;
  }
}
