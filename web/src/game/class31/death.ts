/**
 * Falling over, and dying.
 *
 * Class 0x31's death is four states, not a clip: it is knocked off its feet
 * and rides a ballistic arc *away from the camera* (`ThrowerBeginKnockbackArc`
 * throws the body back, harder the nearer it already was), bounces on the
 * ground,
 * lies still for a random moment, and then either gets up — because being
 * knocked down is survivable — or plays its own death clip and becomes a
 * corpse that sinks into the floor for two seconds and despawns.
 *
 * `ThrowerStateFallToSurface` is the same fall for an actor that has simply
 * come off a wall, and it is the one path by which a wall-crawler that runs
 * out of wall ends up back on the ground.
 */
import type { Rng } from "../../core/rng";
import {
  ThrowerReleaseSlotOnDeath, ThrowerRetireFromAliveCount,
  ThrowerRetireFromPresentCount,
} from "../combat/counts";
import { ThrowerReleaseAttackPermit } from "../combat/permits";
import { ActorFlag, ThrowerFlag, type Actor } from "../actor";
import { G } from "../globals";
import type { GameHost } from "../host";
import { vec3 } from "../vec";
import { QueryGroundHeightAt } from "../coli";
import { ActorDespawn } from "../despawn";
import { MotionOf, T } from "../tables";
import { GAME_HZ } from "../class30/states";
import { ActorArcVelocity, ActorClipFrame, ActorClipLength } from "./arc";
import { ThrowerState, ThrowerMotion } from "./states";
import { ThrowerMotionOf, ThrowerStanceOf } from "./tables";


/** `ActorArcBeginToAtSpeed`'s `minFrames`. */
const ARC_MIN_FRAMES = 15;

const _view = vec3();
const _dest = vec3();

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
  obj.action = { motion, ticks: 0, loop: false };
  obj.rootActionFrame = -1;
}

/**
 * `ThrowerBeginKnockbackArc` — `FUN_0044D120`. Where a shot body flies.
 *
 * **Away from the camera, not at it**, and harder the nearer it already is:
 *
 * ```c
 * t = 15.0 / |obj+0x70..0x78| * 10.0;      // the view-space tracked point
 * if (t < 0.0) t = 0.0;
 * if (obj+0x34 & 0x4000000) t *= 1.5;      // already dead: half again
 * // then, in the camera's own frame:
 * MatrixStackSetTopFromArray(view_to_world);
 * p = (obj+0x70, obj+0x74, obj+0x78 - t);
 * MatrixTransformPoint(&p, &dest);
 * ```
 *
 * The sign is the whole of it. `obj+0x78` is the depth in the **camera's own**
 * space, and that space has **−z in front**: `ThrowerPickLandingPoint`
 * (`FUN_0044CBA0`) unprojects its landing point at a literal `-15.5` and the
 * port has carried that number, negative, since it was written. So `z - t`
 * with `t >= 0` is *more* negative, which is *further in front of the camera*
 * — the body is thrown away from the viewer.
 *
 * This used to read the store as "pulled `t` units nearer" and approximate it
 * with a lerp from the actor toward the eye, under a `[diverges]` saying the
 * camera's matrix was out of reach. It is not: `GameHost.viewSpaceOf` is the
 * view-space point and `GameHost.viewPoint` is the inverse transform, and both
 * have been on the seam since `ThrowerPickLandingPoint` was ported. The lerp
 * was wrong twice over — the direction, and the shape. Moving along the
 * camera's z keeps the body's screen x and y, so it recedes; moving toward the
 * eye converges on a point, and `k = min(1, t / d)` pinned it *at* the eye for
 * anything inside about fifteen units. A thrower shot mid-pounce lands 15.5
 * units in front of the camera, so that was every close kill.
 *
 * `GameHost.viewSpaceOf` hands the field over in the engine's own sign and
 * with no opinion about it, so this is `z - t` verbatim. It used to negate the
 * depth and refuse an actor behind the camera; that judgement belonged to
 * neither reader and is gone.
 */
export function ThrowerBeginKnockbackArc(obj: Actor, host: GameHost): void {
  // The standing arc first: no knockback at all, over the minimum duration.
  // [diverges] The engine always has a camera; a host that cannot answer is
  // the port's own case, and leaving `arcTotal` at zero would collapse the
  // whole fall into one frame rather than merely skip the throw.
  obj.arcFrom = { x: obj.pos.x, y: obj.pos.y, z: obj.pos.z };
  obj.arcTo = { x: obj.pos.x, y: obj.pos.y, z: obj.pos.z };
  obj.arcFrames = 0;
  obj.arcTotal = ARC_MIN_FRAMES;
  if (!host.viewSpaceOf(obj.at, _view)) return;
  const len = Math.hypot(_view.x, _view.y, _view.z);
  if (len < 1e-4) return;
  let t = (15.0 / len) * 10.0;
  if (t < 0) t = 0;
  if (obj.flags & ActorFlag.Dead) t *= 1.5;
  // `p = (obj+0x70, obj+0x74, obj+0x78 - t)`, then back through the
  // view-to-world matrix. `-z` is in front, so this is away from the viewer.
  host.viewPoint(_view.x, _view.y, _view.z - t, _dest);
  obj.arcTo = {
    x: _dest.x,
    // A wall-clinging `zslman` keeps its own height: `local_14` is overwritten
    // with `obj+0x44` after the transform.
    y: obj.charType === CHAR_ZSLMAN && (obj.flags2 & 0xc0) ? obj.pos.y
       : _dest.y,
    z: _dest.z,
  };
  // `ActorArcBeginToAtSpeed`'s own duration rule, which is what `FUN_0044DB50`
  // gives it: 30 units per `minFrames`, floored at `minFrames`.
  obj.arcTotal = Math.max(ARC_MIN_FRAMES, Math.trunc(Math.hypot(
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
export function ThrowerStateFallAndLand(obj: Actor, host: GameHost,
                                        dt: number, rng: Rng): void {
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
      ThrowerBeginKnockbackArc(obj, host);
    } else {
      obj.flags |= ActorFlag.ArcSpent;
    }
    // The last line of the engine's own case 0, and the one the port did not
    // have: a thrower leaves `g_enemies_alive` on the frame it is knocked off
    // its feet, not when the body stops bouncing three seconds later. The
    // whole fall used to run before the room-clear gate could see it.
    ThrowerReleaseSlotOnDeath(obj);
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
    // `QueryGroundHeightAt` falls back to the script's own ground plane when
    // the trace misses, which is the engine's own answer.
    const ground = QueryGroundHeightAt(obj.pos.x, obj.pos.y + FALL_PROBE_RISE,
                                       obj.pos.z);
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
  // `ThrowerReleaseSlotOnDeath` (`FUN_0044D050`) runs the moment the hit
  // points fall below 1 and always ends in the alive retire. The *present*
  // retire is `ThrowerEnterCorpseState`'s, one clip later.
  ThrowerRetireFromAliveCount(obj);
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
    // `ThrowerReleaseAttackPermit` then `ThrowerReleaseSlotOnDeath`, in the
    // engine's order (0x0044A983 then 0x0044A989). Clearing the permit array
    // by hand -- which is what this did -- leaves `g_attack_committed` up.
    ThrowerReleaseAttackPermit(obj);
    ThrowerReleaseSlotOnDeath(obj);
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
  // `unless (obj+0x38 & 1) ThrowerRetireFromPresentCount` — the *present*
  // count falls here and not at death, which is what makes a corpse still on
  // stage present but not alive. That distinction is the only reason the game
  // has both `wait_enemies_present` and `wait_enemies_alive`.
  ThrowerRetireFromPresentCount(obj);
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
    // `obj.corpseFrame` is already a frame number; it used to be divided by
    // GAME_HZ only to be multiplied back on read.
    obj.action.ticks = obj.corpseFrame;
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
 * subroutine every other exit calls, and it is **the whole of** class 0x31's
 * leave — the engine has exactly one:
 *
 * ```c
 * ThrowerRetireFromAliveCount(obj);
 * ThrowerRetireFromPresentCount(obj);
 * ThrowerReleaseAttackPermit(obj);
 * if (obj+0x120 != -1) g_enemy_slots[obj+0x120 * 8] = 0;
 * obj+0x34 &= ~1;
 * ActorDespawn(obj);
 * ```
 *
 * Its two callers are `ThrowerStrikeConnect` (`FUN_0044CE60`) and
 * `ThrowerStateGrabPlayer` (`FUN_0044EF90`), and a second transcription of it
 * lived privately in `class31/scripted.ts` doing only the permit release —
 * so a thrower that finished its grab-and-throw never left either count, and
 * `wait_enemies_alive` after one could not open. One exe function, one TS
 * function; `verify_port.py` now checks it by address.
 */
export function ThrowerLeave(obj: Actor): void {
  // `ThrowerLeave` and `ThrowerReleaseSlotOnDeath` are the engine's two callers
  // of the alive retire; this is the one that also takes the actor off screen.
  ThrowerRetireFromAliveCount(obj);
  ThrowerRetireFromPresentCount(obj);
  ThrowerReleaseAttackPermit(obj);
  // The camera slot, `obj+0x120` — a different slot from the permit at
  // `obj+0x121`. Modelled as a filter by `at` for the same reason
  // `ThrowerReleaseSlotOnDeath` is: the port keeps `g_enemy_slots` as the
  // list of actors rather than a fixed array of eight-byte records.
  G.g_enemy_slots = G.g_enemy_slots.filter((at) => at !== obj.at);
  // `obj+0x34 &= ~1`. [open] Bit 0 of the flag word has no port: nothing in
  // the ported call graph reads or writes it, so there is nothing to clear.
  // Named here rather than dropped, so the next reader knows it was seen.
  ActorDespawn(obj);
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
export function ThrowerStateFallToSurface(obj: Actor, dt: number): void {
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
    const ground = QueryGroundHeightAt(obj.pos.x, obj.pos.y + DROP_PROBE_RISE,
                                       obj.pos.z);
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
  ThrowerReleaseSlotOnDeath(obj);
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
