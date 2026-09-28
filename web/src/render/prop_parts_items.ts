/**
 * The draw halves of class 0x41 types 70 to 77: Original Mode's collectibles
 * and the four routines beside them.
 *
 * The same shape as `render/prop_parts.ts`, whose list this extends: each
 * function is one routine's `MatrixStackPush` / `AssetDrawSlot` blocks
 * written out as data, reading state `game/class41/` leaves and writing none
 * of it back. What this file adds to that shape is the two things these
 * routines do that the others do not: `AssetDrawSlotWithAlpha` (`alpha`) and
 * `MatrixClearRotation` (`billboard`).
 */
import {
  ORIGINAL_ITEM_FADE_FROM, ORIGINAL_ITEM_FADE_STEP,
  ORIGINAL_ITEM_NO_SLOT, ORIGINAL_ITEM_SECOND_TOWARD_VIEWER,
} from "../game/class41/original_item";
import { TYPE74_SLOT } from "../game/class41/type74";
import {
  TYPE76_PAIR_A_AT, TYPE76_PAIR_B_AT, TYPE76_PAIR_PLATE_AT,
  TYPE76_PAIR_SLOT_A, TYPE76_PAIR_SLOT_B, TYPE76_PAIR_YAW, TYPE76_PLATE_AT,
  TYPE76_PLATE_SCALE, TYPE76_PLATE_SLOT, TYPE76_PLATE_YAW,
  TYPE76_SINGLE_SLOT, Type76Door, Type76Phase,
} from "../game/class41/type76";
import { TYPE77_SCALE, TYPE77_SLOT } from "../game/class41/type77";
import { type BreakableProp } from "../game/class41/prop_state";
import type { PropPart } from "./prop_parts";

function part(slot: number, x: number, y: number, z: number,
              pitch = 0, yaw = 0, roll = 0, order = "ZYX",
              s: readonly [number, number, number] = [1, 1, 1],
              parent = -1): PropPart {
  return { slot, x, y, z, pitch, yaw, roll, order,
           sx: s[0], sy: s[1], sz: s[2], parent };
}

/**
 * `AssetDrawSlot` below frame 0x19 of the pickup strip and
 * `AssetDrawSlotWithAlpha(slot, 1.0 - n * 0.02)` from it: `FILD [n]; FMUL
 * [0x004E3100]; FSUBR [0x004C4380]; FSTP float`.
 */
function ItemAlpha(p: BreakableProp): number | null {
  if (p.storyItem < ORIGINAL_ITEM_FADE_FROM) return null;
  return Math.fround(1.0 - p.storyItem * ORIGINAL_ITEM_FADE_STEP);
}

/**
 * The three draw blocks `OriginalItemPropUpdate` (`FUN_004675A0`) and
 * `PropUpdateType72` (`FUN_00470750`) share:
 *
 * ```
 * Push; T(pos); RotZ; RotY; RotX; Scale(+0x2C4); draw +0x28C (faded late); Pop
 * Push; T(pos); MatrixClearRotation; T(0, 0, 1.5); Scale(+0x2C4);
 *       draw +0x28E (faded late); Pop
 * if (+0x2A0 > 0) { Push; T(pos); RotY(+0x1D0); draw +0x2A4 - 1 + +0x2A0; Pop }
 * ```
 *
 * `secondOnFirst` is 72's gate on the second block — `obj+0x28C`, where 70's
 * is `obj+0x28E` itself.
 */
function CollectibleParts(p: BreakableProp,
                          secondOnFirst: boolean): PropPart[] {
  const out: PropPart[] = [];
  const s = p.itemScale;
  const scale: [number, number, number] = [s, s, s];
  const alpha = ItemAlpha(p);
  if (p.slot !== ORIGINAL_ITEM_NO_SLOT) {
    const q = part(p.slot, p.x, p.y, p.z, p.pitch, p.yaw, p.roll, "ZYX",
                   scale);
    q.alpha = alpha;
    out.push(q);
  }
  const second = secondOnFirst ? p.slot !== ORIGINAL_ITEM_NO_SLOT
    : p.slotB !== ORIGINAL_ITEM_NO_SLOT;
  if (second) {
    const q = part(p.slotB, p.x, p.y, p.z, 0, 0, 0, "", scale);
    q.alpha = alpha;
    q.billboard = true;
    q.view = [0, 0, ORIGINAL_ITEM_SECOND_TOWARD_VIEWER];
    out.push(q);
  }
  if (p.storyItem > 0) {
    out.push(part(p.removeFlag - 1 + p.storyItem, p.x, p.y, p.z,
                  0, p.yaw, 0, "Y"));
  }
  return out;
}

/** `OriginalItemPropUpdate` (`FUN_004675A0`), types 70 and 71. */
export function OriginalItemParts(p: BreakableProp): PropPart[] {
  return CollectibleParts(p, false);
}

/**
 * `PropUpdateType72` (`FUN_00470750`): nothing while it waits (`obj+0x192`
 * of 0 jumps past all three blocks), then the collectible's three.
 */
export function Type72Parts(p: BreakableProp): PropPart[] {
  if (p.routinePhase <= 0) return [];
  // `CMP word ptr [ESI + 0x28C], -1` at `0x00470A60`: the second block is
  // gated on the first model, not on the one it draws.
  return CollectibleParts(p, true);
}

/** `PropUpdateType74` (`FUN_00470E20`): `T(pos) Rz Ry Rx`, `0xA64`. */
export function Type74Parts(p: BreakableProp): PropPart[] {
  return [part(TYPE74_SLOT, p.x, p.y, p.z, p.pitch, p.yaw, p.roll)];
}

/**
 * `PropUpdateType75` (`FUN_004710C0`): `T(path) Rz(rz) Ry(ry) Rx(rx)` and
 * `0xA6B` -- the path's pose alone, none of the prop's own.
 */
export function Type75Parts(p: BreakableProp): PropPart[] {
  const at = p.pathPose;
  if (!at) return [];
  return [part(at.slot, at.x, at.y, at.z, at.pitch, at.yaw, at.roll)];
}

/**
 * `PropUpdateType76` (`FUN_00471330`), by `obj+0x194`:
 *
 * * 0 — `T(pos) Rz Ry Rx` and `0xA6D`; while shut, `T(-2.5, -30, -17.5)
 *   RotY(0x4000) Scale(1.2)` and the plate `0x10D3` on it.
 * * 1 — each leaf `T(literal) RotY(-0x2168)` and then its own three angles:
 *   `0xA67` under `Rz(+0x1D4) Ry(+0x1E8) Rx(+0x1E4)` with the plate at
 *   `T(12.5, 23.5, 0.5)` while shut, and `0xA68` under `Rz Ry(+0x1D0)
 *   Rx(+0x1CC)`.
 * * anything else — no draw.
 */
export function Type76Parts(p: BreakableProp): PropPart[] {
  const shut = p.routinePhase === Type76Phase.Shut;
  if (p.group === Type76Door.Single) {
    const out = [part(TYPE76_SINGLE_SLOT, p.x, p.y, p.z,
                      p.pitch, p.yaw, p.roll)];
    if (shut) {
      const k = TYPE76_PLATE_SCALE;
      out.push(part(TYPE76_PLATE_SLOT, ...TYPE76_PLATE_AT,
                    0, TYPE76_PLATE_YAW, 0, "Y", [k, k, k], 0));
    }
    return out;
  }
  if (p.group !== Type76Door.Pair) return [];
  const out = [
    part(0, ...TYPE76_PAIR_A_AT, 0, TYPE76_PAIR_YAW, 0, "Y"),
    part(TYPE76_PAIR_SLOT_A, 0, 0, 0, p.restPitch, p.hingeB, p.roll, "ZYX",
         [1, 1, 1], 0),
  ];
  if (shut) {
    out.push(part(TYPE76_PLATE_SLOT, ...TYPE76_PAIR_PLATE_AT, 0, 0, 0, "",
                  [1, 1, 1], 1));
  }
  const b = out.length;
  out.push(part(0, ...TYPE76_PAIR_B_AT, 0, TYPE76_PAIR_YAW, 0, "Y"));
  out.push(part(TYPE76_PAIR_SLOT_B, 0, 0, 0, p.pitch, p.yaw, p.roll, "ZYX",
                [1, 1, 1], b));
  return out;
}

/**
 * `PropUpdateType77` (`FUN_004717A0`), on an even blink frame:
 * `T(pos) RotY(+0x1D0) T(path)` and then `RotY(+0x1DC) Scale(2)`, `0x10AB`.
 * The routine leaves {@link BreakableProp.pathPose} empty on a frame it does
 * not draw.
 */
export function Type77Parts(p: BreakableProp): PropPart[] {
  const at = p.pathPose;
  if (!at) return [];
  const k = TYPE77_SCALE;
  return [
    part(0, p.x, p.y, p.z, 0, p.yaw, 0, "Y"),
    part(TYPE77_SLOT, at.x, at.y, at.z, 0, p.yawSpin, 0, "Y", [k, k, k], 0),
  ];
}
