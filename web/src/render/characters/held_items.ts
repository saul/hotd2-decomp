/**
 * `CivilianDrawHeldItems` — `FUN_0048CD10`, the draw's half. What is in a
 * civilian's hand.
 *
 * The port walks the array, runs each record's routine and drops what was
 * given (`game/class10/items.ts`); it leaves what that walk drew in
 * `civ.heldDrawn`, and this draws it. Per item, from the listing
 * (`0x0048CD48`..`0x0048CF46`) -- the pseudocode drops every FPU argument to
 * these calls (L1), so each is read off its `PUSH`:
 *
 * ```
 * 0048cd87  MatrixStackSetTopFromArray(model + 0xA0 + rec+0 * 0x90)   the bone
 * 0048cd91  MatrixRotateX(rec+0x0C)
 * 0048cd9b  MatrixRotateZ(rec+0x14)
 * 0048cda5  MatrixRotateY(rec+0x10)
 * 0048cdc9  MatrixTranslate(set.x, set.y, set.z)     set = rec+0x1C + sub+0x82*16
 * 0048cde9  if (set.w != 1.0) MatrixScale(set.w, set.w, set.w)
 * 0048ce0e  AssetDrawSlot(rec+4)
 * 0048ce26  switch (rec+8):
 *             3..6            AssetDrawSlot(second)            same matrix
 *             7..10           h = 6.5 \
 *             0xE,0xF,0x10,0x12  h = 2.0 -+ MatrixTranslate(0, h, 0);
 *                               p = MatrixGetTranslation; MatrixLoadIdentity;
 *                               MatrixTranslate(p); s = set.w * model+0x116C;
 *                               MatrixScale(s, s, s); MatrixTranslate(0, -h, 0);
 *                               AssetDrawSlot(second)
 * ```
 *
 * **Every call post-multiplies** (`game/matrix.ts`), so the translate comes
 * *after* the three turns on the stack and moves the item along the turned
 * axes: the item's origin sits at `Rx Rz Ry t` in the bone's frame, not at
 * `t`. This file used to set the node's position to `t` and its rotation to
 * the turns, which three.js composes the other way round -- the model turned
 * about its own origin and then put down at the untransformed offset. For
 * the extra life's `(0, 1, 1)` under `X 0x4000, Z 0xC000` that is `(0, 1, 1)`
 * where the engine has `(1, -1, 0)`: 2.4 units off in the hand, before the
 * model's scale (L84). So the local matrix is now built by the engine's own
 * matrix routines, call for call, and handed to the node whole.
 *
 * The camera-facing second slot is the other half: `MatrixLoadIdentity` is
 * the camera's own space, so that model keeps the point and throws away every
 * turn, the bone's included, and is re-scaled by the item's size and the
 * model's (the root's scale went with the identity). It is placed from the
 * frame's view matrices each frame.
 */
import { Matrix4, Object3D, Vector3 } from "three";
import type { CivilianItemJson } from "../../bundle/scene";
import type { Context } from "../../core/system";
import {
  MatIdentity, MatrixRotateX, MatrixRotateY, MatrixRotateZ, MatrixScale,
  MatrixTranslate,
} from "../../game/matrix";
import type { Instance } from "./instance";

/** `CMP EAX,0xf; JA` after `LEA EAX,[EDX - 3]` at `0x0048CE1A`: kinds 3..0x12. */
const KIND_SAME_MATRIX = [3, 4, 5, 6];
/** `MOV dword ptr [ESP + 0x10], 0x40d00000` -- 6.5, kinds 7..10. */
const FACING_LIFT_HIGH = 6.5;
const KINDS_FACING_HIGH = [7, 8, 9, 10];
/** `MOV dword ptr [ESP + 0x10], 0x40000000` -- 2.0, kinds 0xE..0x10 and 0x12. */
const FACING_LIFT_LOW = 2.0;
const KINDS_FACING_LOW = [0x0e, 0x0f, 0x10, 0x12];

/** The camera-facing lift for a kind, or null if its second slot turns. */
function facingLift(kind: number): number | null {
  if (KINDS_FACING_HIGH.includes(kind)) return FACING_LIFT_HIGH;
  if (KINDS_FACING_LOW.includes(kind)) return FACING_LIFT_LOW;
  return null;
}

/**
 * The item's matrix in its bone's frame: everything `CivilianDrawHeldItems`
 * puts on the stack after `MatrixStackSetTopFromArray`, as sixteen floats in
 * `Matrix4.elements`' layout. Exported for `test/render.test.ts`.
 */
export function HeldItemLocalMatrix(rec: CivilianItemJson,
                                    attachSet: number): number[] {
  const set = rec.sets[attachSet];
  const m = MatIdentity();
  MatrixRotateX(m, rec.rot[0]);
  MatrixRotateZ(m, rec.rot[2]);
  MatrixRotateY(m, rec.rot[1]);
  MatrixTranslate(m, set[0], set[1], set[2]);
  // `FCOMP float ptr [0x004c4380]` (1.0) and `JNZ` past the call.
  if (set[3] !== 1.0) MatrixScale(m, set[3], set[3], set[3]);
  return m;
}

/** What a held item's nodes are, kept on the instance between frames. */
export interface HeldItemNodes {
  /** The item under its bone, with the draw's local matrix. */
  node: Object3D;
  /** The camera-facing second slot, hung off the actor's root, or null. */
  face: Object3D | null;
  /** That slot's lift and its size: `set.w`, before the model's scale. */
  lift: number;
  size: number;
}

const _m = new Matrix4();
const _w = new Matrix4();
const _inv = new Matrix4();
const _v = new Vector3();
const _w2v = new Array<number>(16).fill(0);
const _v2w = new Array<number>(16).fill(0);

/**
 * Hang, re-hang or re-place `inst`'s held items. `records` is
 * `civilians.items`; `clone` makes a model from an asset slot.
 */
export function syncHeldItems(inst: Instance, records: CivilianItemJson[],
                              clone: (slot: number) => Object3D | null,
                              ctx: Context): void {
  const civ = inst.a.civ;
  if (!civ) return;
  const want = civ.heldDrawn;
  const key = `${civ.attachSet}:${want.join(",")}`;
  const have = inst.held ?? (inst.held = new Map());
  const faces = inst.heldNodes ?? (inst.heldNodes = []);
  if (inst.heldKey !== key) {
    for (const g of have.values()) g.removeFromParent();
    for (const h of faces) h.face?.removeFromParent();
    have.clear();
    faces.length = 0;
    want.forEach((k, i) => {
      const rec = records[k];
      const bone = rec && inst.bones.get(rec.bone);
      const node = new Object3D();
      node.matrixAutoUpdate = false;
      have.set(i, node);
      faces.push({ node, face: null, lift: 0, size: 1 });
      if (!rec || !bone) return;
      node.matrix.fromArray(HeldItemLocalMatrix(rec, civ.attachSet));
      const model = clone(rec.slot);
      if (model) node.add(model);
      bone.add(node);
      if (!rec.extra) return;
      const lift = facingLift(rec.kind);
      const extra = clone(rec.extra);
      if (!extra) return;
      if (lift === null) {
        if (KIND_SAME_MATRIX.includes(rec.kind)) node.add(extra);
        return;
      }
      const face = new Object3D();
      face.matrixAutoUpdate = false;
      face.add(extra);
      inst.root.add(face);
      faces[i] = { node, face, lift, size: rec.sets[civ.attachSet][3] };
    });
    inst.heldKey = key;
  }
  for (const h of faces) {
    if (h.face) placeFacing(inst, h, ctx);
  }
}

/**
 * The camera-facing second slot, this frame: the point `T(0, h, 0)` reaches
 * in the item's frame, then the camera's own axes at `set.w * model+0x116C`,
 * then `T(0, -h, 0)`.
 */
function placeFacing(inst: Instance, h: HeldItemNodes, ctx: Context): void {
  const face = h.face!;
  if (!ctx.view) return;
  ctx.view.copyMatrices(_w2v, _v2w);
  h.node.updateWorldMatrix(true, false);
  _v.set(0, h.lift, 0).applyMatrix4(h.node.matrixWorld);
  _v.applyMatrix4(_m.fromArray(_w2v));
  const s = h.size * inst.a.scale;
  _w.fromArray(_v2w)
    .multiply(_m.makeTranslation(_v.x, _v.y, _v.z))
    .multiply(_m.makeScale(s, s, s))
    .multiply(_m.makeTranslation(0, -h.lift, 0));
  face.matrix.copy(_inv.copy(inst.root.matrixWorld).invert()).multiply(_w);
  face.matrixWorldNeedsUpdate = true;
}

/** Take every held-item node off `inst`, for a rebuild. */
export function clearHeldItems(inst: Instance): void {
  for (const g of inst.held?.values() ?? []) g.removeFromParent();
  for (const h of inst.heldNodes ?? []) h.face?.removeFromParent();
  inst.held?.clear();
  if (inst.heldNodes) inst.heldNodes.length = 0;
  inst.heldKey = undefined;
}
