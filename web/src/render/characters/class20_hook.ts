/**
 * `OneHitTargetBoneDrawHook`'s second models, drawn.
 *
 * Class 0x20's per-bone callback (`FUN_00449530`) is a switch on the node's
 * bone, through the byte map at `0x00449610`:
 *
 * ```
 * bones 4, 7, 11, 14:  AssetDrawSlot(record slot)
 *                      Push; MatrixTranslate(child+0x04, +0x08, +0x0C)
 *                      AssetDrawSlot(child+0x00); Pop       ; child = node+0x18
 * bone 2:              the record slot, at MatrixScale(2, 2, 2) in Original
 *                      Mode with g_original_item_big_head up
 * every other bone:    AssetDrawSlot(record slot)
 * ```
 *
 * `node+0x18` is the **skeleton node's** first child pointer, so the second
 * model is that child's own slot at that child's own offset -- static data,
 * never the child's draw record. `OneHitTargetInit` (`FUN_00448ED0`) zeroed
 * the child's record (`game/class20/`, `CLASS20_CARRIED_BONES`), which the
 * port keeps as `a.removed`, so the child's own node is hidden and this is
 * the only draw of a hand or a foot: carried rigidly by its forearm or shin,
 * without the child's own turn. It hangs under the parent's node, so the
 * parent's draw gates reach it as `SkeletonEmitNode`'s reach the hook.
 *
 * Not here: the bone-2 arm. `g_original_item_big_head`'s one writer, an
 * Original Mode item (`FUN_00416240`), is unported, so the flag is never up
 * and the arm draws exactly what the node already does.
 *
 * Render bookkeeping only: which bones carry which model is a function of the
 * character type, so a snapshot determines it and `resync` needs no help.
 */
import type { CharacterType } from "../../bundle";
import { CLASS20_CARRYING_BONES } from "../../game/class20/state";
import { MatIdentity, MatrixTranslate } from "../../game/matrix";
import type { HookDraw } from "./humanoid_hook";

/**
 * Every second model `OneHitTargetBoneDrawHook` draws for a character of
 * `type`: one per carrying bone that has a child, the child's slot under the
 * bone's matrix translated by the child's offset.
 *
 * The bundle's bones are the skeleton's nodes in the engine's depth-first
 * order with `parent` an index into the list, so a node's first child pointer
 * (`node+0x18`) is the first entry whose `parent` is its index.
 */
export function OneHitTargetHookDraws(type: CharacterType): HookDraw[] {
  const out: HookDraw[] = [];
  for (const bone of CLASS20_CARRYING_BONES) {
    const i = type.bones.findIndex((b) => b.bone === bone);
    if (i < 0) continue;
    const child = type.bones.find((b) => b.parent === i);
    if (!child || !child.slot) continue;
    const m = MatIdentity();
    MatrixTranslate(m, child.offset[0], child.offset[1], child.offset[2]);
    out.push({ bone, slot: child.slot, m, world: false });
  }
  return out;
}
