/**
 * The branch triggers with a constructor of their own.
 *
 * Everything in `class41/branch.ts` is an object `PlaceGenericProp` already
 * built, so the port had it placed and only had to give it behaviour. These
 * do not share that constructor, and until they were here the port could not
 * place them at all — which meant five of the game's branch records had no
 * way to be answered:
 *
 * ```
 * PlaceChainSegments      FUN_00463160  class 0x41 ctor 24   stage 2 blk 22
 * PlaceFragmentProps      FUN_004636A0  class 0x41 ctor 40   28 spawns
 * PlaceStoryModeSwitch    FUN_00473A70  class 0x44 sel 17    12 spawns
 *
 * The fragment row is ported whole now and has its own file,
 * `class41/type40.ts`: constructor, update, draw and all twenty sub-kinds.
 * So is the switch, in `class44/story_switch.ts`.
 * ```
 *
 * All three are Original Mode's. The chain refuses to build its trigger group
 * outside it, and the other two are gated in their updates.
 *
 * **What is transcribed** for the chain and the switch: the object count, the
 * fields the branch arm reads, and the chain's per-segment hang (without its
 * swing, declared at the site).
 */
import { G } from "../globals";
import { GameMode } from "../game_mode";
import type { BreakablePlacement } from "../../bundle";
import {
  BreakableFlag, BreakableState, makeBreakableProp, PropFamily,
  type BreakableProp,
} from "./prop_state";
import { CHAIN_LINK_DROP } from "./shot_test";

/** `PlaceChainSegments` writes `seg->+0x124 = 2.0` for every link. */
export const CHAIN_SEGMENT_RADIUS = 2.0;

/** How many segments a chain has, and the stride of `g_chain_segments`. */
export const CHAIN_SEGMENTS = 0x14;

/** The chain group that carries a route, and the only one gated on the mode. */
export const CHAIN_BRANCH_GROUP = 1;

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
