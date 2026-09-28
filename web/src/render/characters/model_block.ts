/**
 * Drawing an actor that carries the engine's own model block
 * (`Actor.skel`, `game/skeleton.ts`) -- class 0x14 today.
 *
 * Nothing is posed here. The game has already posed the model the way the
 * engine does, inside the class's own update, and left every bone's world
 * matrix in its record; this layer's job is the engine's **draw**, which for
 * the stage-2 boss is `Class14AdvanceMotionAndPublishPoints`
 * (`FUN_00476AD0`)'s tail, `0x0047791A..0x00477BB5`:
 *
 * ```
 * if (char+0x64 & 1) {
 *     top = T(0, dy, 0)                               ; in view space
 *     bones 1..9: AssetDrawSlot(rec(i)) under V(i) * T(dy)
 *                 bone 1 also draws flipbooks A and B there
 *     leg A: V13 * T(dy), RotY(+0x6C), RotX(+0x64)      -> bone 13
 *            Translate(0, -8.432, 0), RotX(+0x74 + kneeA) -> bone 14
 *            Translate(0, -9.514, 0) -> the ankle; bone 15 in V15's own
 *            rotation at that ankle
 *     leg B: the same over bones 10, 11, 12 with +0x70, +0x68, +0x78 + kneeB
 * }
 * ```
 *
 * `dy` is the frame's y-follow step, applied **in view space** (along the
 * camera's up) by the draw where the leg IK applied it in world space --
 * `[proved]`, and the class publishes it with the two knee rest angles
 * because the engine keeps them in the routine's locals.
 *
 * The part the skeleton walk draws (`boss2.bin`'s vertex-blended waist,
 * part 0) follows bones 1 and 9 through its skin; its draw byte is
 * `Actor.partVisible[0]`.
 */
import { Matrix4, Vector3, type Object3D } from "three";
import type { Actor } from "../../game/actor";
import { MotionFlag } from "../../game/actor";
import { SpawnClass } from "../../game/spawn_class";
import { BAMS_TO_RAD } from "../../core/bams";
import type { Instance } from "./instance";

/** `0x4106E979` / `0x41183958` — the thigh and the shin. */
const THIGH = Math.fround(8.432);
const SHIN = Math.fround(9.514);
/** The bones the tail draws under `V(i) * T(dy)`. */
const UPPER_BONES = [1, 2, 3, 4, 5, 6, 7, 8, 9];

const _parentInv = new Matrix4();
const _world = new Matrix4();
const _local = new Matrix4();
const _t = new Matrix4();
const _ankle = new Vector3();

/**
 * `M = M * R` -- the engine's `MatrixRotate*` / `MatrixTranslate` applied to
 * a three.js matrix, whose elements are `g_MatrixStackTop`'s own layout. The
 * same helpers `render/slotmodels.ts` draws the carrier's wake with.
 */
function mTranslate(m: Matrix4, x: number, y: number, z: number): void {
  m.multiply(_t.makeTranslation(x, y, z));
}
function mRotX(m: Matrix4, b: number): void {
  m.multiply(_t.makeRotationX(b * BAMS_TO_RAD));
}
function mRotY(m: Matrix4, b: number): void {
  m.multiply(_t.makeRotationY(b * BAMS_TO_RAD));
}

/**
 * The world matrix each bone is drawn with this frame.
 */
function Boss2DrawMatrices(a: Actor, up: { x: number; y: number; z: number },
                           out: Map<number, Matrix4>): boolean {
  const skel = a.skel;
  if (!skel || a.cls !== SpawnClass.Boss2) return false;
  const t = a.boss2;
  const dy = t.drawDy;
  const take = (b: number): Matrix4 => {
    const m = out.get(b) ?? new Matrix4();
    out.set(b, m);
    return m;
  };
  // `V(i) * T(0, dy, 0)` with the translation in view space: in world space
  // that is `dy` along the camera's up.
  const lift = (m: Matrix4): Matrix4 => {
    const e = m.elements;
    e[12] += up.x * dy; e[13] += up.y * dy; e[14] += up.z * dy;
    return m;
  };
  for (const b of UPPER_BONES) {
    const r = skel.bones[b];
    if (r) lift(take(b).fromArray(r.mat));
  }
  const leg = (hip: number, knee: number, foot: number, pitch: number,
               yaw: number, kneeAngle: number): void => {
    const H = skel.bones[hip], F = skel.bones[foot];
    if (!H || !F) return;
    const mh = lift(take(hip).fromArray(H.mat));
    mRotY(mh, yaw);
    mRotX(mh, pitch);
    const mk = take(knee).copy(mh);
    mTranslate(mk, 0, -THIGH, 0);
    mRotX(mk, kneeAngle);
    _world.copy(mk).multiply(_t.makeTranslation(0, -SHIN, 0));
    _ankle.setFromMatrixPosition(_world);
    const mf = take(foot).fromArray(F.mat);
    mf.setPosition(_ankle);
  };
  leg(13, 14, 15, t.legs[0], t.legs[2], (t.legs[4] + t.kneeRest[0]) | 0);
  leg(10, 11, 12, t.legs[1], t.legs[3], (t.legs[5] + t.kneeRest[1]) | 0);
  return true;
}

const _mats = new Map<number, Matrix4>();

/**
 * Put every bone node of `inst` where the engine's draw puts it. `up` is the
 * camera's +y in world space (`g_camera_blocks[cam]`'s row 1). Returns false
 * when the actor is not one this draws, so the caller poses it the ordinary
 * way.
 *
 * Each node's local matrix is its parent's inverse times the wanted world
 * one, so the hierarchy the glTF built -- and the skin's joints hanging off
 * bones 1 and 9 -- stays intact and simply lands on the engine's numbers.
 */
export function PoseFromModelBlock(inst: Instance,
                                   up: { x: number; y: number; z: number }):
    boolean {
  const a = inst.a;
  const skel = a.skel;
  if (!skel) return false;
  if (!Boss2DrawMatrices(a, up, _mats)) return false;
  // `if (char+0x64 & 1)` -- the whole draw, skeleton and parts -- on top of
  // whatever the layer already decided about showing the actor at all.
  inst.root.visible = inst.root.visible
    && (a.motionFlags & MotionFlag.Drawn) !== 0;
  // The root carries nothing: the matrices are world ones already.
  inst.root.position.set(0, 0, 0);
  inst.root.quaternion.identity();
  inst.root.scale.set(1, 1, 1);
  inst.root.updateMatrixWorld(false);
  // The pivot is bone 0: the frame the root's children hang from.
  PlaceWorld(inst.pivot, skel.rootMat);
  for (const b of inst.type.bones) {
    const node = inst.bones.get(b.bone);
    const m = _mats.get(b.bone);
    if (node && m) PlaceWorld(node, m);
  }
  const part0 = inst.part0 ?? FindPart0(inst);
  if (part0) part0.visible = (a.partVisible[0] ?? 1) !== 0;
  return true;
}

/** Set a node's local transform so its world matrix is `m`. */
function PlaceWorld(node: Object3D, m: ArrayLike<number> | Matrix4): void {
  const parent = node.parent;
  if (m instanceof Matrix4) _world.copy(m);
  else _world.fromArray(m as number[]);
  if (parent) {
    parent.updateWorldMatrix(false, false);
    _parentInv.copy(parent.matrixWorld).invert();
    _local.multiplyMatrices(_parentInv, _world);
  } else {
    _local.copy(_world);
  }
  _local.decompose(node.position, node.quaternion, node.scale);
  node.updateMatrixWorld(false);
}

/** The part-0 node the exporter names `…_part0_<slot>`, found once. */
function FindPart0(inst: Instance): Object3D | null {
  let found: Object3D | null = null;
  inst.pivot.traverse((o) => {
    if (!found && /_part0_[0-9a-f]{4}$/.test(o.name)) found = o;
  });
  inst.part0 = found;
  return found;
}

/**
 * Bone 1's drawn matrix -- where flipbooks A and B go, `AssetDrawSlot` under
 * the same top as the bone's own part. `[port-only]` as a function.
 */
export function Boss2FlipbookMatrix(a: Actor,
                                    up: { x: number; y: number; z: number },
                                    out: Matrix4): boolean {
  if (!Boss2DrawMatrices(a, up, _mats)) return false;
  const m = _mats.get(1);
  if (!m) return false;
  out.copy(m);
  return true;
}
