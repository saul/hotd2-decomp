/**
 * The result card's figures, drawn: what `ResultCardFigureDrawNode`
 * (`FUN_004357F0`) draws besides each node's own model.
 *
 * The port decides both and leaves them on the figure (`game/class61/`):
 *
 * * **The life figure 0 holds up**, `ResultCardTail.holdsLife`: `Push;
 *   MatrixTranslate(1, -1, 0); MatrixRotateX(0x4000); MatrixRotateZ(0);
 *   MatrixRotateY(0); AssetDrawSlot(0x10C3); Pop` in bone 5's matrix. The
 *   local matrix is built by the engine's own matrix routines, call for call,
 *   as `held_items.ts` builds a civilian's -- every call post-multiplies, so
 *   the translate comes first and the turn is the model's own.
 * * **The Original Mode item scale**, `ResultCardTail.partScale`: the hook's
 *   `MatrixScale` on bones 2, 5, 8, 12 and 15 around each node's own draw,
 *   between its push and its pop. As the head aim's turn is
 *   (`head_aim.ts`), it is applied around the draw -- each mesh the node
 *   owns gets `N S N^-1` multiplied into its `matrixWorld` in
 *   `onBeforeRender` and put back in `onAfterRender` -- so the child bones,
 *   which hang from the stored node matrix, do not grow with it. In the port
 *   the flag is never up: `g_original_item_part_scale`'s writer is unported.
 *
 * Render bookkeeping only; a snapshot carries the two flags.
 */
import { Matrix4, type Object3D } from "three";
import {
  RESULT_FIGURE_LIFE_BONE, RESULT_FIGURE_LIFE_OFFSET,
  RESULT_FIGURE_LIFE_ROT_X, RESULT_FIGURE_LIFE_SLOT, RESULT_FIGURE_PART_SCALE,
  ResultCardRoutine,
} from "../../game/class61/state";
import {
  MatIdentity, MatrixRotateX, MatrixRotateY, MatrixRotateZ, MatrixScale,
  MatrixTranslate,
} from "../../game/matrix";
import { SpawnClass } from "../../game/spawn_class";
import { partNodesOf } from "./draw_gates";
import type { Instance } from "./instance";

/** The held life's matrix in bone 5's frame, as `Matrix4.elements`. */
function LifeLocalMatrix(): number[] {
  const m = MatIdentity();
  MatrixTranslate(m, RESULT_FIGURE_LIFE_OFFSET[0], RESULT_FIGURE_LIFE_OFFSET[1],
                  RESULT_FIGURE_LIFE_OFFSET[2]);
  MatrixRotateX(m, RESULT_FIGURE_LIFE_ROT_X);
  MatrixRotateZ(m, 0);
  MatrixRotateY(m, 0);
  return m;
}

/** Each scaled node's `S`, built once. */
const partScales = new Map<number, Matrix4>();
function PartScaleMatrix(bone: number): Matrix4 | null {
  const s = RESULT_FIGURE_PART_SCALE[bone];
  if (!s) return null;
  let k = partScales.get(bone);
  if (!k) {
    const m = MatIdentity();
    MatrixScale(m, s[0], s[1], s[2]);
    k = new Matrix4().fromArray(m);
    partScales.set(bone, k);
  }
  return k;
}

/** Which instance and bone each hooked mesh scales for. */
const scaled = new WeakMap<Object3D, { inst: Instance; bone: number;
                                       node: Object3D }>();
const _inv = new Matrix4();

/** The mesh's push and pop, once. See the file note. */
function hookScale(o: Object3D, inst: Instance, bone: number,
                   node: Object3D): void {
  if (scaled.has(o)) return;
  scaled.set(o, { inst, bone, node });
  const saved = new Matrix4();
  let applied = false;
  o.onBeforeRender = () => {
    const h = scaled.get(o);
    const a = h?.inst.a;
    if (!h || !a || a.cls !== SpawnClass.ResultCard || !a.card.partScale) {
      return;
    }
    const s = PartScaleMatrix(h.bone);
    if (!s) return;
    saved.copy(o.matrixWorld);
    _inv.copy(h.node.matrixWorld).invert();
    o.matrixWorld.premultiply(_inv).premultiply(s)
      .premultiply(h.node.matrixWorld);
    applied = true;
  };
  o.onAfterRender = () => {
    if (!applied) return;
    o.matrixWorld.copy(saved);
    applied = false;
  };
}

/**
 * One figure's frame: the life on bone 5 shown or hidden, and the scale's
 * hooks on the meshes each scaled node owns. `cloneSlot` is the character
 * layer's -- the model comes from the type's hidden template, which the
 * exporter gives the slot (`hod2lib/characters.ts`).
 */
export function syncResultFigure(inst: Instance,
                                 cloneSlot: (slot: number) => Object3D | null)
    : void {
  const a = inst.a;
  if (a.cls !== SpawnClass.ResultCard
      || a.card.routine === ResultCardRoutine.Card) return;
  if (inst.resultLife === undefined) {
    const bone = inst.bones.get(RESULT_FIGURE_LIFE_BONE);
    const model = bone ? cloneSlot(RESULT_FIGURE_LIFE_SLOT) : null;
    inst.resultLife = model;
    if (bone && model) {
      model.matrixAutoUpdate = false;
      model.matrix.fromArray(LifeLocalMatrix());
      bone.add(model);
    }
  }
  if (inst.resultLife) inst.resultLife.visible = a.card.holdsLife;

  if (!inst.resultScaleHooked) {
    const keep = new Set<Object3D>(partNodesOf(inst).values());
    if (inst.resultLife) keep.add(inst.resultLife);
    for (const n of inst.attached?.values() ?? []) keep.add(n);
    const bones = new Set<Object3D>(inst.bones.values());
    for (const [bone, node] of inst.bones) {
      if (!RESULT_FIGURE_PART_SCALE[bone]) continue;
      const visit = (o: Object3D): void => {
        if (keep.has(o) || (o !== node && bones.has(o))) return;
        if ((o as { isMesh?: boolean }).isMesh) hookScale(o, inst, bone, node);
        for (const c of o.children) visit(c);
      };
      visit(node);
    }
    inst.resultScaleHooked = true;
  }
}
