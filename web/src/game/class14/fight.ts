/**
 * Class 0x14's fight: `g_class14_states[5..9]` and `[12..15]` -- the moves
 * the boss picks between, the leaps, the two repositions and the scripted
 * break that hands the camera to a `cp_` path.
 *
 * All `[proved]` from the decompilations, with the two-attacker arms read
 * from the instruction stream past the `MatrixStackPop` the pseudocode stops
 * at (L35): after the camera-space aim point the routine falls back into the
 * same turn and launch as the one-attacker arm.
 *
 * `g_camera_eye_x/z` (`0x009C71E0`/`+8`) is `ClassFrame.eye`, the camera the
 * frame runs with, as every other class reads it.
 */
import { EvtOpPlayDialogue2D } from "../dialogue";
import { ActorFlag, type Boss2Actor } from "../actor";
import { ActorPickTargetPlayer } from "../actor_target";
import {
  ActorHeadingErrorTo, ActorPointIsAhead, ActorTurnTowardXZ,
} from "../actor_turn";
import { BAMS_TO_RAD_F64 } from "../../core/bams";
import { ActorSetMotion, ActorSetMotionBlended } from "../class30/motion_cue";
import { WaterFieldSampleHeight } from "../class16";
import { QueryGroundHeightAt } from "../coli";
import { PlayerTakeDamage } from "../combat/player";
import { SpawnPropStripEffect, PropStripKind } from "../effects/prop_strip";
import { G } from "../globals";
import { CameraBlockYaw } from "../camera/view";
import type { GameHost } from "../host";
import {
  MatIdentity, MatrixRotateX, MatrixRotateY, MatrixRotateZ,
  MatrixTransformPoint, RADIANS_TO_BAMS, FtolS16,
} from "../matrix";
import type { CamPose } from "../camera/curve";
import type { ClassFrame } from "../registry";
import { vec3, type Vec3 } from "../vec";
import { OBJ_BIT_80000, Class14Flag, Class14Phase, Class14State,
  type Boss2Tail } from "./state";
import { Class14FollowSegment } from "./steer";
import {
  Class14BlendAnim, Class14ClipLength, Class14Cursor,
  Class14Integrate, Class14Sound as Sound,
} from "./motion";
import {
  CLASS14_FLAG_BREAK_A_DONE, CLASS14_FLAG_BREAK_A_OPEN,
  CLASS14_FLAG_BREAK_B_DONE, CLASS14_FLAG_BREAK_B_OPEN, CLASS14_TURN_STEP,
  Class14PhaseHpFrac, Class14Sound,
} from "./tables";

/** `Class14StateHunt`'s two rings and the heading it will not attack past. */
const STRIKE_RANGE = 55;
const LEAP_RANGE = 135;
const LEAP_HEADING = 0x1fff;
/** `Class14StateClose`'s arrival: the target inside 5 units, ahead. */
const CLOSE_RANGE = 5;
/** `target - dir * 50` — where `Close` and the deaths swim. */
const SWIM_BACK = 50;
/** The launch: `0x40800000` up, `0xBD8B60B6` gravity, the cursor it fires on. */
const LAUNCH_VY = 4;
const LEAP_GRAVITY = Math.fround(-0.068055555);
const CUE_LAUNCH = 0x23;
/** `[0x005691A8]` phase 9's lunge, `[0x0055D2A4]` every other leap. */
const LUNGE_SPEED_FINAL = Math.fround(-0.0074074073);
const LEAP_SPEED = Math.fround(-0.0076923077);
/** The cursor frames the pose freezes on, rising and landing. */
const CUE_FREEZE_RISE = 0x41;
const CUE_FREEZE_LAND = 0x55;
/** The landing: 22 above the ground, a tenth of the speed kept, 10 frames. */
const LAND_HEIGHT = 22;
const LAND_DAMP = Math.fround(0.1);
const LAND_HOLD = 10;
/** The bounce back: `x, z *= -2.5; y = 0.1`. */
const BOUNCE = -2.5;
const BOUNCE_VY = Math.fround(0.1);
/** `+0x94 = 7` every frame of a landing, and the reaction's window floor. */
const WINDOW_TOP = 7;
/** The two-attacker aim points, camera x: Lunge 2, Leap 3, LeapFromSide 3/5. */
const LUNGE_AIM = 2;
const LEAP_AIM = 3;
const SIDE_AIM_NEAR = 3;
const SIDE_AIM_FAR = 5;
/** `Class14StateReposition`/`LeapFromSide`: 65 / 60 either side of the route. */
const REPOSITION_OFFSET = 65;
const SIDE_LEAP_OFFSET = 60;
/** The splash strips' scales: `0x40900000` 4.5, `0x41000000` 8.0. */
const STRIP_SMALL = 4.5;
const STRIP_LARGE = 8;
/** `Class14StateScriptedBreak`: the cut's two `cp_` slots and its length. */
const BREAK_PATH_A = 0x6d;
const BREAK_PATH_B = 0x6c;
const BREAK_FRAMES = 0xa1;
const BREAK_BACK = 40;
/** Message groups 0x56 "Left." and 0x55 "Right." — the partner's call. */
const LINE_LEFT = 0x56;
const LINE_RIGHT = 0x55;
/** `obj+0x34` bits the leaps and strike clear on their way out. */
const LEAP_EXIT_BITS = ActorFlag.Committed | ActorFlag.NoHitReaction;

const GROUND_PROBE = 100;

function Ground(obj: Boss2Actor): number {
  return QueryGroundHeightAt(obj.pos.x,
    Math.fround(obj.pos.y + GROUND_PROBE), obj.pos.z);
}

/** `ActorTurnTowardXZ(xform, (target - dir*k) - pos, 0x200)`. */
function TurnTowardSwimPoint(obj: Boss2Actor, t: Boss2Tail, k: number): void {
  ActorTurnTowardXZ(obj,
    Math.fround((t.target.x - t.dir.x * k) - obj.pos.x),
    Math.fround((t.target.z - t.dir.z * k) - obj.pos.z), CLASS14_TURN_STEP);
}

/** A splash strip at the boss's own position, facing the camera block. */
function StripAt(p: Vec3, yaw: number, kind: PropStripKind, scale: number,
                 f: ClassFrame): void {
  SpawnPropStripEffect({ pos: vec3(p.x, p.y, p.z), pitch: 0, yaw, roll: 0 },
                       kind, scale, f.events);
}

/**
 * `Class14StateHunt` — `FUN_00478870`. `g_class14_states[5]`: pick the next
 * move by the phase and the distance to the camera.
 *
 * ```
 * sub 0: phase 0/3/8: anim 2 while hp > (frac + 1) * maxhp / 2,
 *                     else by rank: 15 -> 4, 0 -> 0, < 3 -> 3, else 5
 *        other phases: anim 5
 *        blend(0, 10); obj+0x34 &= ~0x100; sub++                  (into 1)
 * sub 1: ActorTurnTowardXZ(xform, x - eye.x, z - eye.z, 0x200)
 *        phase 0/3/8: within 55 -> state 8 (Strike)
 *        phase 2/9:   within 135 and |heading error| <= 0x1FFF -> state 9
 *        phase 5/6/7: the same test -> state 12
 *        and on any of the three: sub 0; ActorPickTargetPlayer
 * tail:  on motion 0x19 or 0x1A (anim slots 4, 5):
 *          still hunting: B shut -> hold 0, B open -> hold -1
 *          leaving:       B open -> hold 10
 * ```
 */
export function Class14StateHunt(obj: Boss2Actor, f: ClassFrame): void {
  // The gameplay eye, `g_camera_eye`, by address in the exe.
  const eye = G.g_camera_eye;
  const t = obj.boss2;
  if (t.sub === 0) {
    let slot: number;
    const ph = t.phase;
    if (ph === Class14Phase.ShortOpen || ph === Class14Phase.LongOpen
        || ph === Class14Phase.Stage5Open) {
      if ((Class14PhaseHpFrac(ph) + 1) * obj.maxHp * 0.5 < obj.hp) slot = 2;
      else if (t.rank === 0xf) slot = 4;
      else if (t.rank === 0) slot = 0;
      else if (t.rank < 3) slot = 3;
      else slot = 5;
    } else {
      slot = 5;
    }
    Class14BlendAnim(obj, t, slot);
    obj.flags &= ~ActorFlag.ShotImmune;
    t.sub += 1;
  }
  if (t.sub === 1) {
    // `g_camera_eye` by address, as every eye in this class is
    // (`0x00478993`..`0x00478B26`, `0x0047B550..562`): the gameplay eye.
    const dx = Math.fround(obj.pos.x - eye.x);
    const dz = Math.fround(obj.pos.z - eye.z);
    ActorTurnTowardXZ(obj, dx, dz, CLASS14_TURN_STEP);
    const d = Math.sqrt(dz * dz + dx * dx);
    let next: Class14State | null = null;
    switch (t.phase) {
      case Class14Phase.ShortOpen:
      case Class14Phase.LongOpen:
      case Class14Phase.Stage5Open:
        if (d < STRIKE_RANGE) next = Class14State.Strike;
        break;
      case Class14Phase.ShortFinal:
      case Class14Phase.Stage5Final:
      case Class14Phase.LongThird:
      case Class14Phase.LongFourth:
      case Class14Phase.LongFinal:
        if (d < LEAP_RANGE
            && Math.abs(ActorHeadingErrorTo(obj, dx, dz)) <= LEAP_HEADING) {
          next = (t.phase === Class14Phase.ShortFinal
                  || t.phase === Class14Phase.Stage5Final)
            ? Class14State.LungeAtCamera : Class14State.LeapAttack;
        }
        break;
      default:
        break;
    }
    if (next !== null) {
      t.state = next;
      t.sub = 0;
      obj.attackPermit = ActorPickTargetPlayer(f.rng);
    }
  }
  const m = obj.skel?.motion ?? obj.motion;
  if (m === 0x19 || m === 0x1a) {
    const B = t.bookB;
    if (t.state === Class14State.Hunt) {
      if (B.frame === B.low) B.hold = 0;
      else if (B.frame === B.high) B.hold = -1;
    } else if (B.frame === B.high) {
      B.hold = 10;
    }
  }
}

/**
 * `Class14StateClose` — `FUN_00478C00`. `g_class14_states[6]`.
 *
 * ```
 * sub 0: anim 0x19 in phases 2, 4, 5, 6, 7, 9, else 0x1A (blend); sub++  (into 1)
 * mode +0x9C == 0: L = (target - pos) through RotY(-yaw) RotZ(-roll) RotX(pitch)
 *                  L.z < 5: state 7 (Roar), sub 0, roars = 2
 *                  else swim toward target - dir * 50
 * mode +0x9C == 1: along the middle route edge (FollowSegment, step 10);
 *                  past it: state 15 (ScriptedBreak), sub 0
 * ```
 *
 * The local-frame test rotates by **`+pitch`**, not `-pitch`: the routine
 * pushes `obj+0x64` as it is. This boss's pitch is never written, so the
 * sign is the engine's and changes nothing.
 */
export function Class14StateClose(obj: Boss2Actor, f: ClassFrame): void {
  const t = obj.boss2;
  void f;
  if (t.sub === 0) {
    switch (t.phase) {
      case Class14Phase.ShortFinal:
      case Class14Phase.LongSecond:
      case Class14Phase.LongThird:
      case Class14Phase.LongFourth:
      case Class14Phase.LongFinal:
      case Class14Phase.Stage5Final:
        Class14BlendAnim(obj, t, 0x19);
        break;
      default:
        Class14BlendAnim(obj, t, 0x1a);
        break;
    }
    t.sub += 1;
  } else if (t.sub !== 1) {
    return;
  }
  if (t.counter0 === 0) {
    const m = MatIdentity();
    MatrixRotateY(m, -obj.yaw);
    MatrixRotateZ(m, -obj.roll);
    MatrixRotateX(m, obj.pitch);
    const L = vec3();
    MatrixTransformPoint(m, {
      x: Math.fround(t.target.x - obj.pos.x),
      y: Math.fround(t.target.y - obj.pos.y),
      z: Math.fround(t.target.z - obj.pos.z),
    }, L);
    if (L.z < CLOSE_RANGE) {
      t.state = Class14State.Roar;
      t.sub = 0;
      t.roars = 2;
      return;
    }
    TurnTowardSwimPoint(obj, t, SWIM_BACK);
    return;
  }
  if (t.counter0 !== 1) return;
  if (Class14FollowSegment(obj.pos, t.route[1], t.route[2], 10)) {
    TurnTowardSwimPoint(obj, t, SWIM_BACK);
    return;
  }
  t.state = Class14State.ScriptedBreak;
  t.sub = 0;
}

/**
 * `Class14StateRoar` — `FUN_00478E30`. `g_class14_states[7]`.
 *
 * ```
 * sub 0: anim 8 (blend); roars--; ZOMBIE_018; sub++                 (into 1)
 * sub 1: at len - 1 with a player in play: roars == 0 -> state 5, sub 0;
 *        else ZOMBIE_018 and roars--   -- the clip loops, one roar a pass
 * ```
 */
export function Class14StateRoar(obj: Boss2Actor, f: ClassFrame): void {
  const t = obj.boss2;
  if (t.sub === 0) {
    Class14BlendAnim(obj, t, 8);
    t.roars = ((t.roars - 1) << 16) >> 16;
    Sound(f.events, Class14Sound.Roar);
    t.sub += 1;
  } else if (t.sub !== 1) {
    return;
  }
  if (Class14Cursor(obj) === Class14ClipLength(obj) - 1
      && G.g_players_in_play > 0) {
    if (t.roars === 0) {
      t.state = Class14State.Hunt;
      t.sub = 0;
      return;
    }
    Sound(f.events, Class14Sound.Roar);
    t.roars = ((t.roars - 1) << 16) >> 16;
  }
}

/**
 * `Class14StateStrike` — `FUN_00478EE0`. `g_class14_states[8]`, the close
 * swipe.
 *
 * ```
 * sub 0: anim 0x15 (blend); obj+0x34 &= ~0x100; sub++               (into 1)
 * 0x1D < cursor < 0x38: yaw -= 0xC   -- the BOSS turns into the swipe;
 *        two attackers: -0x1C at player 0, +4 at player 1
 * cursor 0x37: obj+0x34 |= 0x2000     -- no reaction while it lands
 * cursor 0x3C: PlayerTakeDamage(+0x121, 1, 6); obj+0x34 &= ~0x2000;
 *              +0x94 = max(0, +0x94 - 1)
 * cursor len - 1: state 6; sub 0; +0x9C = 0; obj+0x34 &= ~0x10002000
 * ```
 */
export function Class14StateStrike(obj: Boss2Actor, f: ClassFrame): void {
  const t = obj.boss2;
  if (t.sub === 0) {
    Class14BlendAnim(obj, t, 0x15);
    obj.flags &= ~ActorFlag.ShotImmune;
    t.sub += 1;
  } else if (t.sub !== 1) {
    return;
  }
  const c = Class14Cursor(obj);
  if (0x1d < c && c < 0x38) {
    if (G.g_max_attackers === 2) {
      if (obj.attackPermit === 0) obj.yaw = (obj.yaw - 0x1c) | 0;
      else if (obj.attackPermit === 1) obj.yaw = (obj.yaw + 4) | 0;
    } else {
      obj.yaw = (obj.yaw - 0xc) | 0;
    }
  }
  if (c === 0x37) {
    obj.flags |= ActorFlag.NoHitReaction;
  } else if (c === 0x3c) {
    PlayerTakeDamage(obj.attackPermit, 1, 6, f.events, obj);
    obj.flags &= ~ActorFlag.NoHitReaction;
    t.timing = ((t.timing - 1) << 16) >> 16;
    if (t.timing < 0) t.timing = 0;
  } else if (c === Class14ClipLength(obj) - 1) {
    t.state = Class14State.Close;
    t.sub = 0;
    t.counter0 = 0;
    obj.flags &= ~LEAP_EXIT_BITS;
  }
}

/**
 * The two-attacker aim point: `g_camera_blocks[cam] * Translate(k, 0, 0)` --
 * `k` units along the camera's own x, in world space; the eye itself for a
 * permit that is neither player. `host.viewPoint` is that point.
 */
function AimPoint(obj: Boss2Actor, near: number, far: number,
                  host: GameHost, out: Vec3): void {
  const k = obj.attackPermit === 0 ? -near
    : obj.attackPermit === 1 ? far : 0;
  host.viewPoint(k, 0, 0, out);
}

const _aim = vec3();

/**
 * The launch the three leaps share, at `0x00479169..0x00479220`: speed
 * `hypot(x - eye.x, z - eye.z) * k` along the boss's own yaw, 4.0 up,
 * ENE_WALK7, from `g_camera_eye` by address (`0x0047914E`, `0x0047A3F6`,
 * `0x0047AB31`). `[port-only]` as a function; the engine has it three times.
 */
function Class14Launch(obj: Boss2Actor, k: number): void {
  const eye = G.g_camera_eye;
  const dz = obj.pos.z - eye.z;
  const dx = obj.pos.x - eye.x;
  const s = Math.sqrt(dz * dz + dx * dx) * k;
  const a = obj.yaw * BAMS_TO_RAD_F64;
  obj.vel.x = Math.fround(Math.sin(a) * s);
  obj.vel.y = LAUNCH_VY;
  obj.vel.z = Math.fround(Math.cos(a) * s);
  obj.accY = LEAP_GRAVITY;
}

/**
 * Subs 2..5 of `Class14StateLungeAtCamera` and `Class14StateLeapAttack`,
 * which are the same instructions twice (`0x0047921D..0x004794C5` and
 * `0x0047A3E6..0x0047A78C`). `[port-only]` as a function.
 *
 * ```
 * sub 2: cursor 0x41: freeze the pose (0x4000)
 *        falling: unfreeze; B.hold = (rand() % 4) * 8 + 1; sub++
 *        B.hold = (B shut) ? 1 : 0        -- overwrites the line above, every frame
 * sub 3: cursor 0x55: freeze; within 22 of the ground: PlayerTakeDamage(+0x121,
 *        1, 6); vel *= 0.1; g = 0; +0x9C = 10; +0x94 = max(0, +0x94 - 1); sub++
 *        +0x94 = 7                        -- every frame of sub 3
 * sub 4: +0x9C-- == 0: unfreeze; x, z *= -2.5; y = 0.1; g again; sub++
 * sub 5: under the ground: stop on it; len - 1: state 6, sub 0, +0x9C = 0,
 *        obj+0x34 &= ~0x10002000
 * ```
 */
function Class14LeapFinish(obj: Boss2Actor, f: ClassFrame): void {
  const t = obj.boss2;
  switch (t.sub) {
    case 2: {
      if (Class14Cursor(obj) === CUE_FREEZE_RISE) obj.flags |= ActorFlag.PoseFrozen;
      if (obj.vel.y < 0) {
        obj.flags &= ~ActorFlag.PoseFrozen;
        // `rand() & 0x80000003` -- `% 4` of a non-negative (L46).
        t.bookB.hold = f.rng.int(4) * 8 + 1;
        t.sub += 1;
      }
      t.bookB.hold = t.bookB.frame === t.bookB.low ? 1 : 0;
      break;
    }
    case 3:
      Class14LeapLand(obj, t, f);
      t.timing = WINDOW_TOP;
      break;
    case 4:
      Class14LeapBounce(obj, t);
      break;
    case 5:
      Class14LeapSettle(obj, t);
      break;
    default:
      break;
  }
}

/** Sub 3's landing, shared by the three leaps. `[port-only]` as a function. */
function Class14LeapLand(obj: Boss2Actor, t: Boss2Tail, f: ClassFrame): boolean {
  if (Class14Cursor(obj) === CUE_FREEZE_LAND) obj.flags |= ActorFlag.PoseFrozen;
  if (!(obj.pos.y < Ground(obj) + LAND_HEIGHT)) return false;
  PlayerTakeDamage(obj.attackPermit, 1, 6, f.events, obj);
  obj.vel.x = Math.fround(obj.vel.x * LAND_DAMP);
  obj.vel.y = Math.fround(obj.vel.y * LAND_DAMP);
  obj.vel.z = Math.fround(obj.vel.z * LAND_DAMP);
  obj.accY = 0;
  t.counter0 = LAND_HOLD;
  t.timing = ((t.timing - 1) << 16) >> 16;
  if (t.timing < 0) t.timing = 0;
  t.sub = 4;
  return true;
}

/** Sub 4's bounce back off the camera. `[port-only]` as a function. */
function Class14LeapBounce(obj: Boss2Actor, t: Boss2Tail): void {
  const v = t.counter0;
  t.counter0 = v - 1;
  if (v !== 0) return;
  obj.flags &= ~ActorFlag.PoseFrozen;
  obj.vel.x = Math.fround(obj.vel.x * BOUNCE);
  obj.vel.y = BOUNCE_VY;
  obj.vel.z = Math.fround(obj.vel.z * BOUNCE);
  obj.accY = LEAP_GRAVITY;
  t.sub += 1;
}

/** Sub 5: back on the ground and out. `[port-only]` as a function. */
function Class14LeapSettle(obj: Boss2Actor, t: Boss2Tail,
                           exitBits = LEAP_EXIT_BITS): void {
  if (obj.pos.y < Ground(obj)) {
    obj.accY = 0;
    obj.vel.z = 0;
    obj.vel.y = 0;
    obj.vel.x = 0;
    obj.pos.y = Math.fround(Ground(obj));
  }
  if (Class14Cursor(obj) === Class14ClipLength(obj) - 1) {
    t.state = Class14State.Close;
    t.sub = 0;
    t.counter0 = 0;
    obj.flags &= ~exitBits;
  }
}

/**
 * `Class14StateLungeAtCamera` — `FUN_00479030`. `g_class14_states[9]`, the
 * short-ladder and stage-5 attack.
 *
 * ```
 * sub 0: anim 0x17 (blend); obj+0x34 = obj+0x34 & ~0x2100 | 0x10000000;
 *        vel = 0; g = 0; sub++                                      (into 1)
 * sub 1: one attacker: turn toward x - eye;  two: toward x - aim(+-2)
 *        cursor 0x23: launch at k = phase 9 ? -0.0074074073 : -0.0076923077
 * subs 2..5: the landing (Class14LeapFinish)
 * all subs: unless state->flags & 4, pos += vel; vel.y += g
 * ```
 */
export function Class14StateLungeAtCamera(obj: Boss2Actor, f: ClassFrame): void {
  const t = obj.boss2;
  if (t.sub === 0) {
    Class14BlendAnim(obj, t, 0x17);
    obj.flags = (obj.flags & ~(ActorFlag.NoHitReaction | ActorFlag.ShotImmune))
      | ActorFlag.Committed;
    obj.accY = 0;
    obj.vel.z = 0;
    obj.vel.y = 0;
    obj.vel.x = 0;
    t.sub += 1;
  }
  if (t.sub === 1) {
    Class14LeapAim(obj, f, LUNGE_AIM, LUNGE_AIM);
    if (Class14Cursor(obj) === CUE_LAUNCH) {
      Class14Launch(obj, t.phase === Class14Phase.Stage5Final
        ? LUNGE_SPEED_FINAL : LEAP_SPEED);
      Sound(f.events, Class14Sound.Launch);
      t.sub += 1;
    }
  } else {
    Class14LeapFinish(obj, f);
  }
  Class14Integrate(obj, t);
}

/**
 * Sub 1's turn, one arm or the other: toward `x - eye` with one attacker,
 * toward `x - aim` with two, where the aim is `near`/`far` along the camera's
 * x for player 0/1. `[port-only]` as a function.
 */
function Class14LeapAim(obj: Boss2Actor, f: ClassFrame, near: number,
                        far: number): void {
  // The gameplay eye, `g_camera_eye`, by address in the exe.
  const eye = G.g_camera_eye;
  let tx = eye.x, tz = eye.z;
  if (G.g_max_attackers === 2) {
    AimPoint(obj, near, far, f.host, _aim);
    tx = _aim.x;
    tz = _aim.z;
  }
  ActorTurnTowardXZ(obj, Math.fround(obj.pos.x - tx),
                    Math.fround(obj.pos.z - tz), CLASS14_TURN_STEP);
}

/**
 * `Class14StateLeapAttack` — `FUN_0047A2E0`. `g_class14_states[12]`, the long
 * ladder's attack: `Class14StateLungeAtCamera` with motion `0x33`, no anim
 * slot, the aim at 3 rather than 2 and one speed.
 */
export function Class14StateLeapAttack(obj: Boss2Actor, f: ClassFrame): void {
  const t = obj.boss2;
  if (t.sub === 0) {
    ActorSetMotionBlended(obj, 0x33, 0, 10);
    obj.flags |= ActorFlag.Committed;
    obj.accY = 0;
    obj.vel.z = 0;
    obj.vel.y = 0;
    obj.vel.x = 0;
    obj.flags &= ~ActorFlag.ShotImmune;
    t.sub += 1;
  }
  if (t.sub === 1) {
    Class14LeapAim(obj, f, LEAP_AIM, LEAP_AIM);
    if (Class14Cursor(obj) === CUE_LAUNCH) {
      Class14Launch(obj, LEAP_SPEED);
      Sound(f.events, Class14Sound.Launch);
      t.sub += 1;
    }
  } else {
    Class14LeapFinish(obj, f);
  }
  Class14Integrate(obj, t);
}

/**
 * `Class14StateReposition` — `FUN_0047A7C0`. `g_class14_states[13]`, after
 * round B: the boss reappears 65 to one side of the route's middle.
 *
 * ```
 * sub 0: m = (route2.x + route1.x) * 0.5
 *        +0x9C == 0: set(0x38); x = m - 65   else set(0x39); x = m + 65
 *        yaw = (s16)ftol(atan2(-dir.x, -dir.z) * K); z = target.z
 *        y = ground; obj+0x34 &= ~0x84000; sub++
 * sub 1: len - 1: state 5; sub 0; obj+0x34 &= ~0x2100; state->flags &= ~1;
 *                 B.hold = 0
 *        cursor 10: obj+0x34 &= ~0x10000 (back on camera); a splash strip,
 *                   kind 0, 4.5, at the boss facing the camera block
 * ```
 */
export function Class14StateReposition(obj: Boss2Actor, f: ClassFrame): void {
  const t = obj.boss2;
  if (t.sub === 0) {
    const m = (t.route[2].x + t.route[1].x) * 0.5;
    if (t.counter0 === 0) {
      ActorSetMotion(obj, 0x38);
      obj.pos.x = Math.fround(m - REPOSITION_OFFSET);
    } else {
      ActorSetMotion(obj, 0x39);
      obj.pos.x = Math.fround(m + REPOSITION_OFFSET);
    }
    obj.yaw = FtolS16(Math.atan2(-t.dir.x, -t.dir.z) * RADIANS_TO_BAMS);
    obj.pos.z = t.target.z;
    obj.pos.y = Math.fround(Ground(obj));
    obj.flags &= ~(OBJ_BIT_80000 | ActorFlag.PoseFrozen);
    t.sub += 1;
    return;
  }
  if (t.sub !== 1) return;
  const c = Class14Cursor(obj);
  if (c === Class14ClipLength(obj) - 1) {
    t.state = Class14State.Hunt;
    t.sub = 0;
    obj.flags &= ~(ActorFlag.NoHitReaction | ActorFlag.ShotImmune);
    t.flags &= ~Class14Flag.OffRoute;
    t.bookB.hold = 0;
    return;
  }
  if (c === 10) {
    obj.flags &= ~ActorFlag.NoCameraTrack;
    StripAt(obj.pos, CameraBlockYaw(G.g_camera_index), PropStripKind.Kind0,
            STRIP_SMALL, f);
  }
}

/**
 * `Class14StateLeapFromSide` — `FUN_0047A990`. `g_class14_states[14]`, after
 * each scripted break: the boss leaps at the camera from 60 to one side.
 *
 * ```
 * sub 0: m as Reposition's; x = +0x9C == 0 ? m - 60 : m + 60
 *        blend(0x33, 0x23, 0) -- straight to the launch frame; z = target.z
 *        y = ground
 *        one attacker: yaw = (s16)ftol(atan2(x - eye.x, z - eye.z) * K)
 *        two: the aim point at player 0 -3/-5, player 1 +5/+3 (by +0x9C),
 *             yaw = (s16)ftol(atan2(x - aim.x, z - aim.z) * K)
 *        both: the launch at -0.0076923077 from the eye's distance;
 *              obj+0x34 = obj+0x34 & ~0x84000 | 0x10000000; sub++
 * sub 1: cursor 0x41: freeze / 0x28: a splash strip (kind 0, 4.5)
 *        / 0x2D: the partner calls the side (+0x9C == 0 ? "Left." : "Right."),
 *        obj+0x34 &= ~0x10000
 *        falling: obj+0x34 &= ~0x6100; B.hold = (rand() % 4) * 8 + 1; sub++
 * sub 2: B.hold == 0 and B shut: state->flags &= ~1 (route on); sub++  (into 3)
 * sub 3: the landing, straight to sub 4; +0x94 = 7
 * subs 4, 5: as the leaps', leaving with +0x9C = 0 and obj+0x34 &= ~0x10000000
 * all subs: unless state->flags & 4, pos += vel; vel.y += g
 * ```
 */
export function Class14StateLeapFromSide(obj: Boss2Actor, f: ClassFrame): void {
  // The gameplay eye, `g_camera_eye`, by address in the exe.
  const eye = G.g_camera_eye;
  const t = obj.boss2;
  switch (t.sub) {
    case 0: {
      const m = (t.route[2].x + t.route[1].x) * 0.5;
      obj.pos.x = Math.fround(t.counter0 === 0 ? m - SIDE_LEAP_OFFSET
        : m + SIDE_LEAP_OFFSET);
      ActorSetMotionBlended(obj, 0x33, CUE_LAUNCH, 0);
      obj.pos.z = t.target.z;
      obj.pos.y = Math.fround(Ground(obj));
      let tx = eye.x, tz = eye.z;
      if (G.g_max_attackers === 2) {
        const near = t.counter0 === 0 ? SIDE_AIM_NEAR : SIDE_AIM_FAR;
        const far = t.counter0 === 0 ? SIDE_AIM_FAR : SIDE_AIM_NEAR;
        AimPoint(obj, near, far, f.host, _aim);
        tx = _aim.x;
        tz = _aim.z;
      }
      obj.yaw = FtolS16(Math.atan2(obj.pos.x - tx, obj.pos.z - tz)
                        * RADIANS_TO_BAMS);
      Class14Launch(obj, LEAP_SPEED);
      obj.flags = (obj.flags & ~(OBJ_BIT_80000 | ActorFlag.PoseFrozen))
        | ActorFlag.Committed;
      t.sub += 1;
      break;
    }
    case 1: {
      const c = Class14Cursor(obj);
      if (c === CUE_FREEZE_RISE) {
        obj.flags |= ActorFlag.PoseFrozen;
      } else if (c === 0x28) {
        StripAt(obj.pos, CameraBlockYaw(G.g_camera_index), PropStripKind.Kind0,
                STRIP_SMALL, f);
      } else if (c === 0x2d) {
        // `EvtOpPlayDialogue2D` (`FUN_00435B80`) -- the same message groups
        // evt op 0x2D plays.
        EvtOpPlayDialogue2D(t.counter0 === 0 ? LINE_LEFT : LINE_RIGHT,
                            f.events);
        obj.flags &= ~ActorFlag.NoCameraTrack;
      }
      if (obj.vel.y < 0) {
        obj.flags &= ~(ActorFlag.PoseFrozen | ActorFlag.NoHitReaction
                       | ActorFlag.ShotImmune);
        t.bookB.hold = f.rng.int(4) * 8 + 1;
        t.sub += 1;
      }
      break;
    }
    case 2:
    case 3:
      if (t.sub === 2 && t.bookB.hold === 0
          && t.bookB.frame === t.bookB.low) {
        t.flags &= ~Class14Flag.OffRoute;
        t.sub += 1;
      }
      Class14LeapLand(obj, t, f);
      t.timing = WINDOW_TOP;
      break;
    case 4:
      Class14LeapBounce(obj, t);
      break;
    case 5:
      Class14LeapSettle(obj, t, ActorFlag.Committed);
      break;
    default:
      break;
  }
  Class14Integrate(obj, t);
}

const _pose: CamPose = { eye: vec3(), target: vec3(), roll: 0 };

/**
 * `CamEvalPath7(slot, (float)frame, &g_camera_block_eye,
 * &g_camera_block_target, &_, &_)` at `0x0047B21F`: the camera block straight
 * off a `cp_` path, the roll thrown away -- the call `BossIntroBannerUpdate`
 * makes, through the same host path. A host with no paths leaves the block
 * where it is.
 */
function Class14FlyCamera(slot: number, frame: number, host: GameHost): void {
  const path = host.camPath?.(slot) ?? null;
  if (!path) return;
  path.pose(frame, false, _pose);
  G.g_camera_block_eye.x = _pose.eye.x;
  G.g_camera_block_eye.y = _pose.eye.y;
  G.g_camera_block_eye.z = _pose.eye.z;
  G.g_camera_block_target.x = _pose.target.x;
  G.g_camera_block_target.y = _pose.target.y;
  G.g_camera_block_target.z = _pose.target.z;
}

/**
 * `Class14StateScriptedBreak` — `FUN_0047AF60`. `g_class14_states[15]`: the
 * boss dives, surfaces 40 back along the route facing the camera, and -- in
 * phases 6 and 7 -- takes the camera for a 161-frame `cp_` cut.
 *
 * ```
 * sub 0: blend(0x24, 0, 10); ENE_WALK7; sub++
 * sub 1: len - 1: +0xA4 = 10; obj+0x34 |= 0x14000; sub++   / cursor 10: |= 0x80000
 * sub 2: +0xA4-- == 0: y = WaterFieldSampleHeight(pos); x, z -= dir * 40
 *        a splash strip (kind 0, 8.0) facing the camera block;
 *        yaw = (s16)(-0x8000 - (s16)camera yaw); +0xA4 = 0x14; sub++
 * sub 3: +0xA4-- == 0: phase 4 -> state 11 (round B), sub 0; else sub++
 * sub 4: camera settled or free: g_camera_driver_held = 1;
 *        phase 6: flag 13 / phase 7: flag 15;
 *        +0x9C = rand() % 2 == 0 ? 0x6D : 0x6C; +0xA0 = 0; sub++
 * sub 5: +0xA0 == 0xA1: g_camera_driver_held = 0; phase 6: flag 14 / 7: flag 16;
 *        +0x9C = rand() % 2; state 14; sub 0; ActorPickTargetPlayer
 *        else CamEvalPath7(+0x9C, +0xA0, camera block); +0xA0++
 * ```
 *
 * While `g_camera_driver_held` is 1 `CameraDriverSelectMode` parks the
 * driver (mode 6), so nothing else moves the camera block and the boss's
 * writes stand -- the banner's arrangement.
 */
export function Class14StateScriptedBreak(obj: Boss2Actor, f: ClassFrame): void {
  const t = obj.boss2;
  switch (t.sub) {
    case 0:
      ActorSetMotionBlended(obj, 0x24, 0, 10);
      Sound(f.events, Class14Sound.Launch);
      t.sub += 1;
      return;
    case 1: {
      const c = Class14Cursor(obj);
      if (c === Class14ClipLength(obj) - 1) {
        t.counter2 = 10;
        obj.flags |= ActorFlag.NoCameraTrack | ActorFlag.PoseFrozen;
        t.sub += 1;
        return;
      }
      if (c === 10) obj.flags |= OBJ_BIT_80000;
      return;
    }
    case 2: {
      const v = t.counter2;
      t.counter2 = v - 1;
      if (v !== 0) return;
      obj.pos.y = Math.fround(WaterFieldSampleHeight(obj.pos));
      obj.pos.x = Math.fround(obj.pos.x - t.dir.x * BREAK_BACK);
      obj.pos.z = Math.fround(obj.pos.z - t.dir.z * BREAK_BACK);
      const yaw = CameraBlockYaw(G.g_camera_index);
      obj.yaw = ((-0x8000 - ((yaw << 16) >> 16)) << 16) >> 16;
      StripAt(obj.pos, yaw, PropStripKind.Kind0, STRIP_LARGE, f);
      t.counter2 = 0x14;
      t.sub += 1;
      return;
    }
    case 3: {
      const v = t.counter2;
      t.counter2 = v - 1;
      if (v !== 0) return;
      if (t.phase === Class14Phase.LongSecond) {
        t.state = Class14State.SummonRoundB;
        t.sub = 0;
        return;
      }
      t.sub += 1;
      return;
    }
    case 4:
      if (G.g_camera_settled !== 0 || G.g_camera_free !== 0) {
        G.g_camera_driver_held = 1;
        if (t.phase === Class14Phase.LongFourth) {
          G.g_script_flags[CLASS14_FLAG_BREAK_A_OPEN] = 1;
        } else if (t.phase === Class14Phase.LongFinal) {
          G.g_script_flags[CLASS14_FLAG_BREAK_B_OPEN] = 1;
        }
        // `rand() & 0x80000001` -- `% 2` of a non-negative (L46).
        t.counter0 = f.rng.int(2) === 0 ? BREAK_PATH_A : BREAK_PATH_B;
        t.counter1 = 0;
        t.sub += 1;
      }
      return;
    case 5:
      if (t.counter1 === BREAK_FRAMES) {
        G.g_camera_driver_held = 0;
        if (t.phase === Class14Phase.LongFourth) {
          G.g_script_flags[CLASS14_FLAG_BREAK_A_DONE] = 1;
        } else if (t.phase === Class14Phase.LongFinal) {
          G.g_script_flags[CLASS14_FLAG_BREAK_B_DONE] = 1;
        }
        t.counter0 = f.rng.int(2);
        t.state = Class14State.LeapFromSide;
        t.sub = 0;
        obj.attackPermit = ActorPickTargetPlayer(f.rng);
        return;
      }
      Class14FlyCamera(t.counter0, Math.fround(t.counter1), f.host);
      t.counter1 += 1;
      return;
    default:
      return;
  }
}

// `ActorPointIsAhead` is `Class14StateSummonRoundB`'s; re-exported so the
// summoning module takes every turn helper from one place.
export { ActorPointIsAhead };
