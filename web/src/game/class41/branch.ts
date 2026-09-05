/**
 * The nine class 0x41 / 0x44 objects that decide which way a stage goes.
 *
 * `g_script_branch_var` (`0x009C88A4`) has sixteen writers and **nine of them
 * are props**: a shootable thing standing in a branch block whose one job is
 * to answer `EvtAdvanceStepOrRoute`'s `next[]` index. They are here rather
 * than one file apiece because they are one mechanism written nine ways, and
 * reading them side by side is the only way the shape is visible:
 *
 * ```
 * type 14  first hit          -> 1 - obj+0x11C     both modes
 * type 19  first hit          -> 1 - obj+0x11C     both modes
 * type 25  first hit, block 0x17 -> 1              both modes
 * type 40  both sub-kind 9 broken, flag 0x11 -> 2  original only
 * type 56  script flag 5, block 9 -> 2             original only
 * type 69  flag 0x23, already 1, shot -> 2         original only
 * type 70  scene 2, block 4, flag 0x13 -> scene    original only
 * type 73  first hit, block 7, flag 0x12, key -> 2 original only
 * type 76  first hit, block 5 or 0x0E + key -> 2   original only
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
 * **The gate and the write, and the latch that stops it firing twice.** Every
 * one of these routines also falls, spins, swings a hinge curve, draws two or
 * three parts and plays sounds, and none of that is here — `class41/
 * generic.ts` already declares that the generic props are placed, drawn and
 * otherwise inert, and this narrows that divergence rather than removing it.
 * What each routine's doc comment lists as unported is what a later pass
 * still owes it.
 *
 * The reason to draw the line there and not lower: a route the stage takes is
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
  /** `OriginalItemPropUpdate`, in scene 2 block 4. */
  OriginalItemRoute = 0x13,
  /** `PropUpdateType69`, which promotes an existing 1 to a 2. */
  Type69Promote = 0x23,
}

/** The event blocks a trigger is live in, where it names one. */
export enum BranchBlock {
  /** `PropUpdateType76`'s first arm. */
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

/** The original items `PropUpdateType73` will open its route for. */
const TYPE73_KEYS = [5, 6, 0x0c];
/** The original items `PropUpdateType76`'s block-0x0E arm will open for. */
const TYPE76_KEYS = [0, 2, 0x0b];

/** `g_script_flags[n]`, defaulted — an unraised flag is *absent* from the
 *  array, and an undefined slips straight through a bare `=== 1`. */
function ScriptFlag(n: number): number {
  return G.g_script_flags[n] ?? 0;
}

/**
 * `PlaceGenericProp`'s three spawn-time writes, by type.
 *
 * `null` means "the descriptor's own `+0x11C`", which is what cases 0x0E and
 * 0x13 write; case 0x19 writes the literal 0. A type absent here writes
 * nothing at spawn.
 *
 * These are the **defaults** the matching update routines flip. Reading the
 * constructor and the update apart is what made this mechanism look like two
 * unrelated writes to the same global for as long as it did.
 */
export const GENERIC_BRANCH_SEED: Partial<Record<number, number | null>> = {
  0x0e: null,
  0x13: null,
  0x19: 0,
};

/** Did a shot land on this prop this frame, with the route still unanswered? */
function FirstHit(p: BreakableProp): boolean {
  return (p.flags & BreakableFlag.Hit) !== 0 && !p.branchLatched;
}

/**
 * `PropUpdateType14` — `FUN_00468180`. `g_class41_updates[14]`.
 *
 * ```c
 * if ((obj->+0x34 & 8) && !(obj->+0x34 & 0x40000000)) {
 *     BreakablePropAwardHit(obj->+0x34, 0);
 *     g_script_branch_var = 1 - obj->+0x11C;
 *     PlaySoundId(0x1116A9);
 *     obj->+0x34 |= 0x40000000;
 *     ...the fall, the spin, the rail...
 * }
 * ```
 *
 * `obj+0x11C` here is the **lifetime word the placer copied**, which for this
 * type is also the default route: `PlaceGenericProp` case 0x0E writes the
 * same number into `g_script_branch_var` at spawn. One shipped spawn, stage 2
 * block 5, carrying 0 — so the block routes to `next[0]` untouched and to
 * `next[1]` when shot, and its record is `{21, 6, -1}`.
 *
 * Not transcribed: the fall at `rand()%0x81 + 0xC0` BAMS a frame, the landing
 * on one of four rails, the swing to `0x4000`, the `g_enemies_alive` give-back
 * at frame 0xD1 and the scene-light override this object applies while
 * upright.
 */
export function PropUpdateType14(p: BreakableProp): void {
  if (!FirstHit(p)) return;
  G.g_script_branch_var = 1 - p.lifetime;
  p.branchLatched = true;
  p.flags |= PROP_BRANCH_ANSWERED;
}

/**
 * `PropUpdateType19` — `FUN_00468F00`. `g_class41_updates[19]`.
 *
 * The same write as {@link PropUpdateType14} with one more condition on it:
 * the engine also requires `obj+0x192 < 2`, the object's own state, which is
 * 2 only after the step-change counter has retired it. The port's equivalent
 * is that a retired prop is out of the pool, so the test has nothing left to
 * refuse — recorded rather than transcribed, because inventing a `+0x192`
 * this port does not otherwise keep would be inventing state.
 *
 * One shipped spawn, stage 2 block 7, carrying 0, record `{8, 25, -1}`.
 *
 * Not transcribed: the four-swing idle on `obj+0x1E8`, the `g_script_flags`
 * `0x21` reaction that runs a hinge curve, the `g_enemies_present` give-back
 * and the fall.
 */
export function PropUpdateType19(p: BreakableProp): void {
  if (!FirstHit(p)) return;
  G.g_script_branch_var = 1 - p.lifetime;
  p.branchLatched = true;
  p.flags |= PROP_BRANCH_ANSWERED;
}

/**
 * `PropUpdateType25` — `FUN_00469AE0`. `g_class41_updates[25]`.
 *
 * ```c
 * if ((obj->+0x34 & 8) && !(obj->+0x34 & 0x40000000) && g_evt_block_index == 0x17) {
 *     BreakablePropAwardHit(obj->+0x34, 0);
 *     g_script_branch_var = 1;
 *     ...
 * }
 * ```
 *
 * The block gate is the difference from types 14 and 19, and it is not
 * decoration: this prop's route is only block 0x17's, and `PlaceGenericProp`
 * case 0x19 seeds the variable to **0** rather than to the descriptor's word.
 * One shipped spawn, stage 2 block 23 — which is 0x17 — record
 * `{24, 26, -1}`.
 *
 * Not transcribed: the effect at `obj+0x324`, the frame-0xFE retirement and
 * the `g_enemies_present` give-back.
 */
export function PropUpdateType25(p: BreakableProp): void {
  if (!FirstHit(p)) return;
  if (G.g_evt_block_index !== BranchBlock.Type25) return;
  G.g_script_branch_var = 1;
  p.branchLatched = true;
  p.flags |= PROP_BRANCH_ANSWERED;
}

/**
 * `PropUpdateType40` — `FUN_0046C570`. `g_class41_updates[40]`, 28 spawns.
 *
 * Two halves, and the order matters — the engine tests the **count** before
 * it tests the hit, so the frame that breaks the second prop is not the frame
 * that opens the route:
 *
 * ```c
 * if (g_GameMode == 1 && obj->+0x1BA == 9
 *     && g_branch_prop_shot_count == 2 && g_script_flags[0x11] == 1) {
 *     g_script_branch_var = 2;
 *     g_branch_prop_shot_count = -1;          // fire once
 * }
 * ...
 * if (hit && !obj->+0x1B9 && ...) {
 *     ...forty fragments...
 *     if (g_GameMode == 1 && obj->+0x1BA == 9) g_branch_prop_shot_count += 1;
 * }
 * ```
 *
 * So **both** of the sub-kind-9 props have to be broken, and the counter is
 * shared: it is a global, not a field, which is what lets two objects agree.
 * The `-1` is the latch, and it is why the route cannot open a third time.
 *
 * Not transcribed: the forty fragments, their bounce off
 * `g_camera_fixed_eye_y + 1`, the light colour the routine sets for itself,
 * the two camera-path despawns and the sub-kind draw scales.
 */
export function PropUpdateType40(p: BreakableProp): void {
  if (G.g_GameMode === GameMode.Original && p.subKind === 9
      && G.g_branch_prop_shot_count === 2
      && ScriptFlag(BranchScriptFlag.FragmentPair) === 1) {
    G.g_script_branch_var = 2;
    G.g_branch_prop_shot_count = -1;
  }
  if ((p.flags & BreakableFlag.Hit) === 0 || p.branchLatched) return;
  p.branchLatched = true;
  if (G.g_GameMode === GameMode.Original && p.subKind === 9) {
    G.g_branch_prop_shot_count += 1;
  }
}

/**
 * `PropUpdateType56` — `FUN_0046F090`. `g_class41_updates[56]`.
 *
 * **The shot is not what opens this one.** A script flag is:
 *
 * ```c
 * if (g_script_flags[5] == 1 && obj->+0x192 == 0) {
 *     obj->+0x192 = 1;
 *     PlaySoundId(0x2116A9);
 *     FUN_00420810(4, 0x14);
 *     if (g_GameMode == 1 && g_evt_block_index == 9) g_script_branch_var = 2;
 * }
 * ```
 *
 * The latch is outside the mode and block test, so the flag is consumed even
 * in arcade — where the route is simply never written. One shipped spawn,
 * stage 4 block 9, record `{11, -1, 17}`.
 *
 * Not transcribed: the hit that raises `DAT_009C720E` and starts the fall,
 * the 60 frames of `g_pHingeCurvesXYZ`, and the two draws.
 */
export function PropUpdateType56(p: BreakableProp): void {
  if (ScriptFlag(BranchScriptFlag.Type56Trigger) !== 1 || p.branchLatched) {
    return;
  }
  p.branchLatched = true;
  if (G.g_GameMode === GameMode.Original
      && G.g_evt_block_index === BranchBlock.Type56) {
    G.g_script_branch_var = 2;
  }
}

/**
 * `PropUpdateType69` — `FUN_00470500`. `g_class41_updates[69]`.
 *
 * **The one writer that reads the variable before writing it.**
 *
 * ```c
 * if (g_script_flags[0x23] == 1 && g_script_branch_var == 1 && obj->+0x192 > 0) {
 *     g_script_branch_var = 2;
 *     ...spawn a story-mode item at a fixed point...
 * }
 * ```
 *
 * It does not choose a route; it **promotes** one. A rescue has already put a
 * 1 there, and with the flag raised and this prop already shot the story route
 * replaces it. The whole routine is dead unless `g_GameMode == 1`, and dead in
 * blocks 8 and 3.
 *
 * Two shipped spawns, stage 1 blocks 1 and 9. Block 9's record is `{2, 7, 12}`
 * and slot 2 is real; **block 1's is `{10, 9, -1}` and slot 2 is a hole** — a
 * 2 there would end the scene. It is unreachable in practice because that
 * prop's `+0x11C` is 1, so `PropExpireByStepLifetime` retires it after a
 * single step change and block 1 has ten steps. The port does not special-case
 * it: if the lifetime is ever transcribed wrong, this is where it shows.
 *
 * Not transcribed: the story-mode item spawn, the hit that sparks and starts
 * the fall, and the two draws.
 */
export function PropUpdateType69(p: BreakableProp): void {
  if (G.g_GameMode !== GameMode.Original) return;
  if (G.g_evt_block_index === 8 || G.g_evt_block_index === 3) return;
  if (ScriptFlag(BranchScriptFlag.Type69Promote) === 1
      && G.g_script_branch_var === 1 && p.branchLatched) {
    G.g_script_branch_var = 2;
  }
  // `obj+0x192 = 1` — the routine's own hit arm, which is the only thing
  // above that reads it. Transcribed because the promotion is gated on it and
  // a latch nothing ever sets is a route that can never open.
  if ((p.flags & BreakableFlag.Hit) !== 0) p.branchLatched = true;
}

/**
 * `OriginalItemPropUpdate` — `FUN_004675A0`. `g_class41_updates[70]` **and**
 * `[71]`, 23 spawns — Original Mode's collectible.
 *
 * ```c
 * if (g_scene_index == 2 && g_evt_block_index == 4 && g_script_flags[0x13] != 0)
 *     g_script_branch_var = g_scene_index;
 * ```
 *
 * `g_scene_index` on both sides, so the value written **is 2** — the routine
 * spells the route number as the scene it is standing in. Scene 2 is stage 3,
 * whose block 4 record is `{5, -1, 10}`: slot 2, exactly.
 *
 * The write does not depend on the item having been taken; it fires while the
 * flag is up, every frame, which is harmless because the value never changes.
 *
 * Not transcribed: the pickup itself — the `g_original_items_taken` tally, the
 * `FUN_00475E40` award and the 0x32-frame animation — the bob-and-spin idle,
 * and the two draws. The mode gate is already in `pool.ts` through
 * `GENERIC_ORIGINAL_MODE_ONLY`, which lists both types.
 */
export function OriginalItemPropUpdate(p: BreakableProp): void {
  void p;
  if (G.g_scene_index !== 2) return;
  if (G.g_evt_block_index !== 4) return;
  if (ScriptFlag(BranchScriptFlag.OriginalItemRoute) === 0) return;
  G.g_script_branch_var = G.g_scene_index;
}

/**
 * `PropUpdateType73` — `FUN_00470B70`. `g_class41_updates[73]`.
 *
 * ```c
 * if (g_GameMode == 1 && g_evt_block_index == 7 && g_script_flags[0x12] != 0
 *     && (obj->+0x34 & 8)) {
 *     BreakablePropAwardHit(...);
 *     if (obj->+0x192 == 0 && (HasItem(5) || HasItem(6) || HasItem(0x0C))) {
 *         obj->+0x192 = 1;
 *         g_script_branch_var = 2;
 *     }
 * }
 * ```
 *
 * **The key is checked after the hit is paid**, not before, so shooting it
 * without the key still scores and still sparks — it just does not open the
 * road. One shipped spawn, stage 4 block 7, record `{8, -1, 22}`.
 *
 * Not transcribed: object path 0x179 playing forward with its two sound cues,
 * the spark, and the draw.
 */
export function PropUpdateType73(p: BreakableProp): void {
  if (G.g_GameMode !== GameMode.Original) return;
  if (G.g_evt_block_index !== BranchBlock.Type73) return;
  if (ScriptFlag(BranchScriptFlag.Type73Trigger) === 0) return;
  if ((p.flags & BreakableFlag.Hit) === 0 || p.branchLatched) return;
  if (!TYPE73_KEYS.some(PlayerHoldsOriginalItem)) return;
  p.branchLatched = true;
  G.g_script_branch_var = 2;
}

/**
 * `PropUpdateType76` — `FUN_00471330`. `g_class41_updates[76]`.
 *
 * Two arms, and only one of them wants a key:
 *
 * ```c
 * if ((obj->+0x34 & 8) && obj->+0x192 == 0) {
 *     ...pay, spark, PlaySoundId(0xF16A9)...
 *     if ((obj->+0x194 == 1 && g_evt_block_index == 5)
 *      || (g_evt_block_index == 0x0E
 *          && (HasItem(0) || HasItem(2) || HasItem(0x0B)))) {
 *         obj->+0x192 = 1;
 *         g_script_branch_var = 2;
 *         obj->+0x34 |= 0x40000000;
 *     }
 * }
 * ```
 *
 * `obj+0x194` is a byte the placer copies, and it separates the two shipped
 * spawns: stage 4 block 5 opens on the shot alone, stage 4 block 14 — 0x0E —
 * wants item 0, 2 or 0x0B first. Their records are `{7, -1, 21}` and
 * `{15, -1, 20}`.
 *
 * [open] The port has no `+0x194` for a generic prop, so the block-5 arm is
 * gated on the block alone. That is the same condition for the shipped data —
 * only the block-5 spawn is in block 5 — and it would differ only for a
 * spawn that does not exist.
 *
 * Not transcribed: the spark, the 60 frames of `g_pHingeCurvesXYZ` that swing
 * the door open, and the three draws.
 */
export function PropUpdateType76(p: BreakableProp): void {
  if (G.g_GameMode !== GameMode.Original) return;
  if ((p.flags & BreakableFlag.Hit) === 0 || p.branchLatched) return;
  const first = G.g_evt_block_index === BranchBlock.Type76First;
  const keyed = G.g_evt_block_index === BranchBlock.Type76Keyed
    && TYPE76_KEYS.some(PlayerHoldsOriginalItem);
  if (!first && !keyed) return;
  p.branchLatched = true;
  G.g_script_branch_var = 2;
  p.flags |= PROP_BRANCH_ANSWERED;
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
 * Not transcribed: the hinge curve, the story-mode item spawns in scene 2
 * blocks 2 and 4, the `g_script_flags[0x15]` it raises there, and
 * `DAT_009A26EC`, the once-a-scene latch that also throws the switch and whose
 * other reader is unread.
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
