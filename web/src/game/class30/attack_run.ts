/**
 * `ZombieStateAttackRun` — `FUN_004554D0`.
 *
 * Close on the camera until `TestApproachRing` returns band 1, then strike.
 */
import type { Actor } from "../actor";
import type { Vec3 } from "../vec";
import { ActorAdvanceTowardCamera } from "./move";
import { TestApproachRing } from "./ring";
import { STATE_STRIKE } from "./states";

export function ZombieStateAttackRun(obj: Actor, eye: Vec3, dt: number): void {
  if (TestApproachRing(obj, eye).band === 1) {
    obj.state = STATE_STRIKE;
    obj.sub = 0;
    obj.backoffFrames = 0;
    return;
  }
  ActorAdvanceTowardCamera(obj, eye, dt);
}
