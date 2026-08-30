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
import { TurnActorTowardCamera } from "../actor_turn";
import { ReleaseAttackSlot } from "../combat/permits";
import { FirstBakedOf, MotionRowOf } from "../tables";
import { dist2d, type Vec3 } from "../vec";
import { ZombieSetMotionIfIdle } from "./motion_cue";
import { ApproachInnerRadius } from "./ring";
import { BACKOFF_MAX_FRAMES, GAME_HZ, MotionFade, MotionRow, ZombieState } from "./states";

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
  // [diverges] The engine turns relative to `obj+0x13D8/E0`, where the strike
  // began, at a rate of -0x40 or +0x40 by a flag. What the sign *means* is
  // unresolved, and it matters: the strike ends only a few units from that
  // point, so the direction to it is near-degenerate and a wrong sign sends
  // the retreat in circles or straight back into the camera — both of which
  // this has now done.
  //
  // What the game shows is unambiguous, so the port states that instead: the
  // actor keeps facing the player and the back-away clip — whose root is +Z,
  // measured at +9.6 against the run's -30 — carries it backwards out of
  // range.
  TurnActorTowardCamera(obj, obj.hasStrikeAnchor ? obj.target : eye, dt);
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
