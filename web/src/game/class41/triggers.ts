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
 * PlaceChainSegments      FUN_00463160  class 0x41 ctor 24   stage 2 blk 22 (chain.ts)
 * PlaceFragmentProps      FUN_004636A0  class 0x41 ctor 40   28 spawns
 * PlaceStoryModeSwitch    FUN_00473A70  class 0x44 sel 17    12 spawns
 *
 * The fragment row is ported whole now and has its own file,
 * `class41/type40.ts`: constructor, update, draw and all twenty sub-kinds.
 * ```
 *
 * All three are Original Mode's. The chain refuses to build its trigger group
 * outside it, and the other two are gated in their updates.
 *
 * The chain is transcribed whole in its own file, `class41/chain.ts`. **What
 * is transcribed** here for the switch: the object count and the fields the
 * branch arm reads.
 */
import { G } from "../globals";
import type { BreakablePlacement } from "../../bundle";
import {
  BreakableFlag, BreakableState, makeBreakableProp, PropFamily,
  type BreakableProp,
} from "./prop_state";
import { STORY_SWITCH_RADIUS } from "./shot_test";

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
  // one goes to `ShotTestMesh`, which the prop pool does not reach. See
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
