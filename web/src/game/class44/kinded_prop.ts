/**
 * Class 0x44 selector 15 — the class-0x44 builder of class 0x41 type 4's
 * object: a prop of one of `g_prop_kind_params`' kinds, run by
 * `KindedPropUpdate` (`FUN_00465FB0`, `class41/kinded.ts`).
 *
 * Nine spawns: stage 1's two (`0x2D14`/`0x2D44`, kind 0, which has no
 * model), stage 2's one (`0xEE74`), stage 3's three (`0x2504`/`0x2534`/
 * `0x54C0`) and stage 4's two (`0x5968`/`0x5998`), all kind 2, and stage 6's
 * one (`0x19F0`, kind 9).
 *
 * ## The builder `[proved]`
 *
 * ```c
 * PropBuildKindedProp (0x00473770):
 *   if (g_GameMode != 1
 *       && ((scene == 1 && block == 0x15) || (scene == 2 && (block == 1 || block == 8
 *            || block == 4)) || (scene == 5 && block == 1)))
 *       return;                                       // before ActorAlloc
 *   obj = ActorAlloc(KindedPropUpdate, 0x378); ActorClearGameFields(obj);
 *   obj->+0x290 = (s16)desc->+0x6C;                   // the kind
 *   obj->+0x19C..0x1A4 = desc pos;  obj->+0x1D0 = desc->+0x68;
 *   obj->+0x124 = (float)g_prop_kind_params[kind].radius;
 *   obj->+0x197 = 0;  obj->+0x196 = g_evt_step_index;  obj->+0x34 = 0x80000001;
 *   obj->+0x11C = (u16)tail->+0x00;  obj->+0x194 = (s8)tail->+0x04;
 *   obj->+0x2A0 = tail->+0x08;                        // the Original Mode story item
 *   obj->+0x28C = kind 2 ? 0x17A9 : 3 ? 0x19E8 : 8 ? 0x17AA : 9 ? 0x17AB : 0xFFFF;
 *   obj->+0x324 = g_prop_kind_params[kind].effect;  obj->+0x328 = .effect_variant;
 *   obj->+0x32C = obj->+0x330 = 0;
 *   if (obj->+0x194 > 0)
 *       g_item_set_countdown[obj->+0x194] = desc->+0x64 > 1 ? rand() % desc->+0x64 + 1 : 1;
 * ```
 *
 * It is `PlaceKindedProp` (`FUN_00462E10`) line for line with three
 * differences: the gate at its head, the item set from the tail's `+0x04`
 * rather than the placer's `+0x1F4`, and `obj+0x2A0` from the tail's `+0x08`
 * rather than `-1` -- which is what `KindedPropUpdate`'s release hands
 * `SpawnStoryModeItem` in Original Mode. **Five of the nine are behind the
 * gate**: stage 2's, stage 3's three and stage 6's are built only in Original
 * Mode.
 */
import type { Rng } from "../../core/rng";
import type { BreakablePlacement } from "../../bundle";
import { G } from "../globals";
import { GameMode } from "../game_mode";
import { T } from "../tables";
import { MsvcRand } from "../class41/group";
import { KIND_SLOT, SLOT_NONE } from "../class41/kinded";
import {
  BreakableFlag, BreakableState, makeBreakableProp, PropFamily,
  type BreakableProp,
} from "../class41/prop_state";

/**
 * `(g_scene_index, g_evt_block_index)` pairs at which the builder builds
 * nothing outside Original Mode -- the chain of compares at
 * `0x00473780`..`0x004737D3`.
 */
export const KINDED_PROP_ORIGINAL_ONLY_AT: readonly (readonly [number, number])[] = [
  [1, 0x15], [2, 1], [2, 8], [2, 4], [5, 1],
];

/**
 * `PropBuildKindedProp` — `FUN_00473770`. `g_class44_subtypes[15]`.
 * Null where the gate returns before the allocation.
 */
export function PropBuildKindedProp(pl: BreakablePlacement,
                                    rng: Rng): BreakableProp | null {
  if (G.g_GameMode !== GameMode.Original) {
    const scene = (G.g_scene_index << 16) >> 16;
    const block = (G.g_evt_block_index << 16) >> 16;
    if (KINDED_PROP_ORIGINAL_ONLY_AT.some(([s, b]) => s === scene && b === block)) {
      return null;
    }
  }
  const kind = pl.kind ?? 0;
  const p = makeBreakableProp(G.g_breakable_next_id++, 0, 0);
  p.family = PropFamily.Kinded;
  p.at = pl.at;
  p.kind = kind;
  p.x = Math.fround(pl.pos?.[0] ?? 0);
  p.y = Math.fround(pl.pos?.[1] ?? 0);
  p.z = Math.fround(pl.pos?.[2] ?? 0);
  p.yaw = pl.yaw ?? 0;
  const params = T.breakables?.kinds?.[kind];
  // `MOVSX EDX, word [EAX + 0x593DC0]; FILD; FSTP float [ESI+0x124]`.
  p.hitRadius = params?.radius ?? 0;
  p.stepsElapsed = 0;
  p.lastStepIndex = G.g_evt_step_index;
  p.flags = (0x80000000 | BreakableFlag.Live) >>> 0;
  p.state = BreakableState.Standing;
  p.lifetime = pl.lifetime_evt_steps;
  p.itemSet = pl.item_set ?? 0;
  p.storyItem = pl.story_item ?? -1;
  p.slot = KIND_SLOT[kind] ?? SLOT_NONE;
  p.effect = params?.effect ?? 0;
  p.effectVariant = params?.effect_variant ?? 0;
  p.effectFrames = 0;
  p.effectPrevFrame = 0;
  // `CMP AL, DL; JLE` -- a signed byte, so a negative set seeds nothing.
  if (p.itemSet > 0) {
    const size = pl.set_size ?? 0;
    // `CALL rand; CDQ; IDIV [EDI+0x64]; INC DL` -- stored as a byte.
    G.g_item_set_countdown[p.itemSet] =
      size > 1 ? ((MsvcRand(rng) % size) + 1) & 0xff : 1;
  }
  return p;
}
