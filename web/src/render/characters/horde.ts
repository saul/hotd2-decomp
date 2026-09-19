/**
 * Class 0x40's member, drawn -- the half of `SubModelDraw` (`FUN_0040F4F0`)
 * the port's character layer does not already do for every character.
 *
 * The member is posed from its clip like any other character (its clock is
 * the port's: `game/class40/submodel.ts`), but the sub-model's object
 * transform is not the ordinary model's. `SubModelApplyObjectTransform`
 * (`FUN_0040F220`) is `T(pos) Ry(yaw) Rx(pitch) Rz(roll)` -- all three angles,
 * where the ordinary path draws yaw alone -- then `MatrixScale(obj+0x134C)`,
 * and while the corpse sinks `MatrixScale(1, (61 - n) / 61, 1)` on top. And
 * `HordeMemberUpdate` (`FUN_0043C440`) turns the member half round for the
 * draw (`yaw += 0x8000` before, `-= 0x8000` after): the model faces down its
 * own -z.
 *
 * Everything here **reads** the member: whether it drew this frame, and where
 * its reflection went, are decisions `game/class40/` left on the tail.
 */
import type { Object3D } from "three";
import { BAMS_TO_RAD } from "../../core/bams";
import { AppState, G } from "../../game/globals";
import { HordeFlag, type HordeTail } from "../../game/class40/state";
import { SpawnClass } from "../../game/spawn_class";
import type { Instance } from "./instance";
import type { Poser } from "./pose";

/** The tail, when this instance is a class-0x40 member. */
export function hordeTailOf(inst: Instance): HordeTail | null {
  if (inst.a.cls !== SpawnClass.HordeSpawner) return null;
  return inst.a.horde;
}

/** `(0x3D - obj+0x1330) * 0.016393442` -- the corpse's height, flattening. */
const FLATTEN_FRAMES = 0x3d;
const FLATTEN_RATE = 0.016393442;

/**
 * `SubModelApplyObjectTransform`'s object matrix, on a root node: position,
 * `Ry Rx Rz` (a three.js `Euler` in `"YXZ"` order), the sub-model's scale and
 * the corpse's squash. `y` and `pitch` are parameters because the reflection
 * draws the same member at its own.
 */
function placeSubModelRoot(node: Object3D, inst: Instance, t: HordeTail,
                           y: number, pitch: number): void {
  const a = inst.a;
  node.position.set(a.pos.x, y, a.pos.z);
  node.rotation.set(pitch * BAMS_TO_RAD, (a.yaw + 0x8000) * BAMS_TO_RAD,
                    a.roll * BAMS_TO_RAD, "YXZ");
  const flat = t.flatten ? (FLATTEN_FRAMES - t.counter) * FLATTEN_RATE : 1;
  node.scale.set(t.scale, t.scale * flat, t.scale);
}

/** Place a member's root. False when the instance is not a member. */
export function placeHordeRoot(inst: Instance): boolean {
  const t = hordeTailOf(inst);
  if (!t) return false;
  placeSubModelRoot(inst.root, inst, t, inst.a.pos.y, inst.a.pitch);
  return true;
}

/**
 * The jaw. `SubModelPoseBoneHalfRate` (`FUN_0040ED30`), for character type
 * 0x1D with `g_app_state == 6` and `obj+0x34` bit `0x10000000` (the dive), and
 * not while the sub-model is blending -- that arm returns before the test:
 *
 * ```c
 * bone 8: rx = 0xFFFF - ftol(obj+0x1344 * 16384.0);
 * bone 9: rx = ftol(t * 20480.0) - ftol(t * -16384.0) - 0xFFFF;
 * ```
 *
 * so the mouth opens as the dive runs.
 */
export function poseHordeJaw(inst: Instance, poser: Poser): void {
  const t = hordeTailOf(inst);
  if (!t) return;
  if (G.g_app_state !== AppState.InPlay) return;
  if (!(inst.a.flags & HordeFlag.Diving)) return;
  if (inst.a.fadeFrom) return;
  const d = t.diveT;
  poser.overrideBoneX(inst, 8, 0xffff - Math.trunc(d * 16384.0));
  poser.overrideBoneX(inst, 9, Math.trunc(d * 20480.0)
    - Math.trunc(d * -16384.0) - 0xffff);
}

/** Every node of a tree, in one fixed order. */
function nodesOf(root: Object3D): Object3D[] {
  const out: Object3D[] = [];
  root.traverse((o) => { out.push(o); });
  return out;
}

/**
 * The reflection: `HordeMemberUpdate` draws a stage-1 block-3 member a second
 * time at `side+0x1C - (y - side+0x1C) - 1.75` (four lower mid-dive), pitched
 * half a turn while winding up or diving. The game decided both numbers; this
 * draws the member's posed tree again there.
 *
 * A second draw of one skinned tree is a second tree in three.js, so the
 * mirror is a clone of the instance's root, re-posed from it node for node
 * every frame and rebuilt whenever the two stop having the same shape (a skin
 * swap parents new models).
 */
export function syncHordeMirror(inst: Instance, show: boolean): void {
  const t = hordeTailOf(inst);
  const want = !!t && show && t.mirrored;
  if (!want) {
    if (inst.mirror) inst.mirror.visible = false;
    return;
  }
  const src = nodesOf(inst.root);
  let dst = inst.mirror ? nodesOf(inst.mirror) : [];
  if (!inst.mirror || dst.length !== src.length) {
    inst.mirror?.removeFromParent();
    inst.mirror = inst.root.clone(true);
    inst.mirror.name = `${inst.root.name}_mirror`;
    inst.root.parent?.add(inst.mirror);
    dst = nodesOf(inst.mirror);
  }
  for (let i = 1; i < src.length; i += 1) {
    dst[i].position.copy(src[i].position);
    dst[i].quaternion.copy(src[i].quaternion);
    dst[i].scale.copy(src[i].scale);
    dst[i].visible = src[i].visible;
  }
  inst.mirror.visible = true;
  placeSubModelRoot(inst.mirror, inst, t!, t!.mirrorY, t!.mirrorPitch);
}
