/**
 * Where the target is, and turning toward it.
 *
 * `CivilianStepTurnToTarget` (`FUN_0048C850`) and `ActorTurnTowardPoint`
 * (`FUN_0048C990`) are the engine's two, and the target resolution is here
 * with them because the wait tests in `step.ts` resolve it the same way — the
 * annotation on `FUN_0048C850` says so in as many words, and the port had it
 * written out twice before it did.
 */
import type { Actor } from "../actor";
import type { ClassFrame } from "../registry";
import { CivilianTarget } from "./ops";

/** `CivilianStepTurnToTarget`'s own cap, the literal at `0x0048C8FE`. */
const CIVILIAN_TURN_CAP = 0x100;

/**
 * Where `targetMode` says the target is, this frame.
 *
 * [port-only] No routine of its own: `CivilianStepTurnToTarget`
 * (`FUN_0048C850`) and `CivilianStepScript` (`FUN_0048B1E0`) each build the
 * point inline, by the same three rules. One copy, because two is how they
 * drift.
 */
export function CivilianTargetPoint(obj: Actor, f: ClassFrame):
    { x: number; y: number; z: number } {
  const sub = obj.civ;
  if (!sub) return { x: 0, y: 0, z: 0 };
  if (sub.targetMode >= 0) return sub.target;
  if (sub.targetMode === CivilianTarget.Camera) {
    return { x: f.eye.x, y: f.eye.y, z: f.eye.z };
  }
  return { x: obj.pos.x * 2 - f.eye.x, y: f.eye.y,
           z: obj.pos.z * 2 - f.eye.z };
}

/**
 * The BAMS the actor would have to turn to face `to`.
 *
 * [port-only] The front half of `ActorTurnTowardPoint` (`FUN_0048C990`),
 * which is also what the `Face` wait bit tests against zero. It has no address
 * of its own; it is named so the wait test and the turn cannot disagree about
 * what "facing" means.
 */
export function HeadingError(obj: Actor, to: { x: number; z: number }): number {
  const want = Math.atan2(obj.pos.x - to.x, obj.pos.z - to.z);
  const have = obj.yaw * ((Math.PI * 2) / 65536);
  let d = want - have;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.trunc(d * (65536 / (Math.PI * 2)));
}

/**
 * `CivilianStepTurnToTarget` — `FUN_0048C850`, and the turn itself is
 * `ActorTurnTowardPoint` (`FUN_0048C990`).
 *
 * One capped step of yaw per frame toward whatever `targetMode` names.
 *
 * **The cap is a literal.** `FUN_0048C850` passes `0x100` and nothing else;
 * it never reads `sub+0x0E`, which is what op 3 writes and what this port had
 * been passing instead. That is 256 BAMS a frame against a default of ten —
 * twenty-five times too slow — and it is why stage 2's `0x138BC` could not
 * finish the `Face` wait at command 4 of her stream: `SetTargetHeading 35328`
 * asks her to turn 194 degrees, which is 138 frames at the engine's rate and
 * nearly a minute at ten. `wait_scripted_actors` at block 30 waited behind
 * her the whole time.
 */
export function CivilianStepTurnToTarget(obj: Actor, f: ClassFrame): void {
  const sub = obj.civ;
  if (!sub) return;
  ActorTurnTowardPoint(obj, CivilianTargetPoint(obj, f), CIVILIAN_TURN_CAP);
}

/**
 * `ActorTurnTowardPoint` — `FUN_0048C990`. Turn `obj` toward `to`, by at most
 * `cap` BAMS this frame.
 */
export function ActorTurnTowardPoint(obj: Actor,
                                     to: { x: number; y: number; z: number },
                                     cap: number): void {
  const err = HeadingError(obj, to);
  const step = err > cap ? cap : err < -cap ? -cap : err;
  obj.yaw = (obj.yaw + step) & 0xffff;
}
