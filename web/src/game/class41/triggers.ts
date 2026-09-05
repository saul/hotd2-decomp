/**
 * The three branch triggers with a constructor of their own.
 *
 * Everything in `class41/branch.ts` is an object `PlaceGenericProp` already
 * built, so the port had it placed and only had to give it behaviour. These
 * three do not share that constructor, and until they were here the port could
 * not place them at all — which meant five of the game's branch records had no
 * way to be answered:
 *
 * ```
 * PlaceChainSegments      FUN_00463160  class 0x41 ctor 24   stage 2 blk 22
 * PlaceFragmentProps      FUN_004636A0  class 0x41 ctor 40   28 spawns
 * PlaceStoryModeSwitch    FUN_00473A70  class 0x44 sel 17    12 spawns
 * ```
 *
 * All three are Original Mode's. The chain refuses to build its trigger group
 * outside it, and the other two are gated in their updates.
 *
 * **What is transcribed**: the object count, the fields the branch arm reads,
 * and the shared counter one of them zeroes. The positions each constructor
 * computes from its own tables — the chain's per-segment hang, the fragment
 * row's per-sub-kind layout tables at `0x00594038` and `0x005945EC` — are not,
 * so the port places them at the placer's own point. That is a drawing
 * difference and it is declared; where they *are* is not what decides a route.
 */
import { G } from "../globals";
import { GameMode } from "../game_mode";
import type { BreakablePlacement } from "../../bundle";
import {
  BreakableFlag, BreakableState, makeBreakableProp, PropFamily,
  type BreakableProp,
} from "./prop_state";
import { CHAIN_LINK_DROP, FRAGMENT_RADIUS, STORY_SWITCH_RADIUS }
  from "./shot_test";

/** `PlaceChainSegments` writes `seg->+0x124 = 2.0` for every link. */
export const CHAIN_SEGMENT_RADIUS = 2.0;

/** How many segments a chain has, and the stride of `g_chain_segments`. */
export const CHAIN_SEGMENTS = 0x14;

/** The chain group that carries a route, and the only one gated on the mode. */
export const CHAIN_BRANCH_GROUP = 1;

/**
 * `g_class41_fragment_counts` — `0x005945D8`, one byte per sub-kind: how many
 * objects `PlaceFragmentProps` builds for it.
 *
 * Sub-kind **9** is 2, and that 2 is load-bearing: it is the number
 * `PropUpdateType40` waits for `g_branch_prop_shot_count` to reach before it
 * opens the route. The rest are here because the count is what decides how
 * many objects stand in the level, and a table read out of the image beats a
 * constant chosen to make one case work.
 */
export const FRAGMENT_COUNTS = [
  8, 12, 4, 15, 9, 2, 6, 2, 1, 2, 3, 3, 4, 1, 1, 12, 1, 3, 2, 2,
];

/** The sub-kind whose pair is a route-branch trigger. */
export const FRAGMENT_BRANCH_SUBKIND = 9;

/**
 * `PlaceChainSegments` — `FUN_00463160`. `g_class41_constructors[24]`.
 *
 * ```c
 * if (g_GameMode != 1 && placer->+0x1F4 == 1) { ActorDespawn(placer); return; }
 * for (i = 0; i < 0x14; i++) {
 *     seg = ActorAlloc(ChainSegmentUpdate, 0x200);
 *     seg->+0x1AC = placer->+0x1F4;                    // the chain group
 *     g_chain_segments[group * 0x14 + i] = seg;
 *     seg->position = placer->position;
 *     seg->+0x11C = placer->+0x11C;                    // step lifetime
 *     seg->+0x1AD = i;
 *     seg->+0x1AE = g_evt_step_index;  seg->+0x1AF = 0;
 *     seg->+0x124 = 2.0;                               // hit radius
 *     seg->+0x1B4 = i << 14;                           // its starting yaw
 * }
 * ```
 *
 * **The mode gate is on group 1 only**, so the other chains are built in
 * arcade and simply have no route to open. Twenty segments and one latch: the
 * latch lives on segment 0, which is what makes them behave as one switch.
 */
export function PlaceChainSegments(pl: BreakablePlacement): BreakableProp[] {
  const group = pl.chain_group ?? 0;
  if (G.g_GameMode !== GameMode.Original && group === CHAIN_BRANCH_GROUP) {
    return [];
  }
  const out: BreakableProp[] = [];
  for (let i = 0; i < CHAIN_SEGMENTS; i++) {
    const p = makeBreakableProp(G.g_breakable_next_id++, 0, 0);
    p.family = PropFamily.Generic;
    p.at = pl.at;
    p.kind = 0;
    p.chainGroup = group;
    // `seg->+0x124 = 2.0` -- twenty small spheres, one per link.
    p.hitRadius = CHAIN_SEGMENT_RADIUS;
    p.chainIndex = i;
    p.state = BreakableState.Standing;
    p.flags = 0x80000000 | BreakableFlag.Live;
    p.lastStepIndex = G.g_evt_step_index;
    p.stepsElapsed = 0;
    p.lifetime = pl.lifetime_evt_steps ?? 0;
    p.x = pl.pos?.[0] ?? 0;
    // Each link hangs 1.5 below the one above it: the engine composes
    // `M_i = M_{i-1} * Rz * Rx * T(0, -1.5, 0)` and takes that matrix's world
    // translation as the shot point, so with no swing the twenty links cover
    // **thirty units of drop** from the anchor. Placing them all at the anchor
    // would make a chain of twenty spheres into one link.
    //
    // [diverges] The port drops them straight down and does not run the swing;
    // the engine's `Rz`/`Rx` per link are what make a shot chain sway.
    p.y = (pl.pos?.[1] ?? 0) + CHAIN_LINK_DROP * (i + 1);
    p.z = pl.pos?.[2] ?? 0;
    // `seg->+0x1B4 = i << 14` — each link starts a quarter turn round from the
    // last, which is the chain's twist.
    p.yaw = (i << 14) & 0xffff;
    G.g_chain_segments[group * CHAIN_SEGMENTS + i] = p.id;
    out.push(p);
  }
  return out;
}

/**
 * `PlaceFragmentProps` — `FUN_004636A0`. `g_class41_constructors[40]`,
 * 28 spawns and the most-placed of the branch triggers.
 *
 * ```c
 * count = g_class41_fragment_counts[placer->+0x1F4];
 * for (i = 0; i < count; i++) {
 *     obj = ActorAlloc(PropUpdateType40, 0xD14);
 *     obj->+0x11C = placer->+0x11C;
 *     obj->+0x1B8 = i;                 obj->+0x1BA = placer->+0x1F4;
 *     obj->+0x124 = 5.5;               obj->+0x34  = 0x80000001;
 *     ...a per-sub-kind position table, a draw slot, a scale...
 *     if (sub_kind == 9) g_branch_prop_shot_count = 0;
 * }
 * ```
 *
 * **The counter is zeroed here**, in the constructor, which is what makes
 * `PropUpdateType40`'s "both of them broken" test mean *both of the two this
 * placement built* rather than two from any run. It sits in the `switch` arm
 * for `sub_kind - 6 == 3`, so it fires once per placement rather than once per
 * object.
 */
/**
 * Where `PlaceFragmentProps` puts sub-kind 9's pair, out of the pointer table
 * at `0x005945EC` — `[9]` resolves to `0x00594408`.
 *
 * Two objects, the same y and z, **41.683 apart in x**: the left and right of
 * a corridor, which is what a route-branch pair looks like. They are here as
 * literals because they are the only sub-kind whose placement the port needs
 * to be *right* rather than merely present — the branch depends on both being
 * shootable, and a pair stacked on the placer is one target.
 *
 * [open] The other nineteen sub-kinds' tables are read but not carried; those
 * objects are placed at the placer's own point.
 */
export const FRAGMENT_SUBKIND9_POSITIONS:
    ReadonlyArray<readonly [number, number, number]> = [
  [86.6348, -4.30138, -224.319],
  [128.3177, -4.30138, -224.319],
];

export function PlaceFragmentProps(pl: BreakablePlacement): BreakableProp[] {
  const subKind = pl.sub_kind ?? 0;
  const count = FRAGMENT_COUNTS[subKind] ?? 0;
  const out: BreakableProp[] = [];
  for (let i = 0; i < count; i++) {
    const p = makeBreakableProp(G.g_breakable_next_id++, 0, i);
    p.family = PropFamily.Generic;
    p.at = pl.at;
    p.kind = 40;
    p.subKind = subKind;
    // `obj+0x124 = 0x40B00000` -- 5.5 for every sub-kind.
    p.hitRadius = FRAGMENT_RADIUS;
    p.state = BreakableState.Standing;
    p.flags = 0x80000000 | BreakableFlag.Live;
    p.lastStepIndex = G.g_evt_step_index;
    p.stepsElapsed = 0;
    p.lifetime = pl.lifetime_evt_steps ?? 0;
    const at = subKind === FRAGMENT_BRANCH_SUBKIND
      ? FRAGMENT_SUBKIND9_POSITIONS[i] : undefined;
    p.x = at ? at[0] : pl.pos?.[0] ?? 0;
    p.y = at ? at[1] : pl.pos?.[1] ?? 0;
    p.z = at ? at[2] : pl.pos?.[2] ?? 0;
    p.yaw = pl.yaw ?? 0;
    out.push(p);
  }
  if (subKind === FRAGMENT_BRANCH_SUBKIND) G.g_branch_prop_shot_count = 0;
  return out;
}

/**
 * `PlaceStoryModeSwitch` — `FUN_00473A70`. `g_class44_subtypes[17]`.
 *
 * The whole tail, and every field of it that matters is a gate:
 *
 * ```
 * tail+0x00  s8   -> obj+0x194
 * tail+0x04  s16  -> obj+0x28C   the asset slot
 * tail+0x08  s32  -> obj+0x14C   -1 gives a 8.0 hit radius and flag 0x80000001
 * tail+0x10  s8   -> obj+0x2A0   THE SCRIPT FLAG the route waits on
 * tail+0x11  s8   -> obj+0x2A4   the script flag that removes the object
 * tail+0x20..0x23  s8 x4 -> obj+0x1FC/0x202/0x208/0x20E   four item ids
 * obj+0x11C = 1                  a LITERAL, so not a lifetime
 * ```
 *
 * `obj+0x11C` being written as 1 rather than copied is why this object does
 * not run `PropExpireByStepLifetime`: `+0x2A4` removes it instead. Reading
 * that word as a lifetime would retire every switch in the game after one step
 * boundary, which is one step before any of them could answer.
 */
export function PlaceStoryModeSwitch(pl: BreakablePlacement): BreakableProp {
  const p = makeBreakableProp(G.g_breakable_next_id++, 0, 0);
  p.family = PropFamily.StoryModeSwitch;
  p.at = pl.at;
  p.state = BreakableState.Standing;
  p.flags = 0x80000000 | BreakableFlag.Live;
  p.lastStepIndex = G.g_evt_step_index;
  p.stepsElapsed = 0;
  // Not a lifetime — see above. Carried as the engine writes it.
  p.lifetime = 1;
  p.slot = pl.slot ?? 0;
  // `obj+0x2A0` and `obj+0x2A4`. `storyItem` is `+0x2A0`'s offset already.
  // `obj+0x124 = 8.0`, and only on the `desc+8 == -1` variant -- the other
  // one goes to `ShotTestMesh`, which the port has not got. See
  // `STORY_SWITCH_RADIUS`.
  p.hitRadius = (pl.volume ?? -1) === -1 ? STORY_SWITCH_RADIUS : 0;
  p.storyItem = pl.branch_flag ?? -1;
  p.removeFlag = pl.remove_flag ?? -1;
  p.key0 = pl.keys?.[0] ?? -1;
  p.key1 = pl.keys?.[1] ?? -1;
  p.key2 = pl.keys?.[2] ?? -1;
  p.key3 = pl.keys?.[3] ?? -1;
  p.x = pl.pos?.[0] ?? 0;
  p.y = pl.pos?.[1] ?? 0;
  p.z = pl.pos?.[2] ?? 0;
  p.yaw = pl.yaw ?? 0;
  return p;
}
