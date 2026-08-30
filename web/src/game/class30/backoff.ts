/**
 * `ZombieStateBackOff` — `FUN_00455C30`.
 *
 * After a strike the actor **keeps the permit** and retreats, playing `row[4]`
 * — which carries 0.429 units per frame of root motion the other way — until
 * it is back outside the inner ring or 240 frames have passed. Only then does
 * it release, and it returns to `ZombieStateHoldAtRange`, not to the approach.
 *
 * That retreat is the pause between attacks, and returning to the hub rather
 * than to the approach is what makes the next zombie's turn come round
 * promptly instead of after a fresh walk-in.
 */
import type { Rng } from "../../core/rng";
import { ActorFlag, type Actor } from "../actor";
import { TurnActorAwayFromPoint } from "../actor_turn";
import { ReleaseAttackSlot } from "../combat/permits";
import { FirstBakedOf, MotionRowOf } from "../tables";
import { dist2d, type Vec3 } from "../vec";
import { ZombieSetMotionIfIdle } from "./motion_cue";
import { ApproachInnerRadius } from "./ring";
import { BACKOFF_MAX_FRAMES, GAME_HZ, MotionFade, MotionRow, ZombieState } from "./states";

/** `FUN_00409F90`'s rate here, positive when `obj+0x136C & 0x400000` is set. */
const BACKOFF_TURN_RATE = -0x40;

export function ZombieStateBackOff(obj: Actor, eye: Vec3, dt: number,
                                   rng: Rng): void {
  if (obj.sub === 0) {
    obj.cooldown = 0x3c;              // +0x1338, the engine's own 60
    obj.backoffFrames = 0;            // +0x1334
    // `obj+0x34 |= 0x20000000`: out of the compacted queue while retreating,
    // so whoever is behind moves up and can take its turn.
    obj.flags |= ActorFlag.BackingOff;
    obj.sub = 1;
  }

  ZombieSetMotionIfIdle(obj,
    FirstBakedOf(obj, MotionRowOf(obj), MotionRow.BackAway), rng, 5, MotionFade.Normal);
  // Back toward where *this* actor's strike began — `obj+0x13D8/E0`, captured
  // when it started the swing — and not simply away from the player.
  //
  // That distinction is the closest thing this engine has to keeping enemies
  // apart. There is no separation pass anywhere: the class-0x30 update has
  // none, the two radii at `obj+0x124`/`+0x128` feed the bounding sphere, the
  // screen test and the shot test and nothing else, and the sort is a plain
  // radix sort. What stops a crowd piling up is that only `g_enemy_approach_steps`
  // of them may come inside the mid ring at all, only one may attack, and
  // **each attacker goes back to the spot it came from**. Retreating along a
  // shared radial away from the player instead, as this did, funnels every
  // one of them onto the same line.
  //
  // The negative rate turns to the *opposite* of `VecToAngles(obj - p)`: the
  // anchor is further out than the actor now is, so the unflipped angle points
  // inward and the back-away clip's +Z root would carry it into the camera.
  TurnActorAwayFromPoint(obj, obj.strikeStart, BACKOFF_TURN_RATE, dt);
  obj.backoffFrames += dt * GAME_HZ;

  // Distance is measured against the remembered player point, the same one the
  // lunge used.
  const d = dist2d(obj.pos, obj.hasStrikeAnchor ? obj.target : eye);
  if (d > ApproachInnerRadius(obj) || obj.backoffFrames > BACKOFF_MAX_FRAMES) {
    obj.cooldown = 0;
    obj.flags &= ~ActorFlag.BackingOff;
    ReleaseAttackSlot(obj);          // only now is the next enemy free
    obj.hasStrikeAnchor = false;
    obj.state = ZombieState.HoldAtRange;
    obj.sub = 0;
  }
}
