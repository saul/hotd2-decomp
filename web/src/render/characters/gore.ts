/**
 * Swapping a bone's model for its damaged version.
 *
 * `ActorSetBoneModel` writes the draw record at `obj+0x20C + bone*0x90`, and
 * the port records the same thing on the actor — so a **snapshot carries which
 * model each bone is showing**, and `resync` puts it back by replaying these
 * calls rather than by keeping three.js state of its own.
 *
 * ## What the engine draws, and therefore what this must draw
 *
 * `SkeletonDrawNodeSlot` (`FUN_00411050`) calls `AssetDrawSlot`
 * (`FUN_00418560`) with `record[bone].slot`, and that draws **one whole
 * model** — `WalkMeshChainAndDraw` walks every mesh in its chain. The exporter
 * writes that chain as one glTF node with one primitive per mesh, so a swap
 * has to draw *every* primitive of the damaged part. `[proved]` This is not a
 * theoretical concern: all 57 of `char_adv02`'s damaged variants are
 * multi-primitive (2–7 meshes each), and its damaged upper arms, forearms,
 * thighs and shins have five.
 *
 * ## Two shapes of bone, and they need different treatment
 *
 * * **A single primitive.** glTF loads the node as a `Mesh`, and the bone's
 *   *children* are its child bones — so it cannot be hidden, and the swap
 *   writes the damaged part's first primitive over its geometry and material
 *   and hangs the rest off it. The original is kept on the instance so a seek
 *   can put it back.
 * * **Several primitives.** glTF loads the node as a `Group` whose children
 *   are the primitive meshes *and* the child bones. The primitives are hidden,
 *   the child bones are kept, and a clone of the whole damaged part hangs off
 *   the same node.
 *
 * Telling those apart is the whole of the difficulty: hiding a multi-primitive
 * bone's children wholesale takes the rest of the limb with it, and taking
 * only the first primitive of the damaged part takes most of the part with it
 * — which is what "big missing render section" looks like.
 *
 * ## `[open]` The abdomen a shot `char_adv02` has nothing to draw with
 *
 * A second, separate hole with the same symptom, and this one is **not** in
 * this file. Char type 0's bone 1 escalates to slot `0x1B70` on the first
 * torso hit, and that model is chest-only — `y 1.3..5.5` against the
 * undamaged `y -2.0..5.5` — while the pelvis tops out at `y -0.45`. The type
 * is one of the 21 with a null `EXTRA_PARTS` entry, so it has no abdomen part
 * to keep the band filled the way `char_adv00`'s `0x1F02` does. Every step of
 * the port's draw is the exe's — one slot per bone, one model per slot — so
 * nothing here can fill it without inventing geometry. The evidence, and what
 * has been ruled out, is in `tools/hod2lib/characters.py`'s module docstring.
 */
import { Mesh, type Object3D } from "three";
import type { GoreSwap, Instance } from "./instance";

/** The primitives of a template node, in the order the chain drew them. */
function primitives(tmpl: Object3D): Mesh[] {
  if ((tmpl as Mesh).isMesh) return [tmpl as Mesh];
  return tmpl.children.filter((c) => (c as Mesh).isMesh) as Mesh[];
}

/** A clone of one node, parked at its parent's origin. */
function seated(node: Object3D): Object3D {
  const copy = node.clone(true);
  copy.visible = true;
  copy.position.set(0, 0, 0);
  copy.quaternion.identity();
  copy.scale.set(1, 1, 1);
  return copy;
}

/**
 * Replace a bone's mesh with its damaged variant.
 *
 * A bone node carries two different kinds of child: the primitives its own
 * mesh was split into, and the child *bones* of the skeleton. Only the first
 * may be hidden — hiding the node itself would take the rest of the limb with
 * it.
 */
export function swapGore(parts: ReadonlyMap<number, Object3D>,
                         inst: Instance, bone: number,
                         slot: number): boolean {
  if (!slot) return false;
  const tmpl = parts.get(slot);
  const node = inst.bones.get(bone);
  if (!tmpl || !node) return false;
  const prims = primitives(tmpl);
  if (!prims.length) return false;
  // **The draw record is not written here.** `obj+0x20C + bone*0x90` is the
  // actor's, and the port writes it beside every `host.setBoneSlot` call --
  // `ActorSwapDamagedPart` (`FUN_004098E0`) and class 0x30 and 0x31's hand
  // swaps. Recording it a second time from the renderer meant the snapshot's
  // copy depended on whether a hierarchy happened to be in the scene when the
  // swap was asked for, which is exactly the wrong dependency.

  // An escalating hit swaps the same bone again: what the last swap added goes
  // first, and what it *saved* is kept, because that is the pristine model.
  const prev = inst.gore.get(bone);
  for (const n of prev?.added ?? []) n.removeFromParent();

  const self = node as Mesh;
  if (self.isMesh) {
    // A single-primitive bone. Its geometry and material are replaced, which
    // leaves its child bones untouched, and the damaged part's remaining
    // primitives are parented to it -- `AssetDrawSlot` draws all of them.
    const keep = prev?.keep
      ?? Object.assign(new Mesh(self.geometry, self.material as never),
                       { visible: false });
    self.geometry = prims[0].geometry;
    self.material = prims[0].material;
    const added = prims.slice(1).map((p) => {
      const copy = seated(p);
      self.add(copy);
      return copy;
    });
    inst.gore.set(bone, { keep, added });
    return true;
  }

  // A multi-primitive bone: hide the primitives, keep the child bones, and
  // hang a clone of the whole damaged part off the same node.
  if (!prev) {
    const bones = new Set(inst.bones.values());
    for (const c of node.children) if (!bones.has(c)) c.visible = false;
  }
  const copy = seated(tmpl);
  node.add(copy);
  inst.gore.set(bone, { keep: null, added: [copy] });
  return true;
}

/** Undo one bone's swap: put the saved model back, take the additions off. */
export function restoreGore(inst: Instance, bone: number,
                            g: GoreSwap): void {
  for (const n of g.added) n.removeFromParent();
  const node = inst.bones.get(bone) as Mesh | undefined;
  if (g.keep && node?.isMesh) {
    node.geometry = g.keep.geometry;
    node.material = g.keep.material;
  }
}
