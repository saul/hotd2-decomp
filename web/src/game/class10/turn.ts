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
import { CameraBlockWorldToView } from "../camera/view";
import { CarrierMatrixCompose } from "../carrier";
import { ActorByAt, G } from "../globals";
import {
  MatCopy, MatIdentity, MatrixInvert, MatrixLoadIdentity,
  MatrixTransformPoint,
} from "../matrix";
import { CivilianTarget } from "./ops";

/** `CivilianStepTurnToTarget`'s own cap, the literal at `0x0048C8FE`. */
const CIVILIAN_TURN_CAP = 0x100;

/**
 * What a camera target's carrier arm composes the carrier onto.
 *
 * [port-only] The one instruction the two inline copies of the arm do not
 * share, as a value: see {@link CivilianTargetPoint}.
 */
export enum CivilianCarrierBase {
  /** `CivilianStepTurnToTarget`: `MatrixLoadIdentity` at `0x0048C8D4`. */
  Identity,
  /**
   * `CivilianStepScript`: the push at `0x0048B3B0` and straight on to
   * `MatrixTranslate` at `0x0048B3C0`, so the top as `CivilianUpdate` has it.
   */
  StackTop,
}

const _m = MatIdentity();

/**
 * Where `targetMode` says the target is, this frame, in the frame the
 * civilian's own position is kept in.
 *
 * [port-only] No routine of its own: `CivilianStepTurnToTarget`
 * (`FUN_0048C850`) and `CivilianStepScript` (`FUN_0048B1E0`) each build the
 * point inline, by the same three rules. One copy, because two is how they
 * drift -- and the copies do differ, by one instruction, in the arm a
 * civilian on a carrier takes. That difference is `base`.
 *
 * **On a carrier, a camera target is taken into the carrier's frame**, where
 * her position is kept. Both copies test `CMP dword ptr [EAX], 0x48b140` --
 * her update is still `CivilianUpdateOnCarrier` (`FUN_0048B140`) -- after
 * resolving a negative mode (`0x0048C8C1` in the turn, `0x0048B39D` in the
 * step), then push, make the carrier's `Translate; RotX; RotZ; RotY`, and
 * `MatrixInvert(0); MatrixTransformPoint` the point. Ghidra's pseudocode of
 * the step stops at that arm's `MatrixStackPop` (`0x0048B429`); the bytes
 * run on at `0x0048B42E` to store the result as the point and into the
 * reach and turn tests (L35). A fixed point (`targetMode >= 0`) is read raw
 * from `sub+0x30` in both, carrier or not. `[proved]`
 *
 * **The turn loads the identity first and the step does not.** So the turn
 * inverts the carrier's matrix alone and gets the camera in her frame; the
 * step inverts the carrier composed onto what the stack already holds --
 * `UpdateSceneViewAndLight`'s world-to-view (`SetTop` at `0x00402136`) and
 * `CivilianUpdateOnCarrier`'s own push of the same carrier -- so its `Reach`
 * and `Face` tests measure against `(V·C·C)⁻¹·eye`, a point that is not the
 * camera in any frame. That is the engine's own omission and the port keeps
 * it. The push is `[proved]` (`MatrixStackPush` copies the top when handed
 * 0); that the top is the view when `CivilianUpdate` starts is `[likely]`:
 * `UpdateSceneViewAndLight` sets it before any actor, and `CivilianUpdate`'s
 * sphere switch gets a world point back from the draw's records by
 * multiplying them by the view-to-world matrix, which only works if the draw
 * composed onto the world-to-view.
 *
 * Stage 3's `0x0BC0` (script 25, cmd 6: `Reach` within 18 of the camera,
 * riding the boat) and stage 4's four riders (scripts 65 and 66, turning to
 * the camera behind a counter wait) are the shipped inputs. The port had
 * neither transform, and turned them toward the world eye from a
 * carrier-relative position.
 *
 * `[port-only]` A rider whose carrier has left the pool keeps the point
 * untransformed: the engine reads the freed block's last words through
 * `sub+0x68`, and the pool keeps none -- the same seam
 * `CarrierPublishWorld` handles by keeping the last world point.
 */
export function CivilianTargetPoint(obj: Actor, base: CivilianCarrierBase):
    { x: number; y: number; z: number } {
  const sub = obj.civ;
  if (!sub) return { x: 0, y: 0, z: 0 };
  if (sub.targetMode >= 0) return sub.target;
  // Both inline copies read `g_camera_eye` by address -- `0x0048C878..8B3`
  // here, `0x0048B356..38F` in the step -- the gameplay eye.
  const eye = G.g_camera_eye;
  const p = sub.targetMode === CivilianTarget.Camera
    ? { x: eye.x, y: eye.y, z: eye.z }
    : { x: obj.pos.x * 2 - eye.x, y: eye.y, z: obj.pos.z * 2 - eye.z };
  const carrier = obj.carrierAt >= 0 ? ActorByAt(obj.carrierAt) : undefined;
  if (!carrier) return p;
  const m = _m;
  if (base === CivilianCarrierBase.StackTop) {
    MatCopy(m, CameraBlockWorldToView(G.g_camera_index));
    CarrierMatrixCompose(m, carrier);        // `CivilianUpdateOnCarrier`'s
  } else {
    MatrixLoadIdentity(m);
  }
  CarrierMatrixCompose(m, carrier);
  MatrixInvert(m);
  MatrixTransformPoint(m, p, p);
  return p;
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
export function CivilianStepTurnToTarget(obj: Actor): void {
  const sub = obj.civ;
  if (!sub) return;
  ActorTurnTowardPoint(obj,
                       CivilianTargetPoint(obj, CivilianCarrierBase.Identity),
                       CIVILIAN_TURN_CAP);
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
