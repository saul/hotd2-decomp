/**
 * Class 0x44 selector 9 — one asset slot that rises on a script flag to a
 * literal height.
 *
 * One spawn in the game: stage 3 evt `0x0D24` (block 0 step 4 op 7), slot
 * `0x1986` = `st1_1.bin[36]` at `(-1079.9, -25.4, -3018.5)`, lift flag 5 and
 * remove flag 10. The model is 81 wide and 57 tall, `[open]` what it is.
 *
 * ## The two routines `[proved]`
 *
 * `PropBuildFlagLiftedProp` (`FUN_00473300`):
 *
 * ```c
 * obj = ActorAlloc(FlagLiftedPropUpdate, 0x378); ActorClearGameFields(obj);
 * obj->+0x19C..0x1A4 = desc->+0x40..0x48;
 * obj->+0x2A0 = (s8)tail->+0x20;  obj->+0x2A4 = (s8)tail->+0x21;
 * obj->+0x28C = (u16)tail->+0x04;
 * ```
 *
 * -- no `obj+0x34`, no `obj+0x14C`, no yaw: it is not a collider and it is
 * never turned.
 *
 * `FlagLiftedPropUpdate` (`FUN_00474EA0`):
 *
 * ```c
 * if (g_script_flags[obj->+0x2A4] == 1) { ActorKill(); return; }
 * if (g_script_flags[obj->+0x2A0] == 1 && obj->+0x1A0 < 10.0) obj->+0x1A0 += 0.8f;
 * Push; Translate(obj->+0x19C, obj->+0x1A0, obj->+0x1A4); AssetDrawSlot(slot); Pop;
 * ```
 *
 * The ceiling is the **double** 10.0 at `0x00569188` and the step the float
 * `0.8` at `0x004C43A8`; both are world heights, not offsets, so the object
 * climbs from wherever it was placed to the first `y` at or past 10.
 */
import type { BreakablePlacement } from "../../bundle";
import { G } from "../globals";
import { MatrixTranslate } from "../matrix";
import { ActorKillProp } from "../class41/prop";
import { PropDrawBegin, PropDrawSlot, PropMatrixPush }
  from "../class41/prop_draw";
import {
  BreakableState, makeBreakableProp, PropFamily, type BreakableProp,
} from "../class41/prop_state";

/** `FCOMP double ptr [0x00569188]` — the world height it rises to. */
export const FLAG_LIFTED_CEILING = 10.0;
/** `FADD float ptr [0x004C43A8]` — `0.8f` a frame. */
export const FLAG_LIFTED_STEP = Math.fround(0.8);

/** `PropBuildFlagLiftedProp` — `FUN_00473300`. `g_class44_subtypes[9]`. */
export function PropBuildFlagLiftedProp(pl: BreakablePlacement): BreakableProp {
  const p = makeBreakableProp(G.g_breakable_next_id++, 0, 0);
  p.family = PropFamily.FlagLifted;
  p.at = pl.at;
  p.state = BreakableState.Standing;
  // No `OR [ESI+0x34]` in the constructor: the flag word stays cleared.
  p.flags = 0;
  p.x = Math.fround(pl.pos?.[0] ?? 0);
  p.y = Math.fround(pl.pos?.[1] ?? 0);
  p.z = Math.fround(pl.pos?.[2] ?? 0);
  p.storyItem = pl.open_flag ?? 0;
  p.removeFlag = pl.remove_flag ?? -1;
  p.slot = pl.slot ?? 0;
  p.hitRadius = 0;
  return p;
}

/**
 * `FlagLiftedPropUpdate` — `FUN_00474EA0`. One object, one 60 Hz frame.
 *
 * The pool calls it directly: there is no lifetime prologue and no shot test.
 */
export function FlagLiftedPropUpdate(p: BreakableProp): void {
  if (G.g_script_flags[p.removeFlag] === 1) {
    ActorKillProp(p);
    return;
  }
  // `FLD [ESI+0x1A0]; FCOMP double [0x00569188]; TEST AH, 1; JZ` -- below.
  if (G.g_script_flags[p.storyItem] === 1 && p.y < FLAG_LIFTED_CEILING) {
    p.y = Math.fround(p.y + FLAG_LIFTED_STEP);
  }
  PropDrawBegin(p);
  const m = PropMatrixPush();
  MatrixTranslate(m, p.x, p.y, p.z);
  PropDrawSlot(p, m, p.slot);
}
