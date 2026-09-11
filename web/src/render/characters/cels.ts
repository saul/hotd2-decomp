/**
 * `ZombieDrawBonePart`'s cel arms, drawn.
 *
 * The reading is in `game/class30/bonecels.ts` and the short version is that
 * class 0x30's per-bone draw callback (`FUN_004534A0`) is not a "draw the
 * bone's slot" hook: for nine of its sixteen arms it draws a **cel** out of a
 * run of models, chosen by a free-running frame counter, and for four of those
 * it draws a second model on top. `char_adv02`'s bone 1 is the case the bug
 * report is about — the damaged torso is chest-only and the thirty-cel lower
 * torso is what fills the band between it and the pelvis.
 *
 * This file is the drawing of it and nothing else. Which cel is a function of
 * `G.g_blink_frame_counter` and `a.hitSlot`, both of which are game state, so
 * a snapshot fully determines what is on screen and `resync` needs no help.
 */
import { Mesh, Object3D } from "three";
import { G } from "../../game/globals";
import {
  BONE_CEL_PHASE_PER_SLOT, g_class30_bone_cels, type BoneCelArm,
} from "../../game/class30/bonecels";
import { SpawnClass } from "../../game/spawn_class";
import type { Instance } from "./instance";

/**
 * The node name every cel holder carries, so the two other things that hide a
 * bone's children can tell them apart from the bone's own primitives.
 */
export const CEL_HOLDER = "bonecels";

/** One run's node, and which cel it is currently showing. */
export interface CelRunNode {
  node: Object3D;
  /** The asset slot the node's meshes were last filled from. */
  slot: number;
}

/** The primitives of a template node, in the order the chain drew them. */
function primitives(tmpl: Object3D): Mesh[] {
  if ((tmpl as Mesh).isMesh) return [tmpl as Mesh];
  return tmpl.children.filter((c) => (c as Mesh).isMesh) as Mesh[];
}

/**
 * A node holding one mesh per primitive of a cel, parked at the bone's origin.
 *
 * Built once per run and then **refilled**, never re-cloned: every cel in a
 * run is the same topology with the same materials — measured, 138 vertices
 * and textures `[8, 9, 1]` across all twenty chest cels — so stepping the
 * animation is `mesh.geometry = next.geometry` and allocates nothing.
 */
function makeRunNode(prims: Mesh[]): Object3D {
  const holder = new Object3D();
  holder.name = CEL_HOLDER;
  for (const p of prims) {
    const m = new Mesh(p.geometry, p.material as never);
    m.position.set(0, 0, 0);
    m.quaternion.identity();
    m.scale.set(1, 1, 1);
    holder.add(m);
  }
  return holder;
}

/** Fill a run node's meshes from one cel's template. */
function fill(holder: Object3D, prims: Mesh[]): void {
  const meshes = holder.children as Mesh[];
  for (let i = 0; i < meshes.length && i < prims.length; i++) {
    meshes[i].geometry = prims[i].geometry;
    meshes[i].material = prims[i].material;
  }
}

/** The slot a bone is drawing right now — the draw record at `+0x20C`. */
function currentSlot(inst: Instance, bone: number): number {
  const over = inst.a.boneSlot[String(bone)];
  if (over !== undefined) return over;
  return inst.type.bones.find((b) => b.bone === bone)?.slot ?? 0;
}

/**
 * Put this frame's cels on every bone whose current slot names an arm.
 *
 * Class 0x30 only: the hook is installed by `EnemyZombieInit` (`FUN_00452DA0`)
 * and every other class has its own. `ThrowerDrawBonePart` has cel arms of the
 * same shape for class 0x31 and they are **not** here — that is a separate
 * reading and a separate table.
 */
export function syncBoneCels(parts: ReadonlyMap<number, Object3D>,
                             inst: Instance): void {
  if (inst.a.cls !== SpawnClass.Zombie) {
    if (inst.cels?.size) clearBoneCels(inst);
    return;
  }
  // `g_blink_frame_counter + obj+0x3C * 10`, written out rather than called:
  // see {@link BONE_CEL_PHASE_PER_SLOT} for why the engine's one expression
  // is a constant here and the arithmetic is at the site.
  const seed = G.g_blink_frame_counter
    + inst.a.hitSlot * BONE_CEL_PHASE_PER_SLOT;
  const cels = inst.cels ?? (inst.cels = new Map());
  const wanted = new Set<string>();

  for (const [bone, node] of inst.bones) {
    const arm: BoneCelArm | undefined =
      g_class30_bone_cels[currentSlot(inst, bone)];
    if (!arm) continue;
    let placed = 0;

    // Keyed by the run's **base**, not by its index in the arm: a gore swap
    // moves bone 1 from `0x1B3D` (chest run, then lower run) to `0x1B70` (the
    // lower run alone), so index 0 means a different run and a different mesh
    // count either side of the hit. Keying by base tears the old holder down
    // and builds the right one.
    arm.runs.forEach((run) => {
      const key = `${bone}:${run.base.toString(16)}`;
      wanted.add(key);
      // `IDIV` truncates toward zero, so a `-1` hit slot gives a negative
      // remainder and the engine lands below the run. There is no model there
      // and nothing to draw, which is the behaviour rather than a guard.
      const idx = seed % run.count;
      if (idx < 0) return;
      const slot = run.base + idx;
      let live = cels.get(key);
      if (!live) {
        const prims = primitives(parts.get(slot) ?? new Object3D());
        if (!prims.length) return;
        live = { node: makeRunNode(prims), slot: -1 };
        node.add(live.node);
        cels.set(key, live);
      }
      placed += 1;
      if (live.slot === slot) return;
      const tmpl = parts.get(slot);
      if (!tmpl) return;
      fill(live.node, primitives(tmpl));
      live.slot = slot;
    });

    // `self: false` means the arm computed a cel *into* the slot variable
    // before it drew, so the bone's own model is replaced rather than added
    // to. The bone node carries its child bones, so it cannot be hidden: its
    // own primitive meshes are, which is `swapGore`'s multi-primitive rule.
    //
    // **Only once there is something to draw in its place.** A bundle exported
    // before the cel runs were carried has none of these models, and hiding
    // the bone's own primitives against a missing cel would take the whole
    // undamaged torso away -- a bigger hole than the one this fixes.
    if (!arm.self && placed === arm.runs.length) {
      hideOwnPrimitives(inst, bone, node);
    }
  }

  // A gore swap can move a bone off a trigger slot — `0x1B71` escalates to
  // `0x1B72`, which draws its own abdomen and wants no cel at all — so a run
  // whose arm is gone this frame comes off.
  for (const [key, live] of cels) {
    if (wanted.has(key)) continue;
    live.node.removeFromParent();
    cels.delete(key);
    const bone = Number(key.split(":")[0]);
    showOwnPrimitives(inst, bone);
  }
}

/**
 * Hide a bone's own primitive meshes and keep its child bones.
 *
 * `inst.bones` is what separates the two: anything under the node that is not
 * itself a bone is a primitive of the node's own model. Recorded on
 * `inst.celHidden` so it is done once and so `clearBoneCels` can undo it —
 * `restoreNodes` re-shows every child of every bone, which covers a release,
 * but a swap **within** one life has to put them back itself.
 */
function hideOwnPrimitives(inst: Instance, bone: number,
                           node: Object3D): void {
  const hidden = inst.celHidden ?? (inst.celHidden = new Set());
  if (hidden.has(bone)) return;
  const bones = new Set(inst.bones.values());
  for (const c of node.children) {
    if (bones.has(c) || c.name === CEL_HOLDER) continue;
    c.visible = false;
  }
  hidden.add(bone);
}

function showOwnPrimitives(inst: Instance, bone: number): void {
  if (!inst.celHidden?.delete(bone)) return;
  // **Not if a gore swap owns the bone.** `swapGore` hides the same primitives
  // for its own reason once the bone is damaged, and re-showing them would
  // draw the pristine torso underneath the damaged one. `restoreGore` is what
  // puts those back, on the path that owns them.
  if (inst.gore.has(bone)) return;
  const node = inst.bones.get(bone);
  if (!node) return;
  const bones = new Set(inst.bones.values());
  for (const c of node.children) {
    if (bones.has(c) || c.name === CEL_HOLDER) continue;
    c.visible = true;
  }
}

/** Take every cel node off, and un-hide whatever they replaced. */
export function clearBoneCels(inst: Instance): void {
  for (const live of inst.cels?.values() ?? []) live.node.removeFromParent();
  inst.cels?.clear();
  for (const bone of [...(inst.celHidden ?? [])]) showOwnPrimitives(inst, bone);
}
