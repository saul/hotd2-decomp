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
import { ActorFlag, ZombieFlag2, type ZombieActor } from "../actor";
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

/**
 * `ZombieStateDelayedLeap`'s clips.
 *
 * `LEAP_MOTION` is the ordinary jump and `LEAP_MOTION_ALT` the wind-up variant
 * `obj+0x34` bit 0x1000000 selects. `LEAP_LIMP_MOTION` is **not** a landing:
 * the state plays it only on `hp < 1`, for an actor shot out of the air.
 */
const LEAP_MOTION = 0x3bb;
const LEAP_MOTION_ALT = 0x399;
const LEAP_LIMP_MOTION = 0x3f7;
/** `0x399` holds in place to this play-clock frame, then starts moving... */
const LEAP_ALT_LAUNCH_FRAME = 0x1a;
/** ...and cross-fades into `LEAP_MOTION` at this one. */
const LEAP_ALT_HANDOFF_FRAME = 0x23;
/**
 * `obj+0x1330 < 0x15` — the pose comes out of its freeze for the last 0x15
 * frames of the arc, which is the landing anticipation.
 */
const LEAP_LANDING_FRAMES = 0x15;

/** The clip frame this actor is on — the engine's `obj+0x19C`, at 60 Hz. */
function frameOf(obj: ZombieActor): number {
  return MotionPlayFrame(obj);
}

function atLastFrame(obj: ZombieActor): boolean {
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
export function ZombieStateEmerge(obj: ZombieActor, dt: number,
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
    obj.zom.holdFrames = p.delay;              // +0x1330
    obj.sub = 1;
    return;
  }

  if (obj.sub === 1) {
    obj.zom.holdFrames -= dt * 60;
    if (obj.zom.holdFrames > 0) return;
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
 * Fourteen spawns: the burst-out entrance. The actor waits, then rides a
 * ballistic arc to a point the descriptor names — stage 3 block 4 step 6 drops
 * two of them 47 units onto the walkway.
 *
 * **The arc is the only thing that moves the actor, and the state enforces
 * that by freezing the pose.** `obj+0x34 |= 0x4000` goes up for the whole
 * flight and comes off for the last `0x15` frames, so the leap clip's own root
 * translation is suppressed while the parabola owns the position and allowed
 * back for the landing anticipation. The port had no freeze at all, so 0x3BB's
 * root motion was applied *on top of* the arc every frame and the actor
 * overshot straight through the floor.
 *
 * **And `0x3F7` is the clip a corpse takes, not a landing.** The engine plays
 * it only on `hp < 1` — an actor shot out of the air goes limp on the way
 * down. The port had the test inverted and played it for a live actor as it
 * landed, which is the "gets up from a seated position" the report names: it
 * is the slump, played on someone who is not dead, and then stood out of.
 * A live actor plays **no landing clip at all**; it keeps 0x3BB and holds on
 * its tail for `play_length - rand() % 30 - 1` frames.
 */
export function ZombieStateDelayedLeap(obj: ZombieActor, dt: number, rng: Rng): void {
  const p = obj.delayedLeap;
  if (!p) { obj.state = ZombieState.AttackRun; obj.sub = 0; return; }
  const frames = dt * 60;

  if (obj.sub === 0) {
    // `obj+0x34 |= 0x2000`, the arc-armed bit — **not** the pose freeze, which
    // this state raises later and for a different span.
    obj.flags |= ActorFlag.ArcSpent;
    obj.zom.backoffFrames = p.delay;           // +0x1334
    obj.sub = 1;
    return;
  }

  if (obj.sub === 1) {
    obj.zom.backoffFrames -= frames;
    if (obj.zom.backoffFrames >= 0) return;
    ActorArcBeginFalling(obj, p.dest, p.gravity);
    // The two jump clips and their two fades: 0x399 at fade 5 when `obj+0x34`
    // bit 0x1000000 is set, else 0x3BB at fade 1. Nothing ported sets that
    // bit, so this always takes 0x3BB — the arm is transcribed and
    // unexercised, and `LEAP_MOTION_ALT`'s own wind-up below with it.
    const alt = (obj.flags & ActorFlag.HoldingWeapon) !== 0;
    ActorSetMotionBlended(obj, alt ? LEAP_MOTION_ALT : LEAP_MOTION, 0,
                          alt ? 5 : 1);
    // `obj+0x136C = (obj+0x136C & 0xDFFEFFFF) | 0x4000` — off the world push
    // for the flight, and the leap's own bit up.
    obj.flags2 &= ~(ZombieFlag2.CollideWorld | ZombieFlag2.OffScreenPermit);
    obj.flags2 |= ZombieFlag2.Leaping;
    obj.flags &= ~ActorFlag.HoldingWeapon;
    obj.sub = 2;
  }

  if (obj.sub === 2) {
    // The 0x399 wind-up: it plays in place to frame 0x1A, then integrates to
    // 0x23, then cross-fades into 0x3BB for the rest of the arc. A clip that
    // is not 0x399 skips all of it and falls straight into sub 3.
    if (obj.motion === LEAP_MOTION_ALT) {
      const f = MotionPlayFrame(obj);
      if (f === LEAP_ALT_HANDOFF_FRAME) {
        ActorSetMotionBlended(obj, LEAP_MOTION, 0, 0xc);
        obj.sub = 3;
        return;
      }
      if (f > LEAP_ALT_LAUNCH_FRAME) { ZombieLeapIntegrate(obj); }
      return;
    }
    obj.sub = 3;
  }

  if (obj.sub === 3) {
    ZombieLeapIntegrate(obj);
    // **The freeze.** Off before the clip has started and for the last 0x15
    // frames of the arc; on for everything between, which is the span the
    // parabola must own alone.
    if (MotionPlayFrame(obj) < 1 || obj.zom.holdFrames < LEAP_LANDING_FRAMES) {
      obj.flags &= ~ActorFlag.PoseFrozen;
      obj.frozen = 0;
    } else {
      obj.flags |= ActorFlag.PoseFrozen;
      obj.frozen = 1;
      // Shot out of the air: go limp for the rest of the drop.
      if (obj.hp < 1 && obj.motion !== LEAP_LIMP_MOTION) {
        ActorSetMotionBlended(obj, LEAP_LIMP_MOTION, 0, 5);
      }
    }

    obj.zom.holdFrames -= frames;
    if (obj.zom.holdFrames >= 0) return;

    // Down. The push comes back on, the arc stops, and the hold is measured
    // off **whatever clip is playing** — 0x3BB for a live actor, 0x3F7 for one
    // that died on the way.
    obj.flags2 |= ZombieFlag2.CollideWorld;
    obj.vel.x = obj.vel.y = obj.vel.z = 0;
    obj.accX = obj.accY = obj.accZ = 0;
    obj.frozen = 0;
    obj.flags &= ~ActorFlag.PoseFrozen;
    obj.zom.targetLoops = MotionPlayLength(obj) - rng.int(0x1e) - 1;
    // `if (!(obj+0x136C & 0x10000000)) obj+0x34 &= ~0x20000` — the ground snap
    // comes back, unless something else is still holding the actor up. That
    // bit is unported and never set, so this always clears.
    obj.flags &= ~ActorFlag.Airborne;
    obj.sub = 4;
  }

  if (obj.sub !== 4) return;
  if (obj.hp < 1) {
    obj.state = ZombieState.Death;
    obj.sub = 0;
    obj.flags2 = (obj.flags2 & ~ZombieFlag2.Leaping) | ZombieFlag2.DiedInFlight;
    return;
  }
  if (obj.zom.targetLoops <= MotionPlayFrame(obj)) {
    obj.flags2 &= ~ZombieFlag2.Leaping;
    obj.flags &= ~ActorFlag.ArcSpent;
    obj.state = ZombieState.AttackRun;
    obj.sub = 0;
  }
}

/** `vel += acc`, which is the whole of the arc's per-frame step. */
function ZombieLeapIntegrate(obj: ZombieActor): void {
  obj.vel.x += obj.accX;
  obj.vel.y += obj.accY;
  obj.vel.z += obj.accZ;
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
export function ActorArcBeginFalling(obj: ZombieActor,
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
  obj.zom.holdFrames = n;                       // +0x1330, the frame count
  obj.accY = -accel;                        // +0x5C
  obj.accX = 0;                             // +0x58
  obj.accZ = 0;                             // +0x60
  const fn = Math.max(1, n);
  obj.vel.x = (dest[0] - obj.pos.x) / fn;
  obj.vel.y = (fn * fn * accel + 2 * (dest[1] - obj.pos.y)) / (fn + fn);
  obj.vel.z = (dest[2] - obj.pos.z) / fn;
}
