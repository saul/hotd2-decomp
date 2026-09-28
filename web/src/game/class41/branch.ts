/**
 * The nine class 0x41 / 0x44 objects that decide which way a stage goes.
 *
 * `g_script_branch_var` (`0x009C88A4`) has sixteen writers and **nine of them
 * are props**: a shootable thing standing in a branch block whose one job is
 * to answer `EvtAdvanceStepOrRoute`'s `next[]` index. They are here rather
 * than one file apiece because they are one mechanism written nine ways, and
 * reading them side by side is the only way the shape is visible. Types 40,
 * 70 and 76 are ported whole and live in their own files; the table keeps
 * their rows so the nine are still read together:
 *
 * ```
 * type 14  first hit          -> 1 - obj+0x11C     both modes     (type14.ts)
 * type 19  first hit          -> 1 - obj+0x11C     both modes     (type19.ts)
 * type 25  first hit, block 0x17 -> 1              both modes     (type25.ts)
 * type 40  both sub-kind 9 broken, flag 0x11 -> 2  original only  (type40.ts)
 * type 56  script flag 5, block 9 -> 2             original only  (type56.ts)
 * type 69  flag 0x23, already 1, shot -> 2         original only  (type69.ts)
 * type 70  scene 2, block 4, flag 0x13 -> scene    original only  (original_item.ts)
 * type 73  first hit, block 7, flag 0x12, key -> 2 original only  (type73.ts)
 * type 76  first hit, block 5 or 0x0E + key -> 2   original only  (type76.ts)
 * chain    any link, group 1, block 0x16 -> 2      original only
 * switch   scene/block table, its own flag -> 2    original only
 * ```
 *
 * ## Why `1 - obj+0x11C` is the whole idea
 *
 * Types 14, 19 and 25 are a matched pair with their constructor.
 * `PlaceGenericProp` **seeds** `g_script_branch_var` with the descriptor's
 * `+0x11C` at spawn time (cases 0x0E and 0x13) or with 0 (case 0x19), and the
 * update writes the *other* value on the first hit. So the descriptor names
 * the default route and shooting the prop takes the other one — the branch is
 * authored in the level, not in the code. Those three are also the only
 * branch props arcade can reach, and all three increment an enemy counter:
 * they are enemies standing still, not scenery.
 *
 * ## What is transcribed here, and what is not
 *
 * Eight of the nine are no longer here: types 14, 19, 25, 56, 69, 70 (and 71,
 * the same routine), 73 and 76 are transcribed whole, each in its own file
 * beside type 40's, and their branch write sits in its routine exactly where
 * the exe has it — with the fall, the swing, the sounds, the draws and, for
 * 14, 19 and 25, the enemy count their arms raise and their routines give
 * back.
 *
 * **What is left here is the gate and the write, and the latch that stops it
 * firing twice**, for the routines whose other arms are not yet read: the
 * chain segments and the story-mode switch. What each doc comment lists as
 * unported is what a later pass still
 * owes it. The line was drawn there first because a route the stage takes is
 * a fact about where the whole rest of the level goes, and a prop that swings
 * correctly while sending the player down the wrong road is worth less than
 * one that stands still and routes right.
 */
import { G } from "../globals";
import { GameMode } from "../game_mode";
import { PlayerHoldsOriginalItem } from "../original_mode";
import { BreakableFlag, type BreakableProp } from "./prop_state";

/**
 * `obj+0x34` bit 30 — "this object has already answered".
 *
 * Types 14, 19, 25 and 76 latch it, and it is the same bit
 * `PropUpdateType25` sets alongside `0x04000000`. Named here rather than in
 * `prop_state.ts` because it is the branch family's, and the group props
 * never set it.
 */
export const PROP_BRANCH_ANSWERED = 0x40000000;

/** `g_script_flags` indices the branch props gate on. */
export enum BranchScriptFlag {
  /** `PropUpdateType56`. */
  Type56Trigger = 0x05,
  /** `PropUpdateType40`'s pair, alongside both of them being broken. */
  FragmentPair = 0x11,
  /** `PropUpdateType73`. */
  Type73Trigger = 0x12,
  /**
   * `OriginalItemPropUpdate` (`FUN_004675A0`), in scene 2 block 4 -- see
   * `class41/original_item.ts`.
   */
  OriginalItemRoute = 0x13,
  /** `PropUpdateType69`, which promotes an existing 1 to a 2. */
  Type69Promote = 0x23,
}

/** The event blocks a trigger is live in, where it names one. */
export enum BranchBlock {
  /** `PropUpdateType76` (`FUN_00471330`)'s first arm -- `class41/type76.ts`. */
  Type76First = 5,
  /** `PropUpdateType73`. */
  Type73 = 7,
  /** `PropUpdateType56`. */
  Type56 = 9,
  /** `PropUpdateType76`'s second arm, the key-gated one. */
  Type76Keyed = 0x0e,
  /** `ChainSegmentUpdate`. */
  Chain = 0x16,
  /** `PropUpdateType25`. */
  Type25 = 0x17,
}

/**
 * `ChainSegmentUpdate` — `FUN_00469510`. One link of the twenty
 * `PlaceChainSegments` builds.
 *
 * ```c
 * if ((obj->+0x34 & 8)) {
 *     ...pay, PlaySoundId(0xF16A9), shake the two neighbours either side...
 *     if (g_GameMode == 1 && obj->+0x1AC == 1
 *         && g_chain_segments[1 * 0x14 + 0]->+0x1B0 == 0
 *         && g_evt_block_index == 0x16) {
 *         g_chain_segments[1 * 0x14 + 0]->+0x1B0 = 1;
 *         g_script_branch_var = 2;
 *     }
 * }
 * ```
 *
 * **Any link opens the route**, and the latch lives on segment 0 rather than
 * on the link that was hit — which is what makes twenty objects behave as one
 * switch. Group 1 is the only group that carries it, and
 * `PlaceChainSegments` refuses to build group 1 at all outside Original Mode.
 *
 * Stage 2 block 22 is 0x16 and its record is `{23, -1, 34}`.
 *
 * Not transcribed: the neighbour shake, the spark, and the hanging matrix
 * that swings the whole chain from one hit.
 */
export function ChainSegmentUpdate(p: BreakableProp,
                                   segmentZero: BreakableProp | undefined):
                                   void {
  if ((p.flags & BreakableFlag.Hit) === 0) return;
  if (G.g_GameMode !== GameMode.Original) return;
  if (p.chainGroup !== 1) return;
  if (G.g_evt_block_index !== BranchBlock.Chain) return;
  if (!segmentZero || segmentZero.branchLatched) return;
  segmentZero.branchLatched = true;
  G.g_script_branch_var = 2;
}

/**
 * The `(scene, block)` pairs `StoryModeSwitchUpdate` opens a route in.
 *
 * A table because the engine's is one: a `switch` on `g_scene_index` with a
 * block test in each arm, and no arm for the two scenes that are missing.
 * Every pair here is a route record whose live alternate is **slot 2**, which
 * is the check that the reading is right — stage 1 block 4 `{6, -1, 13}`,
 * stage 2 blocks 1 `{2, -1, 29}`, 3 `{4, -1, 30}` and 12 `{13, -1, 31}`, and
 * stage 5 block 4 `{5, -1, 6}`.
 */
/**
 * `obj->+0x1FC == -1 || HasItem(+0x1FC) || HasItem(+0x202) || HasItem(+0x208)
 * || HasItem(+0x20E)` — the key test, which a switch with no key passes on
 * its first clause.
 *
 * [port-only] as a *function*: the engine has it inline as one long `||`
 * chain. Split out because it is the half a test can drive.
 */
export function StoryModeSwitchKeyed(p: BreakableProp): boolean {
  if (p.key0 === -1) return true;
  return PlayerHoldsOriginalItem(p.key0)
    || PlayerHoldsOriginalItem(p.key1)
    || PlayerHoldsOriginalItem(p.key2)
    || PlayerHoldsOriginalItem(p.key3);
}

export const STORY_SWITCH_ROUTES: ReadonlyArray<readonly [number, number]> = [
  [0, 4],
  [1, 1], [1, 3], [1, 0x0c],
  [4, 4],
];

/**
 * `g_script_flags[0x15]` — the flag `StoryModeSwitchUpdate`'s **head** raises,
 * and the only writes of that byte by literal address in the image:
 * `0x00474FA6` and `0x004751B1`.
 *
 * Stage 3's block 2 step 3 is `wait_script_flag 0x15`, and on the
 * block-7 -> block-8 route nothing else in the stage sets it: the script's own
 * `set_script_flag 0x15` is in block 1 step 5 (evt `0x001D00`), and block 1 is
 * only on the entry-0 route. The switch that carries it there is the one
 * block 7 step 8 spawns (evt `0x3630`), whose `obj+0x2A4` removal flag is 22 —
 * which block 2 step 3 raises at its own end, so the object is taken away one
 * gate later by the same step it opened.
 */
export const STORY_SWITCH_SCRIPT_FLAG = 0x15;

/**
 * The one `(scene, block)` the head raises {@link STORY_SWITCH_SCRIPT_FLAG}
 * in — the `else` arm of the scene-1 despawn test, not a member of
 * {@link STORY_SWITCH_ROUTES}.
 *
 * Two pairs, one effect each, in one routine: this pair raises a flag before
 * the mode gate; those five write `g_script_branch_var` behind it. Keeping
 * them as separate tables is what stops a reader assuming the routine has one
 * scene table.
 */
export const STORY_SWITCH_FLAG_AT: readonly [number, number] = [2, 2];

/**
 * `StoryModeSwitchUpdate` — `FUN_00474F30`. `g_class44_subtypes[17]`'s
 * object, and the branch writer with the widest reach: twelve spawns over
 * four stages.
 *
 * ```c
 * if (g_GameMode == 1 && obj->+0x192 == 1) {
 *     ...60 frames of g_pHingeCurvesXYZ...
 *     if (obj->+0x2A0 >= 0 && g_script_flags[obj->+0x2A0] == 1) {
 *         switch (g_scene_index) {
 *           case 0: if (g_evt_block_index != 4) break;                goto set;
 *           case 1: if (block != 1 && block != 3 && block != 0x0C) break; goto set;
 *           case 4: if (g_evt_block_index != 4) break;                goto set;
 *         }
 *         set: g_script_branch_var = 2; obj->+0x2A0 = -1;
 *     }
 * }
 * ```
 *
 * Two latches, not one. `obj+0x192` says the switch has been **thrown** — by
 * a shot, or by carrying any of the four item ids its descriptor names, or by
 * `DAT_009A26EC` — and `obj+0x2A0` names the script flag that then has to be
 * up, and is set to -1 once the route is taken so it fires once.
 *
 * The four item ids are `obj+0x1FC`, `+0x202`, `+0x208` and `+0x20E`, and the
 * first being **-1** is what says this switch has no key at all — the engine's
 * test is `obj->+0x1FC == -1 || HasItem(+0x1FC) || HasItem(+0x202) || ...`, so
 * a shot alone throws those. `+0x2A0` and `+0x2A4` are the two script flags,
 * and the exporter carries all six now.
 *
 * **The flag this routine raises is not in here.** `g_script_flags[0x15]` is
 * written twice, and the first of the two (`0x00474FA6`) is in the routine's
 * head, *before* the `CMP g_GameMode, 1` at `0x00474FB4` — so it runs in
 * Arcade as well as Original. That is
 * {@link STORY_SWITCH_SCRIPT_FLAG}, and it is transcribed in
 * `StoryModeSwitchPoolUpdate` with the two despawn tests it sits between,
 * because that is where the engine puts it. Reading this function as "the
 * whole of the switch" is what hid it: stage 3's block 2 parked on
 * `wait_script_flag 0x15` for ever on the entry-7 route.
 *
 * Not transcribed: the hinge curve, the story-mode item spawns in scene 2
 * blocks 2 and 4, and `DAT_009A26EC`, the once-a-scene latch that also throws
 * the switch and whose other reader is unread.
 *
 * The item spawn carries the **second** write of `g_script_flags[0x15]`, at
 * `0x004751B1`: in Original Mode, once `obj+0x192` has latched and the item
 * has been handed out, the routine waits for `g_script_flags[0x18]` and then
 * counts `obj+0x2B0` past `0x4C` before raising the flag. It was left out
 * while `SpawnStoryModeItem` (`FUN_00467B90`) was unported; that is ported now
 * (`class41/items.ts`), and each of these two arms also clears
 * `g_original_item_pickup_blocked` after its item (`0x00475168`,
 * `0x0047522F`), so this arm is what is left to read. It is reachable only
 * once the switch is thrown — which for stage 3's switch needs
 * `PlayerHoldsOriginalItem` of item 0 or 6, since its `obj+0x1FC` is 0 and not
 * -1. A player who has one of those in Original Mode still hangs on that gate.
 * `[open]`
 */
export function StoryModeSwitchUpdate(p: BreakableProp): void {
  if (G.g_GameMode !== GameMode.Original) return;
  // `obj+0x192` — thrown. A shot does it, but only with the key: the engine's
  // condition is the hit AND (no key named OR the player holds one of four).
  if ((p.flags & BreakableFlag.Hit) !== 0 && StoryModeSwitchKeyed(p)) {
    p.branchLatched = true;
  }
  if (!p.branchLatched) return;
  // `obj+0x2A0` — the script flag this switch waits on, and the second latch:
  // the engine stores -1 here the frame the route is taken, so a switch that
  // is still standing in the block on the next frame does not write again.
  if (p.storyItem < 0) return;
  const here = STORY_SWITCH_ROUTES.some(
    ([scene, block]) => scene === G.g_scene_index
      && block === G.g_evt_block_index);
  if (!here) return;
  G.g_script_branch_var = 2;
  p.storyItem = -1;
}
