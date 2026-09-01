/**
 * Swapping a bone's model for its damaged version.
 *
 * `ActorSetBoneModel` writes the draw record at `obj+0x20C + bone*0x90`, and
 * the port records the same thing on the actor — so a **snapshot carries which
 * model each bone is showing**, and `resync` puts it back by replaying these
 * calls rather than by keeping three.js state of its own.
 *
 * Two shapes of bone, and they need different treatment:
 *
 * * **A single primitive.** Swapping its geometry and material replaces what
 *   it draws and leaves its child bones alone. The original is kept on the
 *   instance so a seek can put it back.
 * * **Several primitives.** The primitives are hidden, the child bones are
 *   kept, and a clone of the damaged part hangs off the same node.
 *
 * Telling those apart is the whole of the difficulty: hiding a multi-primitive
 * bone's children wholesale takes the rest of the limb with it.
 */
import { Mesh, type Object3D } from "three";
import type { Instance } from "./instance";

/**
 * Replace a bone's mesh with its damaged variant.
 *
 * A bone node carries two different kinds of child: the primitives its own
 * mesh was split into, and the child *bones* of the skeleton. Only the first
 * may be hidden — hiding the node itself would take the rest of the limb with
 * it. Where the node is a single `Mesh` rather than a group, its geometry and
 * material are swapped instead, which leaves its children untouched.
 */
export function swapGore(parts: ReadonlyMap<number, Object3D>,
                         inst: Instance, bone: number,
                         slot: number): boolean {
  if (!slot) return false;
  const tmpl = parts.get(slot);
  const node = inst.bones.get(bone);
  if (!tmpl || !node) return false;
  // `obj+0x20C + bone*0x90` -- the draw record. Recorded on the actor so a
  // snapshot carries which model each bone is showing.
  inst.a.boneSlot[bone] = slot;

  const self = node as Mesh;
  if (self.isMesh) {
    // A single-primitive bone: swapping geometry and material replaces what
    // it draws and leaves its child bones alone. The original is kept so a
    // seek can put it back.
    const src = (tmpl as Mesh).isMesh
      ? (tmpl as Mesh)
      : (tmpl.children.find((c) => (c as Mesh).isMesh) as Mesh | undefined);
    if (!src) return false;
    if (!inst.gore.has(bone)) {
      const keep = new Mesh(self.geometry, self.material as never);
      keep.visible = false;
      inst.gore.set(bone, keep);
    }
    self.geometry = src.geometry;
    self.material = src.material;
    return true;
  }

  // A multi-primitive bone: hide the primitives, keep the child bones, and
  // hang a clone of the damaged part off the same node.
  const bones = new Set(inst.bones.values());
  const prev = inst.gore.get(bone);
  if (prev && prev.parent === node) prev.removeFromParent();
  else for (const c of node.children) {
    if (!bones.has(c)) c.visible = false;
  }
  const copy = tmpl.clone(true);
  copy.visible = true;
  copy.position.set(0, 0, 0);
  copy.quaternion.identity();
  copy.scale.set(1, 1, 1);
  node.add(copy);
  inst.gore.set(bone, copy);
  return true;
}
