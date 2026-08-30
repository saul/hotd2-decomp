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
import type { Actor } from "../actor";
import { TurnActorAwayFromPoint } from "../actor_turn";
import { ReleaseAttackSlot } from "../combat/permits";
import { MotionRowOf } from "../tables";
import { dist2d, type Vec3 } from "../vec";
import { ZombieSetMotionIfIdle } from "./motion_cue";
import { ApproachInnerRadius } from "./ring";
import { BACKOFF_MAX_FRAMES, GAME_HZ, MotionRow, ZombieState } from "./states";

/** `FUN_00409F90`'s rate here, negated when `obj+0x136C & 0x400000` is set. */
const BACKOFF_TURN_RATE = -0x40;

export function ZombieStateBackOff(obj: Actor, eye: Vec3, dt: number): void {
  if (obj.sub === 0) {
    obj.cooldown = 0x3c;              // +0x1338, the engine's own 60
    obj.backoffFrames = 0;            // +0x1334
    obj.sub = 1;
  }

  ZombieSetMotionIfIdle(obj, MotionRowOf(obj)[MotionRow.BackAway]);
  // Turn relative to where the strike began, not to the camera: the actor
  // lunged forward to swing and walks back out along the same line.
  TurnActorAwayFromPoint(obj, obj.strikeStart, BACKOFF_TURN_RATE, dt);
  obj.backoffFrames += dt * GAME_HZ;

  // Distance is measured against the remembered player point, the same one the
  // lunge used.
  const d = dist2d(obj.pos, obj.hasStrikeAnchor ? obj.target : eye);
  if (d > ApproachInnerRadius(obj) || obj.backoffFrames > BACKOFF_MAX_FRAMES) {
    obj.cooldown = 0;
    ReleaseAttackSlot(obj);          // only now is the next enemy free
    obj.hasStrikeAnchor = false;
    obj.state = ZombieState.HoldAtRange;
    obj.sub = 0;
  }
}
