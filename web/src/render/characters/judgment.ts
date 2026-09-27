/**
 * JUDGMENT, drawn -- the halves of classes 0x22 and 0x23's draws the port's
 * character layer does not already do for every character.
 *
 * Three things, each the engine's own arithmetic on a pose this layer has
 * just made:
 *
 * * **The object rotation, in each model's own order.** The ordinary path
 *   draws yaw alone. `SkeletonApplyRootMotion` (`FUN_00410C50`) switches on
 *   `model+0x68` -- `obj+0x1FC` -- through the jump table at `0x00411038`:
 *   0 `Rx Ry Rz`, 1 `Rx Rz Ry`, 2 `Ry Rx Rz`, 3 `Ry Rz Rx`, 4 `Rz Rx Ry`, and
 *   anything else `Rz Ry Rx`, after `T(obj+0x40)`. `Class22Init` writes 5 on
 *   the flier and on its sub-actor, `Class23Init` writes 1 on the walker.
 *   `op_st1` path `0x100`, the stage-1 cameo, is the one flight whose pitch
 *   and roll are not zero (5320 and -11065 at its ends), so the flier banks
 *   there and nowhere else. `[proved]`
 * * **The sub-actor's seat.** `Class22DrawAndPoseSubActor` (`FUN_0049D770`)
 *   draws the flier, then sets the sub-actor's position to node 1's
 *   translation and its angles to `MatrixToEulerZYX` of node 1's matrix, both
 *   in the world (`g_camera_blocks[g_camera_index]` times the view-space
 *   record at `obj+0x2C4`), and draws the sub-actor with order 5. So the
 *   sub-actor's root is node 1's world matrix re-expressed as
 *   `T · Rz · Ry · Rx` in integer BAMS. The pose it reads is the one the flier
 *   was drawn with a moment before, on the same frame; here that is the pose
 *   this layer made, so the seat runs after every instance is posed.
 * * **Node 1's two extra models.** `Class22DrawBonePart` (`FUN_0049D980`),
 *   for the node whose record slot is `0x2BB` (the flier's bone 1), draws
 *   slot `0x2B5` under `T(-0.778, 1.49, 0) RotZ(9102·rz₃/26396) RotX(21845·rx₃
 *   >> 15)` and slot `0x2B4` under the mirror translation and node 6's
 *   angles, where `rx₃`/`rz₃` are node 3's draw record `+0x04`/`+0x0C` -- the
 *   angles node 3 was drawn with this frame. Both divisions truncate toward
 *   zero (`IMUL` by `0x9EE633C1` with the sign fix-up, and `CDQ; AND 0x7FFF;
 *   SAR 15`).
 *
 * Everything here **reads** the actor.
 */
import { Object3D } from "three";
import { BAMS_TO_RAD } from "../../core/bams";
import type { JudgmentActor } from "../../game/actor";
import { MatrixGetTranslation, MatrixToEulerZYX } from "../../game/matrix";
import { SpawnClass } from "../../game/spawn_class";
import type { Instance } from "./instance";
import type { Poser } from "./pose";

/**
 * `model+0x68` for each class, as its `Init` writes it, and the three.js
 * `Euler` order that is the same product. Three.js names the axes in the
 * order their matrices are multiplied, so `RotZ; RotY; RotX` on the engine's
 * stack is `"ZYX"` and `RotX; RotZ; RotY` is `"XZY"`.
 */
const FLIER_ROTATION_ORDER = "ZYX";   // obj+0x1FC = 5, the default arm
const WALKER_ROTATION_ORDER = "XZY";  // obj+0x1FC = 1

/** The node whose draw carries the two extras: the flier's body, bone 1. */
const WING_HOST_SLOT = 0x2bb;
/** The two draws: slot, side, and the node whose angles turn it. */
const WINGS: readonly { slot: number; side: number; node: number }[] = [
  { slot: 0x2b5, side: -1, node: 3 },
  { slot: 0x2b4, side: 1, node: 6 },
];
/** What the two extra nodes are called, so a stale pair can be found. */
const WING_NODE = "judgment_wing";
/** `9102 / 26396` and `21845 / 32768`, applied as the engine divides. */
const WING_Z_NUM = 0x238e;
const WING_Z_DEN = 0x671c;
const WING_X_NUM = 0x5555;

/**
 * `(∓0.778, 1.49, 0)`: the float bits the draw pushes, `0xBF47381D` /
 * `0x3F47381D` and `0x3FBEAB36`, decoded rather than rounded.
 */
const _f = new Float32Array(1);
const _u = new Uint32Array(_f.buffer);
function f32(bits: number): number { _u[0] = bits; return _f[0]; }
const WING_X = f32(0x3f47381d);
const WING_Y = f32(0x3fbeab36);

/** The flier's tail, when this instance is class 0x22. */
function judgmentOf(inst: Instance): JudgmentActor | null {
  return inst.a.cls === SpawnClass.Judgment ? inst.a : null;
}

/**
 * Place a JUDGMENT root. False when the instance is neither class, so the
 * caller's ordinary arm runs. The sub-actor is placed by
 * {@link seatJudgmentSubActors} instead, after the flier is posed.
 */
export function placeJudgmentRoot(inst: Instance): boolean {
  const a = inst.a;
  if (a.cls === SpawnClass.Judgment) {
    if (a.judgment.isSubActor) return true;
    inst.root.position.set(a.pos.x, a.pos.y, a.pos.z);
    inst.root.rotation.set(a.pitch * BAMS_TO_RAD, a.yaw * BAMS_TO_RAD,
                           a.roll * BAMS_TO_RAD, FLIER_ROTATION_ORDER);
    return true;
  }
  if (a.cls === SpawnClass.JudgmentCompanion) {
    inst.root.position.set(a.pos.x, a.pos.y, a.pos.z);
    inst.root.rotation.set(a.pitch * BAMS_TO_RAD, a.yaw * BAMS_TO_RAD,
                           a.roll * BAMS_TO_RAD, WALKER_ROTATION_ORDER);
    return true;
  }
  return false;
}

const _world: number[] = new Array(16).fill(0);
const _t = { x: 0, y: 0, z: 0 };

/**
 * `Class22DrawAndPoseSubActor`'s seat, for every flier that has a sub-actor:
 * node 1's world matrix, taken apart as the engine takes it apart --
 * `MatrixGetTranslation` and `MatrixToEulerZYX` (`FUN_004019E0`), integer
 * BAMS -- and put back together as the sub-actor's `T · Rz · Ry · Rx`.
 *
 * Runs once every instance has been posed, because it reads a pose.
 */
export function seatJudgmentSubActors(instances: readonly Instance[]): void {
  for (const inst of instances) {
    const a = judgmentOf(inst);
    if (!a || a.judgment.isSubActor || a.judgment.subActorAt < 0) continue;
    const sub = instances.find((i) => i.at === a.judgment.subActorAt);
    if (!sub) continue;
    const node1 = inst.bones.get(1);
    if (!node1) continue;
    node1.updateWorldMatrix(true, false);
    const e = node1.matrixWorld.elements;
    for (let i = 0; i < 16; i++) _world[i] = e[i];
    MatrixGetTranslation(_world, _t);
    const r = MatrixToEulerZYX(_world);
    sub.root.position.set(_t.x, _t.y, _t.z);
    sub.root.rotation.set(r.rx * BAMS_TO_RAD, r.ry * BAMS_TO_RAD,
                          r.rz * BAMS_TO_RAD, FLIER_ROTATION_ORDER);
  }
}

/** The slot a bone is drawing right now -- the draw record's `+0x00`. */
function currentSlot(inst: Instance, bone: number): number {
  const over = inst.a.boneSlot[String(bone)];
  if (over !== undefined) return over;
  return inst.type.bones.find((b) => b.bone === bone)?.slot ?? 0;
}

/** A clone of a template, parked at its parent's origin. */
function seated(tmpl: Object3D): Object3D {
  const c = tmpl.clone(true);
  c.visible = true;
  c.position.set(0, 0, 0);
  c.quaternion.identity();
  c.scale.set(1, 1, 1);
  return c;
}

const _angles = { rx: 0, ry: 0, rz: 0 };

/**
 * `Class22DrawBonePart`'s second arm: the two extra models on the node whose
 * slot is `0x2BB`, turned by node 3's and node 6's drawn angles. Called after
 * the pose, which is when those angles exist. A flier whose bundle does not
 * carry the two models draws nothing extra, as it did before.
 */
export function syncJudgmentWings(parts: ReadonlyMap<number, Object3D>,
                                  inst: Instance, poser: Poser): void {
  const a = judgmentOf(inst);
  if (!a || a.judgment.isSubActor) {
    if (inst.judgmentWings) {
      for (const w of inst.judgmentWings) w.removeFromParent();
      inst.judgmentWings = undefined;
    }
    return;
  }
  let host: Object3D | undefined;
  for (const [bone, node] of inst.bones) {
    if (currentSlot(inst, bone) === WING_HOST_SLOT) { host = node; break; }
  }
  if (!inst.judgmentWings) {
    // A released instance comes back as a new record over the same nodes,
    // so what an earlier one hung on the bone is taken off first.
    const stale: Object3D[] = [];
    host?.traverse((o) => { if (o.name === WING_NODE) stale.push(o); });
    for (const o of stale) o.removeFromParent();
    const made: Object3D[] = [];
    for (const w of WINGS) {
      const tmpl = parts.get(w.slot);
      const node = tmpl ? seated(tmpl) : new Object3D();
      node.name = WING_NODE;
      made.push(node);
    }
    inst.judgmentWings = made;
  }
  for (let i = 0; i < WINGS.length; i++) {
    const node = inst.judgmentWings[i];
    if (!host) { node.visible = false; continue; }
    if (node.parent !== host) host.add(node);
    if (!poser.drawnAngles(inst, WINGS[i].node, _angles)) {
      node.visible = false;
      continue;
    }
    // `(rz * 0x238E) / 0x671C` and `(rx * 0x5555) >> 15`, both toward zero.
    const rz = Math.trunc((_angles.rz * WING_Z_NUM) / WING_Z_DEN);
    const rx = Math.trunc((_angles.rx * WING_X_NUM) / 0x8000);
    node.position.set(WINGS[i].side * WING_X, WING_Y, 0);
    // `RotZ` then `RotX` on the stack: `Rz · Rx`, a three.js "ZYX" with no Y.
    node.rotation.set(rx * BAMS_TO_RAD, 0, rz * BAMS_TO_RAD, "ZYX");
    node.visible = true;
  }
}
