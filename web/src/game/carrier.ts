/**
 * Riding a carrier — the transform two classes push around their whole update.
 *
 * `CarriedZombieUpdate18` (`FUN_0045CD90`) and `CivilianUpdateOnCarrier`
 * (`FUN_0048B140`) are the same four calls in the same order:
 *
 * ```c
 * MatrixStackPush(0);
 * MatrixTranslate(carrier+0x40, +0x44, +0x48);
 * MatrixRotateX(carrier+0x64);
 * MatrixRotateZ(carrier+0x6C);
 * MatrixRotateY(carrier+0x68);
 * <the class's ordinary update>
 * MatrixStackPop(1);
 * ```
 *
 * so every position the state machine writes is already in the carrier's frame
 * and the draw inherits it. The port has no matrix stack in `game/` — that is
 * `render/`'s — so what it does instead is run the state machine on the
 * actor's own carrier-relative position exactly as the engine does, and
 * publish the composed world point on {@link Actor.carrierWorld} for the
 * renderer, the camera and the shot test to read. `[port-only]`
 *
 * `RotY` is innermost, so the product is `T · Rx · Rz · Ry`: a point is turned
 * by the yaw first and the translation applied last.
 */
import type { Actor } from "./actor";
import { BAMS_TO_RAD } from "../core/bams";
import {
  MatrixRotateX, MatrixRotateY, MatrixRotateZ, MatrixToEulerBams,
  MatrixTranslate, RotXZY, apply3, mul3, rotX, rotY, rotZ, type Mat,
} from "./matrix";
import type { Vec3 } from "./vec";

/**
 * `obj+0x34` bit `0x400000` on a carrier — **its riders are finished.**
 *
 * Raised by the run-past arm of the two carriers stage 3's riders stand on:
 * `OR dword ptr [EBP+0x34], 0x400000` at `0x00440610` in `CarrierPropRoutine1`
 * (path frame `0x55A`, ten frames after the bow strikes and throws its
 * effect) and at `0x0044151A` in `CarrierPropRoutine6` (with its state 5).
 * Its one reader is `ZombieStateRetireOffScreen` (`FUN_0045B7B0`), at
 * `0x0045B9A5`: a class-0x18 rider in state 38 whose carrier has the bit
 * retires on the spot (`game/class30/target.ts`). A search of the image for
 * the immediate at `[reg+0x34]` finds those three and no other, and none as a
 * byte test at `+0x36`.
 *
 * This file used to export `0x4000000` here as "the carrier is leaving and
 * its riders step off", with no reader: that bit is `ActorFlag.Dead`, which
 * routine 1's state 6 raises on the boat itself as it goes to state 7.
 */
export const CARRIER_RIDERS_DONE_BIT = 0x400000;

/**
 * `[port-only]` as a function -- the carrier's four calls on a matrix-stack
 * top, in the engine's order: `MatrixTranslate(carrier+0x40, +0x44, +0x48);
 * MatrixRotateX(+0x64); MatrixRotateZ(+0x6C); MatrixRotateY(+0x68)`.
 *
 * `CivilianUpdateOnCarrier` (`FUN_0048B140`) makes them around the whole
 * update, and class 0x10 makes them **again** where it takes the camera into
 * the carrier's frame: `CivilianStepTurnToTarget` (`FUN_0048C850`) onto an
 * identity it loads first, and `CivilianStepScript` (`FUN_0048B1E0`) onto the
 * stack as the update left it. `m` is the top they compose onto; this writes
 * it in place, as {@link MatrixTranslate} does.
 */
export function CarrierMatrixCompose(m: Mat, carrier: Actor): void {
  MatrixTranslate(m, carrier.pos.x, carrier.pos.y, carrier.pos.z);
  MatrixRotateX(m, carrier.pitch);
  MatrixRotateZ(m, carrier.roll);
  MatrixRotateY(m, carrier.yaw);
}

/**
 * `[port-only]` — `T · Rx · Rz · Ry` applied to a carrier-relative point.
 *
 * `FUN_0045D920` is the engine's own name for the bake both riders do when
 * they step off; this is the same arithmetic, available every frame rather
 * than only at the hand-over.
 */
export function CarrierTransformPoint(carrier: Actor, x: number, y: number,
                                      z: number, out: Vec3): void {
  // BAMS to radians. This multiplied by `vec.ts`'s `BAMS`, which is the
  // other direction -- 65536 / 2pi, *BAMS per radian* -- so every angle came
  // out 10430^2/65536 times too large and a rider's offset was spun to a
  // different point of the compass on every frame the carrier turned. Stage
  // 3's civilian, standing 7.8 below the boat's origin and 8 across it, was
  // thrown out of the hull and under the canal.
  const rx = carrier.pitch * BAMS_TO_RAD;
  const ry = carrier.yaw * BAMS_TO_RAD;
  const rz = carrier.roll * BAMS_TO_RAD;
  // RotY, innermost.
  let px = x * Math.cos(ry) + z * Math.sin(ry);
  let py = y;
  let pz = -x * Math.sin(ry) + z * Math.cos(ry);
  // ...then RotZ,
  const zx = px * Math.cos(rz) - py * Math.sin(rz);
  const zy = px * Math.sin(rz) + py * Math.cos(rz);
  px = zx; py = zy;
  // ...then RotX,
  const xy = py * Math.cos(rx) - pz * Math.sin(rx);
  const xz = py * Math.sin(rx) + pz * Math.cos(rx);
  py = xy; pz = xz;
  // ...and the translation last.
  out.x = carrier.pos.x + px;
  out.y = carrier.pos.y + py;
  out.z = carrier.pos.z + pz;
}

/**
 * `[port-only]` — publish a rider's world pose from its carrier, and say
 * whether it has one.
 *
 * A rider whose carrier has despawned keeps its last world point rather than
 * snapping to the origin, which is what an object whose frame of reference has
 * gone should look like.
 */
export function CarrierPublishWorld(obj: Actor, carrier: Actor | undefined):
    boolean {
  if (!carrier || carrier.despawned) return false;
  CarrierTransformPoint(carrier, obj.pos.x, obj.pos.y, obj.pos.z,
                        obj.carrierWorld);
  // The engine's draw inherits the carrier's rotation too; a rider's own yaw
  // is relative to it for the same reason its position is.
  obj.carrierYaw = carrier.yaw;
  return true;
}

/**
 * `CarrierBakeWorldPose` — `FUN_0045D920`. The step off: the carrier's matrix
 * times the rider's own, read back into the rider's position and angles.
 *
 * ```
 * LoadIdentity; Translate(carrier); RotX; RotZ; RotY;
 * Translate(obj); RotX; RotZ; RotY;
 * MatrixGetTranslation -> obj+0x40;  MatrixToEulerBams -> obj+0x64/68/6C
 * ```
 */
export function CarrierBakeWorldPose(obj: Actor, carrier: Actor): void {
  const out = { x: 0, y: 0, z: 0 };
  CarrierTransformPoint(carrier, obj.pos.x, obj.pos.y, obj.pos.z, out);
  const r = MatrixToEulerBams(mul3(
    RotXZY(carrier.pitch, carrier.roll, carrier.yaw),
    RotXZY(obj.pitch, obj.roll, obj.yaw)));
  obj.pos.x = out.x;
  obj.pos.y = out.y;
  obj.pos.z = out.z;
  obj.pitch = r.pitch;
  obj.yaw = r.yaw;
  obj.roll = r.roll;
}

/**
 * `[port-only]` — a world point in the carrier's own frame: the
 * `MatrixInvert(0); MatrixTransformPoint` the rider states make of the
 * carrier's matrix, written as the inverse it is,
 * `RotY(-y)·RotZ(-r)·RotX(-p)·(p - T)`.
 */
export function CarrierInverseTransformPoint(carrier: Actor, x: number,
                                             y: number, z: number,
                                             out: Vec3): void {
  const m = mul3(mul3(rotY(-carrier.yaw), rotZ(-carrier.roll)),
                 rotX(-carrier.pitch));
  const v = apply3(m, x - carrier.pos.x, y - carrier.pos.y, z - carrier.pos.z);
  out.x = v[0];
  out.y = v[1];
  out.z = v[2];
}
