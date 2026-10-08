/**
 * The nine class 0x41 / 0x44 objects that decide which way a stage goes.
 *
 * `g_script_branch_var` (`0x009C88A4`) has sixteen writers and **nine of them
 * are props**: a shootable thing standing in a branch block whose one job is
 * to answer `EvtAdvanceStepOrRoute`'s `next[]` index. They are here rather
 * than one file apiece because they are one mechanism written nine ways, and
 * reading them side by side is the only way the shape is visible. Every one
 * is ported whole now and lives in its own file; the table keeps their rows
 * so they are still read together:
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
 * chain    any link, group 1, block 0x16 -> 2      original only  (chain.ts)
 * switch   scene/block table, its own flag -> 2    original only  (class44/story_switch.ts)
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
 * ## What is left here
 *
 * The constants the branch props share and nothing else. Types 14, 19, 25,
 * 40, 56, 69, 70 (and 71, the same routine), 73 and 76, the chain and the
 * story-mode switch are transcribed whole, each in its own file, and their
 * branch write sits in its routine exactly where the exe has it -- with the
 * fall, the swing, the sounds, the draws and, for 14, 19 and 25, the enemy
 * count their arms raise and their routines give back.
 */

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
