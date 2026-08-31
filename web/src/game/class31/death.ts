/**
 * Falling over, and dying.
 *
 * Class 0x31's death is four states, not a clip: it is knocked off its feet
 * and rides a ballistic arc *at the camera* (`ThrowerBeginKnockbackArc` aims
 * the body at you, harder the nearer it already is), bounces on the ground,
 * lies still for a random moment, and then either gets up — because being
 * knocked down is survivable — or plays its own death clip and becomes a
 * corpse that sinks into the floor for two seconds and despawns.
 *
 * `ThrowerStateFallToSurface` is the same fall for an actor that has simply
 * come off a wall, and it is the one path by which a wall-crawler that runs
 * out of wall ends up back on the ground.
 */
import type { Rng } from "../../core/rng";
import { ActorFlag, ThrowerFlag, type Actor } from "../actor";
import { G } from "../globals";
import { QueryGroundHeightAt, type GameHost } from "../host";
import { MotionOf, T } from "../tables";
import { vec3 } from "../vec";
import { GAME_HZ } from "../class30/states";
import { ActorArcVelocity, ActorClipFrame, ActorClipLength } from "./arc";
import { ThrowerState, ThrowerMotion } from "./states";
import { ThrowerMotionOf, ThrowerStanceOf } from "./tables";

const _hit = vec3();

/** `obj+0x5C` — gravity, -196 units per second squared at 60 Hz. */
export const FALL_GRAVITY = -0.05444444;
/** The bounce: the vertical is reversed and halved, the other two halved. */
const BOUNCE_NORMAL = -0.5;
const BOUNCE_TANGENT = 0.5;
/** Below this vertical speed the body has settled. */
const SETTLE_SPEED = 0.15;
/** ...and it settles regardless after this many frames. */
const FALL_FRAME_CAP = 0x78;
/** `QueryGroundHeightAt(x, y + 4.5, z)` for the fall, `+1.0` for the drop. */
const FALL_PROBE_RISE = 4.5;
const DROP_PROBE_RISE = 1.0;
/** The surface that kills whatever lands on it. `[likely]` deep water. */
export const SURFACE_KILL = 0x5a;
/** The get-up clip, for every character but 0x17. */
const GET_UP_CLIP = 0x11b;
/** The corpse lies here for two seconds, sinking this far a frame. */
const CORPSE_FRAMES = 0x78;
const CORPSE_SINK = 0.04;
/** How many re-entries into one fall the knockback arc is worth. */
const KNOCKBACK_ARCS = 2;

/** The pose freeze frame, per character type: `T1` then `T2` in the exe. */
const FREEZE_AIR: Record<number, number> = { 0x16: 35, 0x17: 20, 0x18: 44, 0x19: 44 };
const FREEZE_FALL: Record<number, number> = { 0x16: 48, 0x17: 20, 0x18: 44, 0x19: 44 };

/** The death clip, per character type. */
const DEATH_CLIP: Record<number, number> = {
  0x16: 0x11e, 0x17: 0x1bc, 0x18: 0x11d, 0x19: 0x11d,
};

/** Character type 0x16 never re-bounces and dies through state 3. */
const CHAR_ZSASS = 0x16;
const CHAR_ZSKAMERE = 0x17;
const CHAR_ZSLMAN = 0x18;

function playOnce(obj: Actor, motion: number): void {
  if (!MotionOf(obj, motion)) return;
  obj.action = { motion, t: 0, loop: false };
  obj.rootActionFrame = -1;
}

/**
 * `ThrowerBeginKnockbackArc` — `FUN_0044D120`.
 *
 * The body flies **at the camera**, and harder the nearer it already is:
 * `t = clamp(15.0 / |view-space centre| * 10.0, 0, ∞)`, half as far again when
 * the actor was already dead, and the target is the actor's own tracked point
 * pulled `t` units nearer along the camera's own axis.
 *
 * [diverges] The engine builds that point in the camera's matrix, which the
 * port cannot reach; here it is the straight line from the actor to the eye.
 * The direction is the same and the distance is the same formula.
 */
export function ThrowerBeginKnockbackArc(obj: Actor, eye: { x: number;
                                                            y: number;
                                                            z: number }): void {
  const d = Math.hypot(obj.pos.x - eye.x, obj.pos.y - eye.y, obj.pos.z - eye.z);
  if (d < 1e-3) return;
  let t = Math.max(0, (15.0 / d) * 10.0);
  if (obj.flags & ActorFlag.Dead) t *= 1.5;
  const k = Math.min(1, t / d);
  obj.arcFrom = { x: obj.pos.x, y: obj.pos.y, z: obj.pos.z };
  obj.arcTo = {
    x: obj.pos.x + (eye.x - obj.pos.x) * k,
    y: obj.charType === CHAR_ZSLMAN && (obj.flags2 & 0xc0) ? obj.pos.y
       : obj.pos.y + (eye.y - obj.pos.y) * k,
    z: obj.pos.z + (eye.z - obj.pos.z) * k,
  };
  obj.arcFrames = 0;
  // `ActorArcBeginToAtSpeed`'s own duration rule, which is what `FUN_0044DB50`
  // gives it: 30 units per `minFrames`, floored at `minFrames`.
  obj.arcTotal = Math.max(15, Math.trunc(Math.hypot(
    obj.arcTo.x - obj.arcFrom.x, obj.arcTo.z - obj.arcFrom.z) / 2));
}

/**
 * `ThrowerStateFallAndLand` — `FUN_0044A450`, class 0x31 state 2.
 *
 * The knockdown *and* the death fall — which state it turns into depends on
 * whether the actor was still alive when it landed. Being knocked down is
 * survivable: it lies there for a random three to thirty frames, plays a
 * get-up clip and goes back to deciding.
 */
export function ThrowerStateFallAndLand(obj: Actor, eye: { x: number;
                                                           y: number;
                                                           z: number },
                                        dt: number, rng: Rng,
                                        host: GameHost): void {
  const frames = dt * GAME_HZ;

  if (obj.sub === 0) {
    const reentry = (obj.flags2 & ThrowerFlag.ReactReentry) !== 0;
    obj.flags2 = (obj.flags2 & ~(ThrowerFlag.Surface | ThrowerFlag.OffGround))
               | 0x180000;
    obj.flags &= ~ActorFlag.PoseFrozen;
    const clip = ThrowerMotionOf(obj, ThrowerMotion.Airborne);
    if (!reentry) {
      obj.vel.x = obj.vel.y = obj.vel.z = 0;
      obj.accY = 0;
      if (clip !== undefined) playOnce(obj, clip);
      obj.knockCount = 0;
    } else {
      if (obj.charType !== CHAR_ZSASS && clip !== undefined) playOnce(obj, clip);
      obj.knockCount += 1;
    }
    if (!(obj.flags & ActorFlag.ArcSpent) && obj.knockCount < KNOCKBACK_ARCS) {
      ThrowerBeginKnockbackArc(obj, eye);
    } else {
      obj.flags |= ActorFlag.ArcSpent;
    }
    obj.sub = 1;
  }

  if (obj.sub === 1) {
    if (ActorClipFrame(obj) >= (FREEZE_AIR[obj.charType] ?? 44)) {
      obj.flags |= ActorFlag.PoseFrozen;
    }
    if (obj.arcFrames < obj.arcTotal) {
      ActorArcVelocity(obj);
      obj.arcFrames += frames;
      obj.pos.x += obj.vel.x * frames;
      obj.pos.y += obj.vel.y * frames;
      obj.pos.z += obj.vel.z * frames;
      return;
    }
    if (obj.charType === CHAR_ZSASS) {
      obj.vel.x = obj.vel.y = obj.vel.z = 0;
    }
    obj.accY = FALL_GRAVITY;
    obj.flags &= ~ActorFlag.PoseFrozen;
    obj.sinceLanding = 0;
    obj.sub = 2;
  }

  if (obj.sub === 2) {
    if (ActorClipFrame(obj) >= (FREEZE_FALL[obj.charType] ?? 44)) {
      obj.flags |= ActorFlag.PoseFrozen;
    }
    obj.sinceLanding += frames;
    obj.vel.y += obj.accY * frames;
    const g = QueryGroundHeightAt(host, obj.pos.x,
                                  obj.pos.y + FALL_PROBE_RISE, obj.pos.z, _hit);
    // [diverges] With no collision the ground is the script's own plane,
    // which is what `g_camera_fixed_eye_y` is for.
    const ground = g ?? G.g_camera_fixed_eye_y;
    if (obj.pos.y + obj.vel.y > ground && obj.sinceLanding < FALL_FRAME_CAP) {
      obj.pos.x += obj.vel.x * frames;
      obj.pos.y += obj.vel.y * frames;
      obj.pos.z += obj.vel.z * frames;
      return;
    }
    obj.pos.y = ground;
    obj.landSurface = G.g_coli_hit_surface;
    obj.vel.y *= BOUNCE_NORMAL;
    obj.vel.x *= BOUNCE_TANGENT;
    obj.vel.z *= BOUNCE_TANGENT;
    if (Math.abs(obj.vel.y) > SETTLE_SPEED
        && obj.sinceLanding < FALL_FRAME_CAP
        && obj.charType !== CHAR_ZSASS) {
      obj.flags &= ~ActorFlag.PoseFrozen;
      return;                                    // bounce again
    }
    obj.vel.x = obj.vel.y = obj.vel.z = 0;
    obj.accY = 0;
    obj.flags = (obj.flags & ~(ActorFlag.ArcSpent | ActorFlag.PoseFrozen))
              | ActorFlag.ShotImmune;
    obj.slideTimer = (rng.int(10) + 1) * 3;
    obj.sub = 3;
  }

  if (obj.sub === 3) {
    const alive = !obj.dead && obj.landSurface !== SURFACE_KILL;
    if (!alive) return ThrowerDie(obj);
    if (obj.charType === CHAR_ZSASS) {
      if (obj.action) return;
    } else {
      obj.slideTimer -= frames;
      if (obj.slideTimer > 0) return;
    }
    if (obj.charType !== CHAR_ZSKAMERE) playOnce(obj, GET_UP_CLIP);
    obj.sub = 4;
  }

  // Sub 4: the get-up plays out, and the knocked-down latch decides whether it
  // owes you a stagger first.
  const len = ActorClipLength(obj, obj.action?.motion ?? 0);
  if (obj.action && ActorClipFrame(obj) < len - 2) return;
  const wasKnocked = obj.flags2 & ThrowerFlag.KnockedDown;
  obj.flags &= ~(ActorFlag.ShotImmune | ActorFlag.Reacting);
  obj.flags2 &= ~(ThrowerFlag.BandLatched | ThrowerFlag.ReactReentry);
  obj.sub = 0;
  obj.state = wasKnocked ? ThrowerState.GetUp : ThrowerState.StandAndDecide;
}

/**
 * The two ways out of a fall that killed. Character 0x16 plays its own death
 * clip first; everything else goes straight to a corpse.
 */
function ThrowerDie(obj: Actor): void {
  obj.dead = true;
  if (obj.landSurface === SURFACE_KILL) obj.flags |= ActorFlag.Dead;
  if (obj.charType === CHAR_ZSASS) {
    obj.state = ThrowerState.Death;
    obj.sub = 0;
    return;
  }
  ThrowerEnterCorpseState(obj);
}

/**
 * `ThrowerStateDeathClip` — `FUN_0044A930`, class 0x31 state 3.
 *
 * Character 0x16's only. Hard-rewinds its own death clip — no blend, because
 * whatever was playing is a fall — releases the permit and the tracking slot
 * in that order, and becomes a corpse when the clip runs out.
 */
export function ThrowerStateDeathClip(obj: Actor): void {
  if (obj.sub === 0) {
    playOnce(obj, DEATH_CLIP[obj.charType] ?? DEATH_CLIP[0x19]);
    if (obj.attackPermit >= 0) {
      G.g_attack_permits[obj.attackPermit] = -1;
      obj.attackPermit = -1;
    }
    obj.dead = true;
    obj.sub = 1;
  }
  const len = ActorClipLength(obj, obj.action?.motion ?? 0);
  if (obj.action && ActorClipFrame(obj) < len - 1) return;
  ThrowerEnterCorpseState(obj);
}

/**
 * `ThrowerEnterCorpseState` — `FUN_0044D0A0`. Character type 0x18 blinks out;
 * everything else sinks.
 */
export function ThrowerEnterCorpseState(obj: Actor): void {
  obj.flags2 &= ~0x180000;
  obj.flags |= ActorFlag.PoseFrozen;
  obj.dead = true;
  obj.sub = 0;
  obj.state = obj.charType === CHAR_ZSLMAN
    ? ThrowerState.CorpseBlink : ThrowerState.Corpse;
}

/**
 * The pose the corpse freezes on, from `class31.corpse_frames`.
 *
 * [diverges] The engine has a general table for motions `0x3D9..0x3E0` behind
 * these four special cases, and class 0x31 never plays one of those — every
 * use of it reads outside the array, into mesh floats or a string. The port
 * keeps the current frame instead of reproducing an out-of-bounds read.
 */
function ThrowerCorpsePoseFrame(obj: Actor, rng: Rng): number {
  const row = T.chars?.class31?.corpse_frames?.[String(obj.action?.motion
                                                      ?? obj.motion)];
  if (!row) return -1;
  // `rand() % 17 >> 4` — the second entry comes up once in seventeen.
  return row[rng.int(17) >> 4] ?? row[0];
}

/**
 * One handler for `ThrowerStateCorpseSink` (`FUN_0044A9D0`, class 0x31
 * state 4) and `ThrowerStateCorpseBlink` (`FUN_0044AB70`, state 5), which is
 * the same two seconds without the sinking.
 *
 * [diverges] Two functions in the engine, one here: they share their opening,
 * their pose pin, their countdown and their despawn, and differ only in
 * whether the last line sinks the body or flickers it. The `blink` argument is
 * the character-type test `ThrowerEnterCorpseState` already made.
 *
 * Both pin the motion cursor to one pose frame and hold it, which is why a
 * corpse does not finish its death animation: it is frozen on a chosen frame
 * of it.
 */
export function ThrowerStateCorpse(obj: Actor, dt: number, rng: Rng,
                                   blink: boolean): void {
  if (obj.sub === 0) {
    obj.slideTimer = CORPSE_FRAMES;
    obj.corpseFrame = ThrowerCorpsePoseFrame(obj, rng);
    obj.flags |= 0x20000;
    obj.sub = 1;
  }

  // The pose pin: the engine rewrites the play cursor every frame and freezes
  // the advance, so the corpse holds one chosen frame of its death clip rather
  // than finishing it.
  if (obj.corpseFrame >= 0 && obj.action) {
    obj.action.t = obj.corpseFrame / GAME_HZ;
  }

  if (blink) {
    // Parity is tested *before* the decrement, so the first frame is visible.
    if (Math.floor(obj.slideTimer) & 1) {
      obj.alpha = 0;
      obj.flags2 |= ThrowerFlag.Blinking;
    } else {
      obj.alpha = 1;
      obj.flags2 &= ~ThrowerFlag.Blinking;
    }
  } else {
    obj.pos.y -= CORPSE_SINK * dt * GAME_HZ;
  }

  obj.slideTimer -= dt * GAME_HZ;
  if (obj.slideTimer > 0) return;
  obj.alpha = 1;
  obj.flags2 &= ~ThrowerFlag.Blinking;
  ThrowerLeave(obj);
}

/**
 * `ThrowerLeave` — `FUN_0044AD60`. Occupies state slot 6 and is never entered
 * as one: nothing in the program writes 6 to `obj+0x1310`. It is the
 * subroutine every other exit calls.
 */
export function ThrowerLeave(obj: Actor): void {
  if (obj.attackPermit >= 0) G.g_attack_permits[obj.attackPermit] = -1;
  obj.attackPermit = -1;
  obj.dead = true;
  obj.visible = false;
  obj.action = null;
}

/**
 * `ThrowerStateFallToSurface` — `FUN_0044BC70`, class 0x31 state 11.
 *
 * How a wall-crawler that has run out of wall gets back down. It records the
 * height it started from, falls, and picks a landing clip by **how far it
 * fell** — over fifteen units the long one, ten to fifteen the short one,
 * under ten none at all, which is what makes a short drop read as a step and a
 * long one as a landing.
 */
export function ThrowerStateFallToSurface(obj: Actor, dt: number,
                                          host: GameHost): void {
  const frames = dt * GAME_HZ;
  const is17 = obj.charType === CHAR_ZSKAMERE;

  if (obj.sub === 0) {
    obj.flags |= ActorFlag.ArcSpent;
    obj.fallFromY = obj.pos.y;
    obj.flags2 &= ~(ThrowerFlag.Surface | ThrowerFlag.OffGround);
    playOnce(obj, is17 ? 0x1bc : 0x3a5);
    obj.sub = 1;
  }

  if (obj.sub === 1) {
    obj.accY = FALL_GRAVITY;
    obj.vel.y += obj.accY * frames;
    const g = QueryGroundHeightAt(host, obj.pos.x,
                                  obj.pos.y + DROP_PROBE_RISE, obj.pos.z, _hit);
    const ground = g ?? G.g_camera_fixed_eye_y;
    if (ground < obj.pos.y + obj.vel.y) {
      obj.pos.y += obj.vel.y * frames;
      return;
    }
    obj.vel.x = obj.vel.y = obj.vel.z = 0;
    obj.accY = 0;
    obj.pos.y = ground;
    const drop = Math.abs(obj.fallFromY - ground);
    if (drop > 15) {
      playOnce(obj, is17 ? 0x1bc : 0x3a5);
      obj.fallFromY = 0;
    } else if (drop > 10) {
      playOnce(obj, is17 ? 0x1ba : 0x3a9);
      obj.fallFromY = 0;
    }
    obj.sub = 2;
  }

  // Sub 2: a landing clip zeroed `fallFromY`, so this leaves at once; with no
  // landing clip it waits the fall clip out instead.
  if (obj.fallFromY !== 0 && obj.action) return;
  obj.flags &= ~ActorFlag.ArcSpent;
  obj.fallFromY = 0;
  obj.sub = 0;
  obj.landSurface = G.g_coli_hit_surface;
  if (!obj.dead && obj.landSurface !== SURFACE_KILL) {
    obj.state = (obj.flags & ActorFlag.BackingOff)
      ? ThrowerState.LeapAside : ThrowerState.StandAndDecide;
    return;
  }
  ThrowerDie(obj);
}

/** Which stance the corpse and fall states report, for the debug feed. */
export function ThrowerFallStance(obj: Actor): number {
  return ThrowerStanceOf(obj) & 3;
}
