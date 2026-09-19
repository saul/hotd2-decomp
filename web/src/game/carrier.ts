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
import type { Vec3 } from "./vec";
import {
  MatIdentity, MatrixGetTranslation, MatrixInvert, MatrixRotateX, MatrixRotateY,
  MatrixRotateZ, MatrixToEulerBams, MatrixTransformPoint, MatrixTranslate,
} from "./matrix";

/** `obj+0x34` bit `0x4000000` — the carrier is leaving and its riders step off. */
export const CARRIER_LEAVING_BIT = 0x4000000;

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
 * `CarrierBakeWorldPose` — `FUN_0045D920`. Put a rider down in world space.
 *
 * ```
 * MatrixLoadIdentity();
 * Translate(carrier+0x40); RotX(+0x64); RotZ(+0x6C); RotY(+0x68);
 * Translate(obj+0x40);     RotX(+0x64); RotZ(+0x6C); RotY(+0x68);
 * obj+0x40 = MatrixGetTranslation();
 * MatrixToEulerBams(obj+0x64, obj+0x68, obj+0x6C);
 * ```
 *
 * **Position and orientation both.** The step-off this replaces baked only
 * the point, so a rider that left its boat kept its boat-relative yaw in world
 * space and faced wherever that happened to point. The engine then reloads
 * the camera's view onto the stack, which is the draw's business.
 */
export function CarrierBakeWorldPose(obj: Actor, carrier: Actor): void {
  const m = MatIdentity();
  MatrixTranslate(m, carrier.pos.x, carrier.pos.y, carrier.pos.z);
  MatrixRotateX(m, carrier.pitch);
  MatrixRotateZ(m, carrier.roll);
  MatrixRotateY(m, carrier.yaw);
  MatrixTranslate(m, obj.pos.x, obj.pos.y, obj.pos.z);
  MatrixRotateX(m, obj.pitch);
  MatrixRotateZ(m, obj.roll);
  MatrixRotateY(m, obj.yaw);
  MatrixGetTranslation(m, obj.pos);
  const e = MatrixToEulerBams(m);
  obj.pitch = e.rx;
  obj.yaw = e.ry;
  obj.roll = e.rz;
}

/**
 * A world point in a carrier's own space: `MatrixLoadIdentity; Translate;
 * RotX; RotZ; RotY` off the carrier, `MatrixInvert(0)`, `MatrixTransformPoint`.
 * `[port-only]` as a function -- the three carrier-leap states each spell
 * those calls out inline, and this is exactly them.
 */
export function CarrierLocalPoint(carrier: Actor, x: number, y: number,
                                  z: number, out: Vec3): void {
  const m = MatIdentity();
  MatrixTranslate(m, carrier.pos.x, carrier.pos.y, carrier.pos.z);
  MatrixRotateX(m, carrier.pitch);
  MatrixRotateZ(m, carrier.roll);
  MatrixRotateY(m, carrier.yaw);
  MatrixInvert(m);
  MatrixTransformPoint(m, { x, y, z }, out);
}
