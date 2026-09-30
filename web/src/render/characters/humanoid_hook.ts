/**
 * `ScriptedHumanoidBoneDrawHook`'s extra models, drawn.
 *
 * Class 0x25's per-bone callback (`FUN_00485260`) draws each node's own model
 * and then, for a few character types and motions, one more model for the
 * node: after the switch on the bone, two switches on the character type pick
 * an arm by the motion playing (`obj+0x1B4`) and gate it on the play cursor
 * (`obj+0x19C`). The literals are in `game/class25/state.ts` (`HOOK_*`); this
 * file is the drawing of them and nothing else, as `cels.ts` is for class
 * 0x30's hook. Which arm draws is a function of `a.charType`, `a.motion` and
 * `a.hum.playCursor` -- the cursor the draw computed, which
 * `HumanoidSampleDrawnCursor` leaves on the actor -- so a snapshot fully
 * determines it and `resync` needs no help.
 *
 * **Every call post-multiplies** (`game/matrix.ts`), so each arm's local
 * matrix is built with the engine's own routines in call order and handed to
 * the node whole (`L84`). The arm that draws in the **world** --
 * `MatrixStackSetTopFromArray` with the camera's world-to-view, so what
 * follows is a world matrix -- is hung under its bone anyway, with the bone's
 * world matrix taken back off, because the hook runs only when the node is
 * drawn: `SkeletonEmitNode`'s gate on `MotionFlag.Drawn` and the node's slot
 * is exactly what `applyDrawGates` and a removed bone's hidden node apply to
 * what hangs under the bone.
 *
 * Drawn here: `0x10E3` on motion `0x34C` (both arms), `0x7ED` on `0x14B` and
 * `0x32A`, and `0x125D` for type 0x3F. Not drawn: the two arms that fade slot
 * `0xE24` in over three frames on motions `0x32D`/`0x355` and `0x35D` (stage
 * 2's programs), because each also calls `SpawnTumblingModelAtBone5`
 * (`FUN_00485DE0`) on its first frame -- an object with an update of its own
 * that is state, and the port has no object for it yet. The rest of the hook
 * -- bone 2's head aim and hand-prop cels, and the Original Mode scale on
 * bones 2, 5, 8, 12 and 15 -- changes the node's own draw and is not here
 * either.
 */
import { Matrix4, Object3D } from "three";
import {
  MatIdentity, MatrixRotateX, MatrixRotateY, MatrixRotateZ, MatrixScale,
  MatrixTranslate, type Mat,
} from "../../game/matrix";
import {
  HOOK_14B, HOOK_32A, HOOK_34C, HOOK_3F, HOOK_SECOND_SWITCH_TYPES,
  HOOK_TYPE_3E, HOOK_TYPE_3F,
} from "../../game/class25/state";
import { SpawnClass } from "../../game/spawn_class";
import type { Actor, HumanoidActor } from "../../game/actor";
import type { Instance } from "./instance";

/** One extra model the hook draws this frame. */
export interface HookDraw {
  bone: number;
  slot: number;
  /**
   * The matrix, in `game/matrix.ts`'s layout: under the bone's own when
   * `world` is false, a world matrix when it is true.
   */
  m: Mat;
  world: boolean;
}

/**
 * Every extra model `ScriptedHumanoidBoneDrawHook` draws for `a` this frame,
 * in the order the hook's bone calls and switches make them.
 *
 * Exported for `test/render.test.ts`: the arms and the matrices are what this
 * layer decides.
 */
export function HumanoidHookDraws(a: Actor, cursor: number): HookDraw[] {
  const out: HookDraw[] = [];
  const type = a.charType;
  const motion = a.motion;
  // The first switch, `obj+0x1F4 - 0x3B` (`0x00485625`).
  if (type === HOOK_TYPE_3E && motion === HOOK_14B.motion
      && cursor >= HOOK_14B.from && cursor < HOOK_14B.until) {
    const m = MatIdentity();
    MatrixTranslate(m, HOOK_14B.at[0], HOOK_14B.at[1], HOOK_14B.at[2]);
    MatrixRotateY(m, HOOK_14B.rotY);
    MatrixRotateX(m, HOOK_14B.rotX);
    MatrixScale(m, HOOK_14B.scale, HOOK_14B.scale, HOOK_14B.scale);
    out.push({ bone: HOOK_14B.bone, slot: HOOK_14B.slot, m, world: false });
  }
  if (type === HOOK_TYPE_3F) {
    // No push: the bone's own matrix, `AssetDrawSlot(0x125D)` at `0x00485657`.
    out.push({ bone: HOOK_3F.bone, slot: HOOK_3F.slot, m: MatIdentity(),
               world: false });
  }
  // The second switch, `obj+0x1F4 - 0x21` (`0x0048576E`).
  if (!HOOK_SECOND_SWITCH_TYPES.includes(type)) return out;
  if (motion === HOOK_32A.motion && cursor >= HOOK_32A.from) {
    const m = MatIdentity();
    MatrixTranslate(m, HOOK_32A.at[0], HOOK_32A.at[1], HOOK_32A.at[2]);
    MatrixRotateZ(m, HOOK_32A.rotZ);
    MatrixRotateY(m, HOOK_32A.rotY);
    MatrixScale(m, HOOK_32A.scale, HOOK_32A.scale, HOOK_32A.scale);
    out.push({ bone: HOOK_32A.bone, slot: HOOK_32A.slot, m, world: false });
  } else if (motion === HOOK_34C.motion) {
    const m = MatIdentity();
    if (cursor >= HOOK_34C.split) {
      const b = HOOK_34C.onBone;
      MatrixTranslate(m, b.at[0], b.at[1], b.at[2]);
      MatrixRotateX(m, b.rotX);
      MatrixScale(m, b.scale, b.scale, b.scale);
      out.push({ bone: HOOK_34C.bone, slot: HOOK_34C.slot, m, world: false });
    } else {
      const w = HOOK_34C.inWorld;
      MatrixTranslate(m, a.pos.x, a.pos.y, a.pos.z);
      MatrixRotateY(m, a.yaw);
      MatrixTranslate(m, w.at[0], w.at[1], w.at[2]);
      // `MOV EDX, 0x32; SUB EDX, EBP; FILD` -- then the two products, each
      // `FSTP`ed as an f32 onto the stack.
      const k = HOOK_34C.split - cursor;
      MatrixTranslate(m, 0, Math.fround(k * w.stepY), Math.fround(k * w.stepZ));
      MatrixRotateZ(m, w.rotZ);
      MatrixRotateY(m, w.rotY);
      MatrixRotateX(m, w.rotX);
      MatrixScale(m, w.scale, w.scale, w.scale);
      out.push({ bone: HOOK_34C.bone, slot: HOOK_34C.slot, m, world: true });
    }
  }
  return out;
}

/** Scratch; the layer is single-threaded. */
const _w = new Matrix4();
const _inv = new Matrix4();

/**
 * Hang, re-hang or re-place `inst`'s hook models for this frame. `clone`
 * makes a model from an asset slot, off the character's template.
 *
 * Must run before `applyDrawGates`, so that a node hung this frame arrives
 * under the gate.
 */
export function syncHumanoidHookDraws(
    inst: Instance, clone: (slot: number) => Object3D | null): void {
  const a = inst.a;
  const have = inst.hookDraws ?? (inst.hookDraws = new Map());
  const want = a.cls === SpawnClass.ScriptedHumanoid
    ? HumanoidHookDraws(a, (a as HumanoidActor).hum.playCursor) : [];
  const seen = new Set<string>();
  for (const d of want) {
    const bone = inst.bones.get(d.bone);
    if (!bone) continue;
    const key = `${d.bone}:${d.slot}`;
    seen.add(key);
    let node = have.get(key);
    if (!node) {
      node = new Object3D();
      node.matrixAutoUpdate = false;
      const model = clone(d.slot);
      if (model) node.add(model);
      have.set(key, node);
    }
    if (node.parent !== bone) bone.add(node);
    if (d.world) {
      // The bone's world matrix taken back off, so the node lands where the
      // world matrix says and is still gated with the bone.
      bone.updateWorldMatrix(true, false);
      node.matrix.copy(_inv.copy(bone.matrixWorld).invert())
        .multiply(_w.fromArray(d.m));
    } else {
      node.matrix.fromArray(d.m);
    }
    node.matrixWorldNeedsUpdate = true;
    node.visible = true;
  }
  for (const [key, node] of have) {
    if (seen.has(key)) continue;
    node.visible = false;
  }
}

/** Take every hook node off `inst`, for a rebuild. */
export function clearHumanoidHookDraws(inst: Instance): void {
  for (const n of inst.hookDraws?.values() ?? []) n.removeFromParent();
  inst.hookDraws?.clear();
}
