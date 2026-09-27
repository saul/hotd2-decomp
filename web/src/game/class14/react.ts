/**
 * Class 0x14's two hit reactions, `g_class14_states[16]` and `[17]`, which
 * `Class14ApplyBoneDamage` starts and which carry the three deaths: a
 * reaction whose boss has run out of hit points turns, on a cue frame, into
 * the death its phase names, and raises the flag the script is waiting on.
 *
 * Both `[proved]` from the decompilation.
 */
import { ActorFlag, type Boss2Actor } from "../actor";
import { ActorTurnTowardXZ } from "../actor_turn";
import { BAMS_TO_RAD_F64 } from "../../core/bams";
import { ActorSetMotionBlended } from "../class30/motion_cue";
import { QueryGroundHeightAt } from "../coli";
import { G } from "../globals";
import { RADIANS_TO_BAMS, FtolS16 } from "../matrix";
import type { ClassFrame } from "../registry";
import { Class14Phase, Class14State, type Boss2Tail } from "./state";
import {
  Class14BlendAnim, Class14ClipLength, Class14Cursor, Class14Integrate,
  Class14Sound as Sound,
} from "./motion";
import {
  CLASS14_FLAG_DEAD, CLASS14_FLAG_DEAD_STAGE5, CLASS14_TURN_STEP,
  Class14AnimMotion, Class14Sound,
} from "./tables";

/** `target - dir * 100` — where a reacting boss turns to face. */
const REACT_FACE_BACK = 100;
/** The reaction's own death cue, and the knock-down's. */
const CUE_DEATH_REACT = 0x14;
const CUE_DEATH_DOWN = 0x3c;
/** `Class14StateKnockedDown`: the launch speed and its gravity. */
const KNOCK_SPEED = 2.5;
const KNOCK_GRAVITY = Math.fround(-0.08166666);
/** The slow-played clips: ten frames, re-blended one cursor further each. */
const KNOCK_SPAN = 10;
const GROUND_PROBE = 100;
const LAND_DAMP = Math.fround(0.1);

function Ground(obj: Boss2Actor): number {
  return QueryGroundHeightAt(obj.pos.x,
    Math.fround(obj.pos.y + GROUND_PROBE), obj.pos.z);
}

/**
 * The death fork both reactions share -- `0x0047B424..0x0047B475` and
 * `0x0047BA2F..0x0047BA7D`, the same instructions twice:
 *
 * ```
 * phase 2: state 18 (DeathA); g_script_flags[17] = 1
 * phase 7: state 19 (DeathB); g_script_flags[17] = 1
 * phase 9: state 20 (DeathC); g_script_flags[31] = 1
 * sub = 0                                  ; in every phase
 * ```
 *
 * `[port-only]` as a function.
 */
function Class14DeathFork(t: Boss2Tail): void {
  if (t.phase === Class14Phase.ShortFinal) {
    t.state = Class14State.DeathA;
    G.g_script_flags[CLASS14_FLAG_DEAD] = 1;
  } else if (t.phase === Class14Phase.LongFinal) {
    t.state = Class14State.DeathB;
    G.g_script_flags[CLASS14_FLAG_DEAD] = 1;
  } else if (t.phase === Class14Phase.Stage5Final) {
    t.state = Class14State.DeathC;
    G.g_script_flags[CLASS14_FLAG_DEAD_STAGE5] = 1;
  }
  t.sub = 0;
}

/** `B.hold = ((rand() % 7) + 4) * 5` -- the window shut 20..50 frames. */
function Class14ReactionExitHold(t: Boss2Tail, f: ClassFrame): void {
  t.bookB.hold = (f.rng.int(7) + 4) * 5;
}

/** `if (B.frame == B.low) B.hold = -1` -- keep a shut window shut. */
function Class14HoldShut(t: Boss2Tail): void {
  if (t.bookB.frame === t.bookB.low) t.bookB.hold = -1;
}

/**
 * `Class14StateCuedMotion` — `FUN_0047B280`. `g_class14_states[16]`, the
 * reaction on the water.
 *
 * ```
 * sub 0: from round B: blend(0x29, 0, 10)
 *        else anim 10 (blend); with obj+0x34 & 0x20000, y = ground
 *        B.rate = -1.0; B.hold = 0; sub++                            (into 1)
 * sub 1: turn toward target - dir * 100
 *        len - 1: back to the saved state --
 *                   7 -> state 5, roars 0, sub 0
 *                   8, 9, 12, 14 -> state 6, sub 0, +0x9C = 0
 *                   10, 11 -> the saved state at the saved sub less one
 *                   else the saved state, sub 0
 *                 obj+0x34 &= ~0x40000000; B.hold = ((rand() % 7) + 4) * 5
 *        cursor 0x14 and dead: the death fork
 *        B shut: B.hold = -1
 * ```
 */
export function Class14StateCuedMotion(obj: Boss2Actor, f: ClassFrame): void {
  const t = obj.boss2;
  if (t.sub === 0) {
    if (t.savedState === Class14State.SummonRoundB) {
      ActorSetMotionBlended(obj, 0x29, 0, 10);
    } else {
      Class14BlendAnim(obj, t, 10);
      if (obj.flags & ActorFlag.Airborne) obj.pos.y = Math.fround(Ground(obj));
    }
    t.bookB.rate = -1;
    t.bookB.hold = 0;
    t.sub += 1;
  } else if (t.sub !== 1) {
    return;
  }
  ActorTurnTowardXZ(obj,
    Math.fround((t.target.x - t.dir.x * REACT_FACE_BACK) - obj.pos.x),
    Math.fround((t.target.z - t.dir.z * REACT_FACE_BACK) - obj.pos.z),
    CLASS14_TURN_STEP);
  const c = Class14Cursor(obj);
  if (c === Class14ClipLength(obj) - 1) {
    const s = t.savedState;
    switch (s) {
      case Class14State.Roar:
        t.state = Class14State.Hunt;
        t.roars = 0;
        t.sub = 0;
        break;
      case Class14State.Strike:
      case Class14State.LungeAtCamera:
      case Class14State.LeapAttack:
      case Class14State.LeapFromSide:
        t.state = Class14State.Close;
        t.sub = 0;
        t.counter0 = 0;
        break;
      case Class14State.SummonRoundA:
      case Class14State.SummonRoundB:
        t.state = s;
        t.sub = (t.savedSub - 1) & 0xff;
        break;
      default:
        t.state = s;
        t.sub = 0;
        break;
    }
    obj.flags &= ~ActorFlag.Reacting;
    Class14ReactionExitHold(t, f);
    return;
  }
  if (c === CUE_DEATH_REACT && (obj.flags & ActorFlag.Dead)) {
    Class14DeathFork(t);
  }
  Class14HoldShut(t);
}

/**
 * `state+0x62 = slot; v = +0x9C--; ActorSetMotionBlended(char, motion(slot),
 * +0xA0 - +0x9C, v)` -- the knock-down's slow play: re-blended every frame
 * one cursor further in with a fade one frame shorter, ten times.
 * `[port-only]` as a function.
 */
function Class14KnockStep(obj: Boss2Actor, t: Boss2Tail, slot: number): void {
  t.animSlot = slot;
  const v = t.counter0;
  t.counter0 = v - 1;
  ActorSetMotionBlended(obj, Class14AnimMotion(slot), t.counter1 - t.counter0,
                        v);
}

/**
 * `+0xA0 = 10; +0x9C = 10;` and the first step, and the landing's sound --
 * the roll's start at `0x0047B7F5` and `0x0047B917`. `[port-only]` as a
 * function.
 */
function Class14KnockRoll(obj: Boss2Actor, t: Boss2Tail): void {
  t.counter1 = KNOCK_SPAN;
  t.counter0 = KNOCK_SPAN;
  Class14KnockStep(obj, t, 0x10);
}

/**
 * `Class14StateKnockedDown` — `FUN_0047B4C0`. `g_class14_states[17]`, the
 * reaction in the air: knocked back off the camera, lands, rolls, gets up.
 *
 * ```
 * sub 0: +0xA0 = +0x9C = 10; step anim 0x14      ; cursor 1, fade 10
 *        pitch = (s16)ftol(atan2(y - eye.y, hypot(x - eye.x, z - eye.z)) * K)
 *        yaw   = (s16)ftol(atan2(x - eye.x, z - eye.z) * K)
 *        phase 2: vel.x, vel.z = cos(pitch) * dir * -2.5  -- back along the route
 *        else:    vel.x = sin(yaw) cos(pitch) 2.5; vel.z = cos(yaw) cos(pitch) 2.5
 *        vel.y = sin(pitch) 2.5; g = -0.08166666; B.rate = -1.0; B.hold = 0; sub++
 * sub 1: steps left: step anim 0x14; B shut: hold -1
 *        under the ground: x, z *= 0.1; g = vel.y = 0; y = ground
 *            pose frozen (it reached the clip's end): the roll -- step anim 0x10
 *                from 10, unfreeze, BOMB2 (phase 2) or DAMAGE4, sub 3, done
 *            else sub 2                                            (into 2)
 * sub 2: len - 1: still sub 1 (in the air): freeze the pose
 *                 else the roll, as above, sub 3
 *        B shut: hold -1
 * sub 3: steps left: step anim 0x1D;  cursor == len: vel.x, vel.z = 0;
 *        anim 0xD (blend 0, 10); sub 4;  B shut: hold -1
 * sub 4: len - 1: state 6; +0x9C = 0; sub 0; obj+0x34 &= ~0x40000000;
 *                 B.hold = ((rand() % 7) + 4) * 5
 *        cursor 0x3C and dead: the death fork
 * every sub: pos += vel; vel.y += g           -- no gate
 * ```
 *
 * The roll's first frame blends anim 0x10's motion and every later one
 * anim 0x1D's: sub 3 re-blends with slot 0x1D while the countdown runs, so
 * 0x10 is on screen for one frame. That is the engine's.
 */
export function Class14StateKnockedDown(obj: Boss2Actor, f: ClassFrame): void {
  const t = obj.boss2;
  switch (t.sub) {
    case 0: {
      t.counter1 = KNOCK_SPAN;
      t.counter0 = KNOCK_SPAN;
      Class14KnockStep(obj, t, 0x14);
      const dx = obj.pos.x - f.eye.x;
      const dz = Math.fround(obj.pos.z - f.eye.z);
      const dy = obj.pos.y - f.eye.y;
      const pitch = FtolS16(Math.atan2(dy, Math.sqrt(dx * dx + dz * dz))
                            * RADIANS_TO_BAMS);
      const yaw = FtolS16(Math.atan2(dx, dz) * RADIANS_TO_BAMS);
      const cp = Math.cos(pitch * BAMS_TO_RAD_F64);
      if (t.phase === Class14Phase.ShortFinal) {
        obj.vel.x = Math.fround(cp * t.dir.x * -KNOCK_SPEED);
        obj.vel.z = Math.fround(cp * t.dir.z * -KNOCK_SPEED);
      } else {
        const a = yaw * BAMS_TO_RAD_F64;
        obj.vel.x = Math.fround(Math.sin(a) * cp * KNOCK_SPEED);
        obj.vel.z = Math.fround(Math.cos(a) * cp * KNOCK_SPEED);
      }
      obj.vel.y = Math.fround(Math.sin(pitch * BAMS_TO_RAD_F64) * KNOCK_SPEED);
      obj.accY = KNOCK_GRAVITY;
      t.bookB.rate = -1;
      t.bookB.hold = 0;
      t.sub += 1;
      break;
    }
    case 1:
    case 2: {
      if (t.sub === 1) {
        if (t.counter0 !== 0) Class14KnockStep(obj, t, 0x14);
        Class14HoldShut(t);
        if (obj.pos.y < Ground(obj)) {
          obj.vel.x = Math.fround(obj.vel.x * LAND_DAMP);
          obj.vel.z = Math.fround(obj.vel.z * LAND_DAMP);
          obj.accY = 0;
          obj.vel.y = 0;
          obj.pos.y = Math.fround(Ground(obj));
          if (obj.flags & ActorFlag.PoseFrozen) {
            Class14KnockRoll(obj, t);
            obj.flags &= ~ActorFlag.PoseFrozen;
            Sound(f.events, t.phase === Class14Phase.ShortFinal
              ? Class14Sound.Bomb : Class14Sound.Damage);
            t.sub = 3;
            break;
          }
          t.sub = 2;
        }
      }
      if (Class14Cursor(obj) === Class14ClipLength(obj) - 1) {
        if (t.sub === 1) {
          obj.flags |= ActorFlag.PoseFrozen;
        } else {
          Class14KnockRoll(obj, t);
          Sound(f.events, t.phase === Class14Phase.ShortFinal
            ? Class14Sound.Bomb : Class14Sound.Damage);
          t.sub = 3;
        }
      }
      Class14HoldShut(t);
      break;
    }
    case 3:
      if (t.counter0 !== 0) Class14KnockStep(obj, t, 0x1d);
      if (Class14Cursor(obj) === Class14ClipLength(obj)) {
        obj.vel.z = 0;
        obj.vel.x = 0;
        Class14BlendAnim(obj, t, 0xd);
        t.sub = 4;
      }
      Class14HoldShut(t);
      break;
    case 4: {
      const c = Class14Cursor(obj);
      if (c === Class14ClipLength(obj) - 1) {
        t.state = Class14State.Close;
        t.counter0 = 0;
        t.sub = 0;
        obj.flags &= ~ActorFlag.Reacting;
        Class14ReactionExitHold(t, f);
        break;
      }
      if (c === CUE_DEATH_DOWN && (obj.flags & ActorFlag.Dead)) {
        Class14DeathFork(t);
      }
      break;
    }
    default:
      break;
  }
  Class14Integrate(obj, null);
}
