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

// -- the rotation half of a carrier's matrix, for the step off -------------

/** A 3x3 rotation, row-major, acting on column vectors. `[port-only]`. */
export type Rot3 = [number, number, number, number, number, number,
                    number, number, number];

/** `0x004C4378`, radians to BAMS: the double every angle read-back multiplies by. */
const RAD_TO_BAMS_F64 = 65536 / (2 * Math.PI);

/** `__ftol` then `MOVSX AX`: truncate, keep the low sixteen bits, signed. */
function s16(v: number): number {
  return (Math.trunc(v) << 16) >> 16;
}

function mul3(a: Rot3, b: Rot3): Rot3 {
  const o = new Array(9).fill(0) as Rot3;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c]
        + a[r * 3 + 2] * b[6 + c];
    }
  }
  return o;
}
function rotX(b: number): Rot3 {
  const c = Math.cos(b * BAMS_TO_RAD), s = Math.sin(b * BAMS_TO_RAD);
  return [1, 0, 0, 0, c, -s, 0, s, c];
}
function rotY(b: number): Rot3 {
  const c = Math.cos(b * BAMS_TO_RAD), s = Math.sin(b * BAMS_TO_RAD);
  return [c, 0, s, 0, 1, 0, -s, 0, c];
}
function rotZ(b: number): Rot3 {
  const c = Math.cos(b * BAMS_TO_RAD), s = Math.sin(b * BAMS_TO_RAD);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}
function apply3(m: Rot3, x: number, y: number, z: number): [number, number, number] {
  return [m[0] * x + m[1] * y + m[2] * z, m[3] * x + m[4] * y + m[5] * z,
          m[6] * x + m[7] * y + m[8] * z];
}

/**
 * `RotX(p); RotZ(r); RotY(y)` — every actor pose's composition, as one
 * matrix. `[port-only]`: the engine builds it on the stack.
 */
export function RotXZY(pitch: number, roll: number, yaw: number): Rot3 {
  return mul3(mul3(rotX(pitch), rotZ(roll)), rotY(yaw));
}

/**
 * `MatrixToEulerBams` — `FUN_00401AE0`, with `FUN_00401800` inline. Takes a
 * `RotX; RotZ; RotY` pose back off a rotation:
 *
 * ```
 * u = M·(0,1,0);  pitch = s16(atan2(u.z, u.y) * K);
 * cr = ((pitch + 0x2000) & 0x4000) ? u.z / sin(pitch) : u.y / cos(pitch);
 * roll = -s16(atan2(u.x, cr) * K);
 * v = RotZ(-roll)·RotX(-pitch)·M·(0,0,1);  yaw = s16(atan2(v.x, v.z) * K);
 * ```
 */
export function MatrixToEulerBams(m: Rot3):
    { pitch: number; yaw: number; roll: number } {
  const u = apply3(m, 0, 1, 0);
  const pitch = s16(Math.atan2(u[2], u[1]) * RAD_TO_BAMS_F64);
  const cr = ((pitch + 0x2000) & 0x4000) === 0
    ? u[1] / Math.cos(pitch * BAMS_TO_RAD)
    : u[2] / Math.sin(pitch * BAMS_TO_RAD);
  const roll = -s16(Math.atan2(u[0], cr) * RAD_TO_BAMS_F64);
  const f = apply3(m, 0, 0, 1);
  const v = apply3(mul3(rotZ(-roll), rotX(-pitch)), f[0], f[1], f[2]);
  const yaw = s16(Math.atan2(v[0], v[2]) * RAD_TO_BAMS_F64);
  return { pitch, yaw, roll };
}

/**
 * `MatrixGetAngles` — `FUN_004018E0`. The other decomposition,
 * `M = RotY(y)·RotX(x)·RotZ(z)`: the heading and elevation of `M·(0,0,1)`
 * through `VecToAngles`, then the roll off `M·(1,0,0)` with those two undone
 * (`RotX(-x); RotY(-y)`).
 *
 * The elevation is `VecToAngles` (`FUN_004016B0`) exactly, `[proved]` from
 * its instructions: `FLD x; FLD z; FPATAN` is the heading, `__ftol`'d to an
 * s16; the horizontal length is `z / cos(heading)` or, when
 * `(heading + 0x2000) & 0x4000`, `x / sin(heading)` (`FCOS; FDIVR [z]` /
 * `FSIN; FDIVR [x]` at `0x004016E7`..`0x004016F1`) -- not a `hypot`; and the
 * elevation is `NEG` of the s16 of `atan2(y, length)` (`0x0040170F`). This
 * said `[likely]` and used `hypot`, which is the same up to the heading's
 * truncation.
 */
export function MatrixGetAngles(m: Rot3): { x: number; y: number; z: number } {
  const f = apply3(m, 0, 0, 1);
  const y = s16(Math.atan2(f[0], f[2]) * RAD_TO_BAMS_F64);
  const len = ((y + 0x2000) & 0x4000) === 0
    ? f[2] / Math.cos(y * BAMS_TO_RAD) : f[0] / Math.sin(y * BAMS_TO_RAD);
  const x = -s16(Math.atan2(f[1], len) * RAD_TO_BAMS_F64);
  const r = apply3(m, 1, 0, 0);
  const v = apply3(mul3(rotX(-x), rotY(-y)), r[0], r[1], r[2]);
  const z = s16(Math.atan2(v[1], v[0]) * RAD_TO_BAMS_F64);
  return { x, y, z };
}

/** `RotY(y); RotX(x); RotZ(z)`, `MatrixGetAngles`' own order. `[port-only]`. */
export function RotYXZ(y: number, x: number, z: number): Rot3 {
  return mul3(mul3(rotY(y), rotX(x)), rotZ(z));
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
