/**
 * `ZombieStateFallToGround` — `FUN_00454B90`, class 0x30 state 11.
 *
 * Where `ActorSnapToGroundHeight` sends an actor that is more than ten units
 * above the floor and allowed to leave it. It is a plain drop: gravity on
 * `obj+0x50`, a ground query every frame, and a landing clip.
 *
 * It matters here because the *snap* is what routes into it. Without the snap
 * nothing in the port ever noticed an actor was in the air; with it, an actor
 * the script has put over a drop now falls to the floor instead of hanging.
 */
import type { Rng } from "../../core/rng";
import { ActorFlag, ZombieFlag2, type ZombieActor } from "../actor";
import { QueryGroundHeightAt } from "../coli";
import { MotionPlayFrame, MotionPlayLength } from "../tables";
import { ActorSetMotionBlended } from "./motion_cue";
import { ZombieState } from "./states";

/** `0xBE2740DA` and `0xBDA740DA` — the ordinary fall and body condition 4's. */
const FALL_GRAVITY = -0.16333;
const FALL_GRAVITY_LIGHT = -0.08167;
/** The clip the landing plays, from frame 15, when the actor is still alive. */
const LAND_MOTION = 0x3ba;
const LAND_FRAME = 0xf;
/** Body condition 4 bounces instead, at a quarter of the impact speed. */
const BOUNCE = -0.25;
const BOUNCE_MOTION = 0x41d;
const LIGHT_CONDITION = 4;

export function ZombieStateFallToGround(obj: ZombieActor, dt: number,
                                        rng: Rng): void {
  const frames = dt * 60;
  if (obj.sub === 0) {
    obj.flags |= ActorFlag.Airborne | 0x2400;
    obj.flags2 |= 0x100000;
    if (obj.condition === LIGHT_CONDITION) {
      ActorSetMotionBlended(obj, BOUNCE_MOTION, rng.int(5), 5);
      obj.accY = FALL_GRAVITY_LIGHT;
    } else {
      obj.accY = FALL_GRAVITY;
    }
    obj.sub = 1;
  }

  if (obj.sub === 1) {
    obj.vel.y += obj.accY * frames;
    // The probe starts at the actor's *tracked* point, `obj+0x104`, not at its
    // feet — a falling body is measured from where the camera sees it.
    const ground = QueryGroundHeightAt(obj.pos.x, obj.lookAt.y, obj.pos.z);
    if (ground < obj.pos.y + obj.vel.y) return;
    obj.pos.y = ground;
    if (obj.condition === LIGHT_CONDITION) {
      obj.vel.y *= BOUNCE;
      if (Math.abs(obj.vel.y) > 0.15) return;      // still bouncing
    } else if (obj.hp < 1) {
      ActorSetMotionBlended(obj, LAND_MOTION, LAND_FRAME, 1);
    }
    obj.vel.x = obj.vel.y = obj.vel.z = 0;
    obj.accX = obj.accY = obj.accZ = 0;
    obj.flags &= ~(ActorFlag.Airborne | 0x2400);
    obj.flags2 &= ~(0x100000 as number);
    obj.sub = 2;
  }

  // `obj+0x19C >= g_motion_play_length[motion] - 1`, both in the play clock.
  const len = MotionPlayLength(obj);
  if (len > 0 && MotionPlayFrame(obj) === len - 1) {
    obj.state = ZombieState.AttackRun;
    obj.sub = 0;
  }
  void ZombieFlag2;
}
