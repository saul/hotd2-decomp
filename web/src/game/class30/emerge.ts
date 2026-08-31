/**
 * The two entrances that **place** the actor, and why they matter.
 *
 * A class-0x30 spawn's `y` is where its entrance *starts*, not where it
 * stands. Two states in the table take that seriously:
 *
 * * `ZombieStateEmerge` (27) holds a submerged pose, waits, and then plays a
 *   clip named by the descriptor whose own root motion carries the actor up
 *   and out. Stage 2's block 16 is full of them: the ones that come out of the
 *   water at step 1 and step 2 have `y` under the surface, and the clip is
 *   what lifts them.
 * * `ZombieStateDelayedLeap` (26) waits, then rides a ballistic arc to a point
 *   the descriptor names.
 *
 * Neither was ported, and `ZombieEntryState` sent both to `AttackRun` — so the
 * actor simply stood at the position its entrance was supposed to move it
 * from, with no animation, in the water or in the ground.
 */
import type { Rng } from "../../core/rng";
import type { Events } from "../../core/events";
import { ActorFlag, ZombieFlag2, type Actor } from "../actor";
import { MotionPlayFrame, MotionPlayLength } from "../tables";
import { ActorSetMotionBlended } from "./motion_cue";
import { ZombieState } from "./states";

/** The pose `ZombieStateEmerge` holds while it waits — `FUN_00411930(0xB9)`. */
const SUBMERGED_MOTION = 0xb9;
/**
 * The two emerge clips the engine names by id, and the frames each spawns an
 * effect on: 0x62 at frame 22, 0x61 at frame 35. Clip 178 is the one the water
 * spawns use and 183 the one the ground spawns use.
 */
const EMERGE_SPLASH_MOTION = 0xb2;
const EMERGE_SPLASH_FRAMES: readonly [number, number][] =
  [[0x16, 0x62], [0x23, 0x61]];

/** `ZombieStateDelayedLeap`'s two jump clips, and the landing. */
const LEAP_MOTION = 0x3bb;
const LEAP_MOTION_ALT = 0x399;
const LEAP_LAND_MOTION = 0x3f7;

/** The clip frame this actor is on — the engine's `obj+0x19C`, at 60 Hz. */
function frameOf(obj: Actor): number {
  return MotionPlayFrame(obj);
}

function atLastFrame(obj: Actor): boolean {
  const len = MotionPlayLength(obj);
  // Equality: the cursor wraps at `len + 1`, so `>=` covers two frames.
  return len > 0 && frameOf(obj) === len - 1;
}

/**
 * `ZombieStateEmerge` — `FUN_004584E0`, class 0x30 state 27.
 *
 * Sub 0 freezes the actor in motion 0xB9 — root motion **off**, so it does not
 * drift while it waits — and arms the descriptor's delay. Sub 1 counts that
 * down and then turns root motion back on and plays the descriptor's own
 * emerge clip, whose translation is what lifts the actor out. Sub 2 plays it
 * out, throwing a splash at frames 22 and 35 if it is clip 178, and hands over
 * to `AttackRun`.
 */
export function ZombieStateEmerge(obj: Actor, dt: number,
                                  events?: Events): void {
  const p = obj.emerge;
  if (!p) { obj.state = ZombieState.AttackRun; obj.sub = 0; return; }

  if (obj.sub === 0) {
    // Off the world push and out of the ground snap until it is up: the pose
    // is under the floor on purpose.
    obj.flags2 &= ~ZombieFlag2.CollideWorld;
    obj.flags |= ActorFlag.PoseFrozen;
    obj.frozen = 1;
    ActorSetMotionBlended(obj, SUBMERGED_MOTION, 0, 0);
    obj.holdFrames = p.delay;              // +0x1330
    obj.sub = 1;
    return;
  }

  if (obj.sub === 1) {
    obj.holdFrames -= dt * 60;
    if (obj.holdFrames > 0) return;
    obj.frozen = 0;
    obj.flags &= ~ActorFlag.PoseFrozen;
    ActorSetMotionBlended(obj, p.motion, 0, 0);
    obj.sub = 2;
    return;
  }

  if (obj.motion === EMERGE_SPLASH_MOTION) {
    const f = frameOf(obj);
    for (const [frame, effect] of EMERGE_SPLASH_FRAMES) {
      if (f === frame) {
        events?.emit("feed.note", {
          name: "zombie", cat: "combat",
          note: `emerges — splash ${effect} at frame ${frame}`,
        });
      }
    }
  }
  if (atLastFrame(obj)) {
    obj.state = ZombieState.AttackRun;
    obj.sub = 0;
    obj.flags2 |= ZombieFlag2.CollideWorld;
  }
}

/**
 * `ZombieStateDelayedLeap` — `FUN_004581A0`, class 0x30 state 26.
 *
 * The arc is set up by `ActorArcBeginFalling` (`FUN_0040A090`), which is not
 * the class-0x31 waypoint arc: the descriptor gives a per-frame **downward
 * acceleration** rather than a duration, and the frame count is counted out by
 * simulating the drop until it passes the destination's height.
 */
export function ZombieStateDelayedLeap(obj: Actor, dt: number, rng: Rng): void {
  const p = obj.delayedLeap;
  if (!p) { obj.state = ZombieState.AttackRun; obj.sub = 0; return; }
  const frames = dt * 60;

  if (obj.sub === 0) {
    obj.flags |= ActorFlag.PoseFrozen;
    obj.backoffFrames = p.delay;           // +0x1334
    obj.sub = 1;
    return;
  }

  if (obj.sub === 1) {
    obj.backoffFrames -= frames;
    if (obj.backoffFrames >= 0) return;
    ActorArcBeginFalling(obj, p.dest, p.gravity);
    // The two jump clips: 0x399 when `obj+0x34` bit 0x1000000 is set, else
    // 0x3BB. Nothing ported sets that bit, so this always takes 0x3BB — the
    // arm is transcribed and unexercised.
    ActorSetMotionBlended(obj, LEAP_MOTION, 0, 1);
    obj.flags &= ~ActorFlag.PoseFrozen;
    obj.flags2 &= ~ZombieFlag2.CollideWorld;
    obj.flags |= ActorFlag.Airborne;
    obj.sub = 2;
  }

  if (obj.sub === 2 || obj.sub === 3) {
    obj.vel.x += obj.accX;
    obj.vel.y += obj.accY;
    obj.vel.z += obj.accZ;
    obj.holdFrames -= frames;
    if (obj.holdFrames < 0) {
      // Landed: stop, play the landing clip, and rejoin the attack loop.
      obj.vel.x = obj.vel.y = obj.vel.z = 0;
      obj.accX = obj.accY = obj.accZ = 0;
      obj.flags &= ~ActorFlag.Airborne;
      obj.flags2 |= ZombieFlag2.CollideWorld;
      if (obj.hp >= 1) ActorSetMotionBlended(obj, LEAP_LAND_MOTION, 0, 5);
      // `obj+0x1350 = play_length - rand() % 30 - 1`: how long the landing
      // holds before the actor starts walking.
      obj.targetLoops = Math.max(0, MotionPlayLength(obj) - rng.int(0x1e) - 1);
      obj.sub = 4;
    }
    return;
  }

  if (obj.sub === 4) {
    if (obj.hp < 1) {
      obj.state = ZombieState.Death;
      obj.sub = 0;
      return;
    }
    if (frameOf(obj) >= obj.targetLoops) {
      obj.state = ZombieState.AttackRun;
      obj.sub = 0;
    }
  }
  void LEAP_MOTION_ALT;
}

/**
 * `ActorArcBeginFalling` — `FUN_0040A090`.
 *
 * Not a duration: the caller gives a per-frame downward acceleration, and the
 * frame count is **counted out** by stepping `v -= a; y += v` until the height
 * has passed the destination's. Then x and z are flat over that many frames
 * and the initial y speed is `(n²a + 2Δy) / 2n`, which is the launch that
 * arrives exactly on the last one.
 */
export function ActorArcBeginFalling(obj: Actor,
                                     dest: readonly [number, number, number],
                                     accel: number): void {
  let n = 0;
  let v = 0;
  let y = obj.pos.y;
  if (dest[1] < y) {
    while (dest[1] < y && n < 3600) {
      v -= accel;
      n += 1;
      y += v;
    }
  }
  obj.holdFrames = n;                       // +0x1330, the frame count
  obj.accY = -accel;                        // +0x5C
  obj.accX = 0;                             // +0x58
  obj.accZ = 0;                             // +0x60
  const fn = Math.max(1, n);
  obj.vel.x = (dest[0] - obj.pos.x) / fn;
  obj.vel.y = (fn * fn * accel + 2 * (dest[1] - obj.pos.y)) / (fn + fn);
  obj.vel.z = (dest[2] - obj.pos.z) / fn;
}
