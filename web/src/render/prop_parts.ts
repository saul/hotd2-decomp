/**
 * The draw halves of the class-0x41 routines that draw **more than one model
 * at more than one pose** — types 38, 39, 40 and 44.
 *
 * `render/breakables.ts` draws everything else as one clone at one pose, and
 * that shape does not fit these: a type-39 stack is up to eight copies of one
 * model at eight positions, a type-40 object bursts into forty pieces, and a
 * type-44 chair is either one model or a ten-node effect tree posed from a
 * baked clip. Each list below is that routine's `MatrixStackPush` /
 * `AssetDrawSlot` blocks written out as data — the state they read is all in
 * `game/class41/`, and nothing here writes any of it back.
 */
import { G } from "../game/globals";
import { PropFamily, type BreakableProp } from "../game/class41/prop_state";
import {
  FRAGMENT_BURST_FRAMES, FRAGMENT_BURST_SCALES, FRAGMENT_BURST_SLOT,
  FRAGMENT_BRANCH_SUBKIND, FRAGMENT_SUBKIND9_EXTRA_AT,
  FRAGMENT_SUBKIND9_EXTRA_SLOT,
} from "../game/class41/type40";
import {
  OriginalItemParts, Type72Parts, Type74Parts, Type75Parts, Type76Parts,
  Type77Parts,
} from "./prop_parts_items";
import {
  TYPE44_FIRST_WHOLE_ROW, TYPE44_SHADOW_RISE,
  TYPE44_SHADOW_SCALE, TYPE44_SHADOW_SLOT, TYPE44_WHOLE_SLOT,
} from "../game/class41/type44";

/** One `AssetDrawSlot` under one matrix. */
export interface PropPart {
  /** The slot, or 0 for a pure transform (an effect tree's parent). */
  slot: number;
  x: number; y: number; z: number;
  pitch: number; yaw: number; roll: number;
  /** The rotation calls in the order the routine makes them. */
  order: string;
  sx: number; sy: number; sz: number;
  /** Index of the part this one hangs off, or -1 for world space. */
  parent: number;
  /**
   * `AssetDrawSlotWithAlpha` (`FUN_004185A0`)'s alpha, or null/absent for a
   * plain `AssetDrawSlot`. Applied to this part's own meshes only.
   */
  alpha?: number | null;
  /**
   * `MatrixClearRotation` (`FUN_004A9F70`) after the part's translate: it
   * takes the camera's rotation instead of any of its own, and {@link view}
   * is a translate in the camera's axes after it.
   */
  billboard?: boolean;
  view?: [number, number, number];
}

/** The families this file draws. */
export const COMPOSITE_FAMILIES: ReadonlySet<PropFamily> = new Set([
  PropFamily.Type38, PropFamily.Type39, PropFamily.Type40, PropFamily.Type44,
  // Types 70..77, in `render/prop_parts_items.ts`.
  PropFamily.OriginalItem, PropFamily.Type72, PropFamily.Type74,
  PropFamily.Type75, PropFamily.Type76, PropFamily.Type77,
]);

function part(slot: number, x: number, y: number, z: number,
              pitch = 0, yaw = 0, roll = 0, order = "ZYX",
              s: readonly [number, number, number] = [1, 1, 1],
              parent = -1): PropPart {
  return { slot, x, y, z, pitch, yaw, roll, order,
           sx: s[0], sy: s[1], sz: s[2], parent };
}

/**
 * What this prop draws this frame, or `null` for a family this file does not
 * own.
 */
export function PropParts(p: BreakableProp): PropPart[] | null {
  switch (p.family) {
    case PropFamily.Type38: return Type38Parts(p);
    case PropFamily.Type39: return Type39Parts(p);
    case PropFamily.Type40: return Type40Parts(p);
    case PropFamily.Type44: return Type44Parts(p);
    case PropFamily.OriginalItem: return OriginalItemParts(p);
    case PropFamily.Type72: return Type72Parts(p);
    case PropFamily.Type74: return Type74Parts(p);
    case PropFamily.Type75: return Type75Parts(p);
    case PropFamily.Type76: return Type76Parts(p);
    case PropFamily.Type77: return Type77Parts(p);
    default: return null;
  }
}

/**
 * `PropUpdateType38` (`FUN_0046BCC0`): `T(x, y, z) . Rz . Ry . Rx` and
 * `obj+0x28C`. The pivot state draws through the matrix it stored at
 * `obj+0x2E4` instead, whose translation the port has already written back to
 * the position — the same matrix, so the same part.
 */
function Type38Parts(p: BreakableProp): PropPart[] {
  return [part(p.slot, p.x, p.y, p.z, p.pitch, p.yaw, p.roll)];
}

/**
 * `PropUpdateType39` (`FUN_0046C240`): for each drawn item,
 * `T(item) . Rz(roll) . Ry(item.ry + yaw) . Rx(item.rx + pitch)`.
 */
function Type39Parts(p: BreakableProp): PropPart[] {
  const n = p.stackDrawn;
  const out: PropPart[] = [];
  for (let i = 0; i < n && i < p.stack.length; i++) {
    const s = p.stack[i];
    out.push(part(p.slot, s.x, s.y, s.z, s.rx + p.pitch, s.ry + p.yaw,
                  p.roll));
  }
  return out;
}

/**
 * `PropUpdateType40` (`FUN_0046C570`): the forty pieces while the burst runs,
 * each `T . Rz . Ry . Rx . S(burst scale)`; then the object itself,
 * `T . Rz . Ry . Rx . S` with `obj+0x1E0`; then sub-kind 9's second model at
 * its fixed point.
 */
function Type40Parts(p: BreakableProp): PropPart[] {
  const out: PropPart[] = [];
  if (p.branchLatched && p.burstFrames < FRAGMENT_BURST_FRAMES) {
    const k = (FRAGMENT_BURST_SCALES[p.subKind] ?? 100) * 0.01;
    p.burst.forEach((b, i) => {
      out.push(part(FRAGMENT_BURST_SLOT + i, b.x, b.y, b.z, b.rx, b.ry, b.rz,
                    "ZYX", [k, k, k]));
    });
  }
  out.push(part(p.slot, p.x, p.y, p.z, p.pitch, p.yaw, p.roll, "ZYX",
                p.drawScale));
  if (p.subKind === FRAGMENT_BRANCH_SUBKIND) {
    const at = FRAGMENT_SUBKIND9_EXTRA_AT[p.member === 0 ? 0 : 1];
    out.push(part(p.slot + FRAGMENT_SUBKIND9_EXTRA_SLOT, at[0], at[1], at[2],
                  0, 0, 0, ""));
  }
  return out;
}

/**
 * `PropUpdateType44` (`FUN_0046D850`): rows 0 and 1 draw effect 0x13 under
 * `T . Rz . Ry . Rx`, the ten nodes posed by `EffectPoseNode` from the
 * cursor at `obj+0x32C`; rows 2..6 draw `0x1064` under the same matrix; every
 * row then draws shadow `0x10D1` flat at the floor, scaled (8, 1, 8).
 */
function Type44Parts(p: BreakableProp): PropPart[] {
  const out: PropPart[] = [];
  if (p.kind < TYPE44_FIRST_WHOLE_ROW) {
    out.push(part(0, p.x, p.y, p.z, p.pitch, p.yaw, p.roll));
    for (const n of p.effectPoses) {
      out.push(part(n.slot, n.x, n.y, n.z, n.pitch, n.yaw, n.roll, "ZYX",
                    [1, 1, 1], 0));
    }
  } else {
    out.push(part(TYPE44_WHOLE_SLOT, p.x, p.y, p.z, p.pitch, p.yaw, p.roll));
  }
  out.push(part(TYPE44_SHADOW_SLOT, p.x,
                G.g_camera_fixed_eye_y + TYPE44_SHADOW_RISE, p.z, 0, 0, 0, "",
                [TYPE44_SHADOW_SCALE, 1, TYPE44_SHADOW_SCALE]));
  return out;
}
