/**
 * Flinching, getting up, and being knocked off a wall.
 *
 * Three states, and which one a shot produces is decided in `ThrowerOnShot`:
 * a `zslman` always tumbles, anything else standing on the ground in the hub
 * stumbles, and anything else at all falls over.
 *
 * State 17 is the odd one. It is reachable *only after a decapitation* — the
 * head-model swap in `ThrowerShotFeedback` is the only thing in the class that
 * raises the knocked-down bit — so a thrower plays its get-up exactly when you
 * have taken its head off and it has not died of it.
 */
import type { Rng } from "../../core/rng";
import { ActorFlag, ThrowerFlag, type ThrowerActor } from "../actor";
import { ThrowerReleaseSlotOnDeath } from "../combat/counts";
import { G } from "../globals";
import type { GameHost } from "../host";
import type { Events } from "../../core/events";
import { MotionOf, MotionPlayLength, T } from "../tables";
import { MotionCrossFadeTo } from "../motion";
import { ActorSetMotion, ActorSetOneShotBlended } from "../class30/motion_cue";
import { GAME_HZ, MotionFade } from "../class30/states";
import {
  ActorArcVelocity, ActorPlayCursor, ActorPlayMotion,
  ClearCurrentActorVelocityAndAccel,
} from "./arc";
import { ThrowerPickNextState } from "./router";
import { ThrowerState } from "./states";
import { Class31SetOf, ThrowerStanceOf } from "./tables";
import {
  FALL_GRAVITY, KNOCKDOWN_BODY, SND_BOUNCE, SURFACE_KILL,
  ThrowerBeginKnockbackArc, ThrowerEnterCorpseState, ThrowerFallIntegrate,
} from "./death";
import { vec3, type Vec3 } from "../vec";
import { TraceActorSurfaceContactPoint } from "./surface";

/**
 * `g_bone_reaction_group` has sixteen entries, so the bone clamps here --
 * `CMP EAX, 0xf; JLE` and a store of 15 back into `obj+0x1368` itself.
 */
const REACT_BONE_MAX = 15;
/** Bones below this play on the overlay; 9 and up cut the base track. */
const REACT_HARD_SET_BONE = 9;
/**
 * `MotionCrossFadeTo`'s fade back out, fade in and bone -- `PUSH 0x14`,
 * `PUSH 0x1` and `PUSH 0x1` at `0x0044A3B9`..`0x0044A3C6`.
 */
const REACT_FADE = 0x14;
const REACT_FADE_IN = 1;
const REACT_OVERLAY_BONE = 1;
/** `ThrowerStateGetUp`'s clip — a `szom.bin` one, for every character type. */
const GET_UP_CLIP = 0x127;
/**
 * `PUSH 0x1c17a9; CALL PlaySoundId` in `ThrowerStateGetUp`'s sub 0 --
 * `COMMON2\ZOMBIE_046_16`.
 */
export const SND_GET_UP = 0x1c17a9;
/** The knock and get-up clips state 33 picks by stance. */
const TUMBLE_BY_STANCE = [0x215, 0x1fe, 0x1f4, 0x206];
const TUMBLE_UP_BY_STANCE = [0x216, 0x1ff, 0x1f5, 0x207];
/** The tumble settles below this speed, or after this many frames regardless. */
const SETTLE_SPEED = 0.15;
const TUMBLE_FRAME_CAP = 0x78;
/** It stands off a wall by this much, and gets up after a 20-frame cooldown. */
const TUMBLE_STANDOFF = 4.5;
const TUMBLE_COOLDOWN = 0x14;

/**
 * A clip on the port's one-shot channel, standing in for a track-0 set in the
 * engine (`ActorSetMotion` or `SetCurrentActorMotionBlended` at every call
 * here). Each of those runs `MotionStartOnTrack(model, 0, ...)`, which writes
 * `model+0x36 = 0` and hands the whole skeleton back to track 0 -- so it ends
 * a stumble on track 1, as `ActorSetMotion` does in `class30/motion_cue.ts`.
 */
function playOnce(obj: ThrowerActor, motion: number): void {
  if (!MotionOf(obj, motion)) return;
  obj.react = null;
  obj.action = { motion, ticks: 0 };
  obj.rootActionCursor = -1;
}

/**
 * `ThrowerStateHitReaction` — `FUN_0044A360`, class 0x31 state 1.
 *
 * The stumble, and its clip is a two-level lookup the same shape as class
 * 0x30's: the bone that was hit picks a reaction *group* through
 * `g_bone_reaction_group`, and the group picks the motion out of
 * `g_class31_hit_reactions[set]`. Bones 9 and up — the pelvis and the legs —
 * **hard-cut** rather than blend, so a leg shot reads as a buckle where an arm
 * shot reads as a flinch.
 *
 * **The two arms put the clip on different tracks**, and that decides both
 * how the body moves and how long the state lasts:
 *
 * * bones below 9 -- `MotionCrossFadeTo` (`FUN_00411B70`) with `(obj+0x194,
 *   1, clip, 0, 1, 0x14)` at `0x0044A3C9`: the stumble on **track 1**, over
 *   bone 1's subtree, with the loop still posing the root and the legs.
 *   Track 1 carries no root (`SkeletonPoseRootFrame` takes track 0's), so the
 *   flinch moves nothing, and the loop underneath keeps its own clock. It is
 *   the one track 1 the port has, `Actor.react` in `game/motion.ts`, the same
 *   one class 0x30's `ActorPlayHitReaction` (`FUN_004544C0`) puts its stumble
 *   on.
 * * bones 9 and up -- `ActorSetMotion(obj+0x194, clip)` at `0x0044A3DB`, a
 *   hard cut on **track 0**: the clip replaces the loop, root and all.
 *
 * The way out reads track 0 whichever arm ran: `g_motion_play_length
 * [obj+0x1B4] - 1 <= obj+0x19C` at `0x0044A3EA`..`0x0044A401`, the clip
 * `obj+0x1B4` names and the cursor at `obj+0x19C`. After a leg shot that is
 * the reaction's own end. After any other shot it is **the loop's**, which
 * reaches its last frame somewhere in the next play length -- so a flinch is
 * over whenever the loop comes round, not after the reaction clip's
 * thirty-odd frames.
 *
 * The port played every stumble on its one-shot channel as well, which gave
 * the flinch its clip's root travel (0x3A3's runs 2.2 units back and returns)
 * and held the state -- in which the next shot is a knockdown, state 1 not
 * being state 7 -- for the whole clip.
 */
export function ThrowerStateHitReaction(obj: ThrowerActor, rng: Rng,
                                        host: GameHost): void {
  if (obj.thr.reactBone > REACT_BONE_MAX) obj.thr.reactBone = REACT_BONE_MAX;
  const bone = obj.thr.reactBone;
  const group = T.chars?.reaction_groups?.[bone] ?? 0;
  const motion = Class31SetOf(obj)?.reactions?.[group];

  if (obj.sub === 0) {
    ClearCurrentActorVelocityAndAccel(obj);
    if (motion !== undefined && MotionOf(obj, motion)) {
      // `0x0044A3C9 CALL MotionCrossFadeTo(obj+0x194, 1, clip, 0, 1, 0x14)`
      // for a bone below 9 -- the clip on bone 1's subtree, faded back out
      // over 0x14 -- and `ActorSetMotion(obj+0x194, clip)` for the rest.
      // Nothing else: the one-shot channel is not a track the engine has.
      if (bone < REACT_HARD_SET_BONE) {
        MotionCrossFadeTo(obj, REACT_OVERLAY_BONE, motion, 0, REACT_FADE_IN,
                          REACT_FADE);
      } else {
        ActorSetMotion(obj, motion);
      }
    }
    obj.sub = 1;
  } else if (obj.sub !== 1) {
    return;
  }

  if (ActorPlayCursor(obj)
      < MotionPlayLength(obj, ActorPlayMotion(obj)) - 1) return;

  const knocked = obj.flags2 & ThrowerFlag.KnockedDown;
  obj.flags &= ~ActorFlag.Reacting;
  obj.flags2 &= ~ThrowerFlag.ReactReentry;
  if (knocked) {
    obj.state = ThrowerState.GetUp;
    obj.sub = 0;
    return;
  }
  ThrowerPickNextState(obj, rng, host);
}

/**
 * `ThrowerStateGetUp` — `FUN_0044C2E0`, class 0x31 state 17.
 *
 * Only a decapitation gets here. It raises `obj+0x34` bit 0x100 for the length
 * of the clip, which is a real invulnerability window — shots ricochet off a
 * thrower that is getting up.
 *
 * ```
 * sub 0  obj+0x34 |= 0x100
 *        SetCurrentActorMotionBlended(obj+0x194, 0x127, 0, 5)  ; 0x0044C30F
 *        PlaySoundId(0x1C17A9)
 *        sub = 1, and on
 * sub 1  if (g_motion_play_length[obj+0x1B4] - 1 <= obj+0x19C) {
 *          obj+0x34 &= ~0x100; obj+0x136C &= ~0x4000000
 *          ThrowerPickNextState(obj)
 *        }
 * ```
 *
 * `[proved]`. The clip fades in over five frames, the groan
 * (`COMMON2\ZOMBIE_046_16`, the id class 0x45's heads die with) plays once as
 * it starts, and the state leaves on the play length, not the clip's baked
 * length. Any other sub returns. The port used to cut to the clip, play no
 * sound, and hold the state to the baked length -- two or three frames past
 * the engine's.
 *
 * [open] Motion `0x127` is a `szom.bin` clip and the routine has no
 * character-type branch, so `zskamere` — the one type on `kame.bin`'s
 * skeleton, and one that can reach this state — asks here for a clip its own
 * rig does not have. The port's motion lookup returns nothing and the state
 * ends immediately, which is the least-wrong reading of an engine bug.
 */
export function ThrowerStateGetUp(obj: ThrowerActor, rng: Rng,
                                  host: GameHost, events?: Events): void {
  if (obj.sub === 0) {
    obj.flags |= ActorFlag.ShotImmune;
    if (MotionOf(obj, GET_UP_CLIP)) {
      ActorSetOneShotBlended(obj, GET_UP_CLIP, 0, MotionFade.Quick);
    }
    events?.emit("sound.play", { id: SND_GET_UP });
    obj.sub = 1;
  } else if (obj.sub !== 1) {
    return;
  }
  if (ActorPlayCursor(obj)
      < MotionPlayLength(obj, ActorPlayMotion(obj)) - 1) return;
  obj.flags &= ~ActorFlag.ShotImmune;
  obj.flags2 &= ~ThrowerFlag.KnockedDown;
  ThrowerPickNextState(obj, rng, host);
}

/**
 * `SelectActorGravityAxis`'s six kinds — which way gravity pulls, from the
 * surface the actor is stuck to. `ActorArcVelocity` switches on the same word.
 */
export enum ThrowerArcKind {
  Floor = 0,
  Ceiling = 1,
  WallPlusX = 2,
  WallMinusX = 3,
  WallMinusZ = 4,
  WallPlusZ = 5,
}

/**
 * `SelectActorGravityAxis` — `FUN_00450CF0`. Which axis a body falls along.
 *
 * [diverges] The engine snaps the actor's yaw to the nearest cardinal within
 * 0x2000 first and maps *that* to the axis; the port takes the same four
 * cardinals off the yaw directly, which is the same answer wherever the snap
 * would have succeeded and a floor fall where it would not.
 */
export function SelectActorGravityAxis(obj: ThrowerActor): ThrowerArcKind {
  if (obj.flags2 & ThrowerFlag.Ceiling) return ThrowerArcKind.Ceiling;
  if (!(obj.flags2 & (ThrowerFlag.WallA | ThrowerFlag.WallB))) {
    return ThrowerArcKind.Floor;
  }
  const right = (obj.flags2 & ThrowerFlag.WallA) !== 0;
  const q = Math.round(obj.yaw / 0x4000) & 3;   // 0 +Z, 1 +X, 2 -Z, 3 -X
  const side = (q + (right ? 1 : 3)) & 3;
  return [ThrowerArcKind.WallPlusZ, ThrowerArcKind.WallPlusX,
          ThrowerArcKind.WallMinusZ, ThrowerArcKind.WallMinusX][side];
}

/**
 * Per arc kind, the axis the body falls and bounces along, the sign of the
 * pull on it -- the acceleration each arm of the landing switch writes,
 * `0x3d5f0123` (+0.0544) or `0xbd5f0123` (-0.0544), into `obj+0x58`,
 * `obj+0x5C` or `obj+0x60` -- and the standoff a wall arm moves its contact
 * point by (`FSUB`/`FADD` 4.5).
 */
const FALL_OF: Record<number, { axis: "x" | "y" | "z"; pull: number;
                                standoff: number }> = {
  [ThrowerArcKind.Floor]: { axis: "y", pull: -1, standoff: 0 },
  [ThrowerArcKind.Ceiling]: { axis: "y", pull: 1, standoff: 0 },
  [ThrowerArcKind.WallPlusX]: { axis: "x", pull: 1, standoff: -4.5 },
  [ThrowerArcKind.WallMinusX]: { axis: "x", pull: -1, standoff: 4.5 },
  [ThrowerArcKind.WallMinusZ]: { axis: "z", pull: -1, standoff: 4.5 },
  [ThrowerArcKind.WallPlusZ]: { axis: "z", pull: 1, standoff: -4.5 },
};

/** Both freezes in the tumble: `CMP dword ptr [ESI + 0x19c], 0x2a; JLE`. */
const TUMBLE_FREEZE_CURSOR = 0x2a;

/**
 * `ThrowerStateKnockedTumbling` — `FUN_00450E40`, class 0x31 state 33.
 *
 * `zslman`'s reaction to being shot, and the one that reads as a ragdoll: it
 * is thrown off whatever it was standing on and **bounces along the axis its
 * stance names** — off the floor, off the ceiling, off either wall — halving
 * the two tangential components and reversing the normal one each time, until
 * the speed on that axis is down to 0.15 or two seconds pass.
 *
 * ```
 * sub 0  obj+0x136C |= 0x180000; obj+0x34 = obj+0x34 & ~0x4000 | 0x200000
 *        clip by stance: 0x215 / 0x1FE / 0x1F4 / 0x206
 *        first hit:  ClearCurrentActorVelocityAndAccel; blended, fade 5
 *        a re-entry: ActorSetMotion (a cut); obj+0x1328 += 1
 *        ThrowerBeginKnockbackArc unless 0x2000 is up or two arcs are spent
 *        ThrowerReleaseSlotOnDeath; obj+0x1354 = SelectActorGravityAxis
 * sub 1  freeze past cursor 0x2A; ActorArcVelocity(obj+0x1354) until spent
 * sub 2  freeze past 0x2A; obj+0x1338 += 1; the contact point; the surface;
 *        the axis's own gravity; land when pos + vel reaches the contact or
 *        0x78 frames pass; bounce again while the axis speed is over 0.15;
 *        settle: velocity and gravity cleared, obj+0x34 & ~0x2000 | 0x100,
 *        a (rand() % 10 + 1) * 3 frame lie
 * sub 3  alive: the lie, then the get-up clip by stance, blended, fade 5
 *        dead or on 0x5A: wait for the clip's end, then a corpse
 * sub 4  at the play length less two: back to state 7, immune, 0x14 frames
 * ```
 *
 * `[proved]`, each sub falling through into the next as the switch does.
 * Like the fall it moves nothing itself: `EnemyThrowerUpdate` integrates
 * `vel += acc; pos += vel` after it, which is why each test reads `pos +
 * vel` -- last frame's velocity -- and the step comes after
 * (`ThrowerFallIntegrate`).
 *
 * It used to fly the arc at a constant velocity with the destination's height
 * pinned to the start's, which is neither arm of `ActorArcVelocity`: off the
 * floor the body now rises and falls on the parabola to the point
 * `ThrowerBeginKnockbackArc` chose, and off a wall the curve is on the wall's
 * own axis. It also played both clips as cuts, integrated before it tested,
 * cleared the pose freeze on the settle and on every bounce where the engine
 * leaves it, and waited out a baked clip length.
 */
export function ThrowerStateKnockedTumbling(obj: ThrowerActor, host: GameHost,
                                            dt: number, rng: Rng,
                                            events?: Events): void {
  const frames = dt * GAME_HZ;
  const stance = ThrowerStanceOf(obj) & 3;

  if (obj.sub === 0) {
    const reentry = (obj.flags2 & ThrowerFlag.ReactReentry) !== 0;
    obj.flags2 |= 0x180000;
    // `& 0xffffbfff | 0x200000` on `obj+0x34`, as the fall's sub 0 has it:
    // the body is being knocked down until the exit below takes it away.
    obj.flags = (obj.flags & ~ActorFlag.PoseFrozen) | KNOCKDOWN_BODY;
    const clip = TUMBLE_BY_STANCE[stance] ?? TUMBLE_BY_STANCE[0];
    if (!reentry) {
      ClearCurrentActorVelocityAndAccel(obj);
      if (MotionOf(obj, clip)) {
        ActorSetOneShotBlended(obj, clip, 0, MotionFade.Quick);
      }
      obj.thr.knockCount = 0;
    } else {
      playOnce(obj, clip);
      obj.thr.knockCount += 1;
    }
    if (!(obj.flags & ActorFlag.NoHitReaction) && obj.thr.knockCount < 2) {
      ThrowerBeginKnockbackArc(obj, host);
    } else {
      obj.flags |= ActorFlag.NoHitReaction;
    }
    // As `ThrowerStateFallAndLand`'s own sub 0: the alive count falls when the
    // actor is knocked off its feet, not when the body settles.
    ThrowerReleaseSlotOnDeath(obj);
    obj.thr.arcKind = SelectActorGravityAxis(obj);
    obj.sub = 1;
  }

  if (obj.sub === 1) {
    if (ActorPlayCursor(obj) > TUMBLE_FREEZE_CURSOR) {
      obj.flags |= ActorFlag.PoseFrozen;
    }
    if (ActorArcVelocity(obj, obj.thr.arcKind, frames)) {
      ThrowerFallIntegrate(obj, frames);
      return;
    }
    obj.thr.sinceLanding = 0;
    obj.sub = 2;
    obj.flags &= ~ActorFlag.PoseFrozen;
  }

  if (obj.sub === 2) {
    if (ActorPlayCursor(obj) > TUMBLE_FREEZE_CURSOR) {
      obj.flags |= ActorFlag.PoseFrozen;
    }
    obj.thr.sinceLanding += frames;
    const contact = ThrowerTumbleContact(obj);
    obj.thr.landSurface = G.g_coli_hit_surface;
    // A kind outside the six lands nowhere: the switch's `JA` skips to the
    // routine's end.
    const fall = FALL_OF[obj.thr.arcKind];
    if (!fall) return;
    const g = fall.pull * -FALL_GRAVITY;
    if (fall.axis === "x") obj.accX = g;
    else if (fall.axis === "y") obj.accY = g;
    else obj.accZ = g;
    const target = contact[fall.axis] + fall.standoff;
    const next = obj.pos[fall.axis] + obj.vel[fall.axis];
    const short = fall.pull < 0 ? target < next : next < target;
    if (short && obj.thr.sinceLanding < TUMBLE_FRAME_CAP) {
      ThrowerFallIntegrate(obj, frames);
      return;
    }
    obj.pos[fall.axis] = target;
    for (const k of ["x", "y", "z"] as const) {
      obj.vel[k] *= k === fall.axis ? -0.5 : 0.5;
    }
    events?.emit("sound.play", { id: SND_BOUNCE });
    if (Math.abs(obj.vel[fall.axis]) > SETTLE_SPEED
        && obj.thr.sinceLanding < TUMBLE_FRAME_CAP) {
      ThrowerFallIntegrate(obj, frames);
      return;
    }
    // `LAB_004512E2`.
    ClearCurrentActorVelocityAndAccel(obj);
    // `AND CH, 0xbf` (`80e5bf`) on `obj+0x136C` at 0x004512F3, in the same
    // breath as `AND DH, 0xdf` / `OR DH, 0x1` on `obj+0x34`: the body has
    // settled, so the next landing may puff again. The pose freeze stays.
    obj.flags2 &= ~ThrowerFlag.LandingDustEmitted;
    obj.flags = (obj.flags & ~ActorFlag.NoHitReaction) | ActorFlag.ShotImmune;
    obj.slideTimer = (rng.int(10) + 1) * 3;
    obj.sub = 3;
  }

  if (obj.sub === 3) {
    if ((obj.flags & ActorFlag.Dead) || obj.thr.landSurface === SURFACE_KILL) {
      // `obj+0x1F1`: nothing until the clip on the track has reached its
      // play length.
      if (ActorPlayCursor(obj)
          < MotionPlayLength(obj, ActorPlayMotion(obj))) return;
      if (obj.thr.landSurface === SURFACE_KILL) {
        obj.flags = (obj.flags & ~ActorFlag.PoseFrozen) | ActorFlag.Dead;
        ThrowerReleaseSlotOnDeath(obj);
      }
      ThrowerEnterCorpseState(obj);
      return;
    }
    obj.slideTimer -= frames;
    if (obj.slideTimer > 0) return;
    const up = TUMBLE_UP_BY_STANCE[stance] ?? TUMBLE_UP_BY_STANCE[0];
    if (MotionOf(obj, up)) ActorSetOneShotBlended(obj, up, 0, MotionFade.Quick);
    obj.sub = 4;
    obj.flags &= ~ActorFlag.PoseFrozen;
  }

  if (obj.sub !== 4) return;
  if (ActorPlayCursor(obj)
      < MotionPlayLength(obj, ActorPlayMotion(obj)) - 2) return;
  obj.flags2 &= ~(ThrowerFlag.ReactReentry | ThrowerFlag.BandLatched);
  obj.flags = (obj.flags & ~(ActorFlag.Reacting | KNOCKDOWN_BODY))
            | ActorFlag.ShotImmune;
  obj.cooldown = TUMBLE_COOLDOWN;
  obj.state = ThrowerState.StandAndDecide;
  obj.sub = 0;
}

/**
 * Where the surface the tumble bounces off is: `TraceActorSurfaceContactPoint`
 * (`FUN_0044C370`) into the locals the landing switch reads.
 *
 * The probe answers for all four attachments. When a clinging body's probe
 * misses, the engine's routine leaves its output alone and the switch reads
 * whatever those stack words held, which nothing can reproduce; the port
 * answers a point 4.5 units on along the body's own velocity on that axis,
 * as it always has.
 */
function ThrowerTumbleContact(obj: ThrowerActor): Vec3 {
  if (!TraceActorSurfaceContactPoint(obj, _contact)) {
    const fall = FALL_OF[obj.thr.arcKind];
    _contact.x = obj.pos.x; _contact.y = obj.pos.y; _contact.z = obj.pos.z;
    if (fall) {
      _contact[fall.axis] += (obj.vel[fall.axis] >= 0 ? TUMBLE_STANDOFF
                                                      : -TUMBLE_STANDOFF)
                           - fall.standoff;
    }
  }
  return _contact;
}

const _contact = vec3();
